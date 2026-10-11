import { DelayedError, Queue, Worker, type Job } from "bullmq";
import { Api } from "grammy";
import { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { decryptToken } from "../../lib/token-crypto.js";
import type { LinkButtonMatrix } from "./content.js";
import { classifySendError, nextDelivery } from "./plan.js";
import { executeBroadcastMessageDelete } from "./delete-delivery.js";
import { recoverExpiredDeleteClaims } from "./delete-claim.js";
import {
  findMessagesNeedingDeleteQueue,
  findPendingDeleteMessageIds,
  queueDeleteForSentDelivery,
} from "./delete-reconcile.js";
import { assertOwnerBotActiveForSend } from "./owner-broadcast-guard.js";
import { executeBroadcastSend } from "./send-delivery.js";

const QUEUE_NAME = "broadcast-send";
const DELETE_QUEUE_NAME = "broadcast-delete";
const SEND_GAP_MS = 50;
const DELETE_GAP_MS = 50;
const DELETE_RECONCILE_MS = 60 * 1000;

function connection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export class BroadcastScheduler {
  readonly #queue: Queue;
  readonly #worker: Worker;
  readonly #deleteQueue: Queue;
  readonly #deleteWorker: Worker;
  readonly #connections: Redis[];
  #reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaClient,
  ) {
    const queueConnection = connection(env.REDIS_URL);
    const workerConnection = connection(env.REDIS_URL);
    const deleteQueueConnection = connection(env.REDIS_URL);
    const deleteWorkerConnection = connection(env.REDIS_URL);
    this.#connections = [
      queueConnection,
      workerConnection,
      deleteQueueConnection,
      deleteWorkerConnection,
    ];
    this.#queue = new Queue(QUEUE_NAME, { connection: queueConnection });
    this.#worker = new Worker(QUEUE_NAME, (job) => this.#send(job), {
      connection: workerConnection,
      concurrency: 1,
    });
    this.#deleteQueue = new Queue(DELETE_QUEUE_NAME, { connection: deleteQueueConnection });
    this.#deleteWorker = new Worker(DELETE_QUEUE_NAME, (job) => this.#deleteMessage(job), {
      connection: deleteWorkerConnection,
      concurrency: 1,
    });
    void this.reconcileDeleteWork();
    this.#reconcileTimer = setInterval(() => {
      void this.reconcileDeleteWork();
    }, DELETE_RECONCILE_MS);
  }

  async enqueue(campaignId: string, deliveryId: string): Promise<void> {
    await this.#queue.add(
      "send",
      { campaignId, deliveryId },
      { jobId: deliveryId, removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }

  async stop(): Promise<void> {
    if (this.#reconcileTimer) {
      clearInterval(this.#reconcileTimer);
      this.#reconcileTimer = null;
    }
    await this.#worker.close();
    await this.#deleteWorker.close();
    await this.#queue.close();
    await this.#deleteQueue.close();
    await Promise.all(this.#connections.map((redis) => redis.quit()));
  }

  async enqueueDeleteMessage(messageRowId: string): Promise<void> {
    try {
      await this.#deleteQueue.add(
        "delete",
        { messageRowId },
        { jobId: `delete-msg-${messageRowId}`, removeOnComplete: 1000, removeOnFail: 1000 },
      );
    } catch {
      // Redis enqueue failure; periodic reconcile will retry from PENDING rows.
    }
  }

  async reconcileDeleteWork(): Promise<void> {
    await recoverExpiredDeleteClaims(this.prisma);
    await findMessagesNeedingDeleteQueue(this.prisma);
    const pending = await findPendingDeleteMessageIds(this.prisma);
    for (const messageRowId of pending) {
      await this.enqueueDeleteMessage(messageRowId);
    }
  }

  async #send(job: Job<{ campaignId: string; deliveryId: string }>): Promise<void> {
    const delivery = await this.prisma.broadcastDelivery.findUnique({
      where: { id: job.data.deliveryId },
      select: {
        id: true,
        status: true,
        botId: true,
        campaign: {
          select: {
            id: true,
            text: true,
            contentKind: true,
            caption: true,
            linkButtons: true,
            stopRequested: true,
            deleteRequested: true,
            createdByKind: true,
            initiatorBotId: true,
            mediaAsset: {
              select: {
                id: true,
                storageKey: true,
                contentKind: true,
                fileDeletedAt: true,
                originalName: true,
              },
            },
          },
        },
        channel: { select: { channelTelegramId: true } },
        user: { select: { telegramId: true } },
        bot: { select: { tokenEncrypted: true } },
      },
    });
    if (!delivery) {
      return;
    }
    if (
      delivery.campaign.createdByKind === "BOT_OWNER" &&
      delivery.botId &&
      !(await assertOwnerBotActiveForSend(this.prisma, delivery.botId))
    ) {
      await this.prisma.broadcastCampaign.update({
        where: { id: delivery.campaign.id },
        data: { stopRequested: true },
      });
      await this.prisma.broadcastDelivery.updateMany({
        where: { campaignId: delivery.campaign.id, status: "PENDING" },
        data: { status: "STOPPED" },
      });
      await this.#refresh(delivery.campaign.id, true);
      return;
    }
    const step = nextDelivery(delivery.status, delivery.campaign.stopRequested);
    if (!step.send) {
      if (delivery.status === "PENDING" && step.status === "STOPPED") {
        await this.prisma.broadcastDelivery.update({
          where: { id: delivery.id },
          data: { status: "STOPPED" },
        });
      }
      await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
      return;
    }
    if (!delivery.bot?.tokenEncrypted || !delivery.botId) {
      await this.prisma.broadcastDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", reason: "invalid_token" },
      });
      await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
      return;
    }
    const chatId = delivery.channel
      ? Number(delivery.channel.channelTelegramId)
      : delivery.user
        ? Number(delivery.user.telegramId)
        : null;
    if (chatId === null) {
      await this.prisma.broadcastDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", reason: "invalid_target" },
      });
      await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
      return;
    }
    let token: string;
    try {
      token = decryptToken(delivery.bot.tokenEncrypted, this.env.ENCRYPTION_KEY);
    } catch {
      await this.prisma.broadcastDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: { status: "FAILED", reason: "invalid_token" },
      });
      await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    const api = new Api(token);
    const mediaAsset =
      delivery.campaign.mediaAsset && !delivery.campaign.mediaAsset.fileDeletedAt
        ? delivery.campaign.mediaAsset
        : null;
    const outcome = await executeBroadcastSend({
      prisma: this.prisma,
      api,
      mediaRoot: this.env.BROADCAST_MEDIA_DIR,
      deliveryId: delivery.id,
      botId: delivery.botId,
      chatId,
      content: {
        contentKind: delivery.campaign.contentKind,
        text: delivery.campaign.text,
        caption: delivery.campaign.caption,
        linkButtons: delivery.campaign.linkButtons as LinkButtonMatrix | null,
        mediaAsset: mediaAsset
          ? {
              id: mediaAsset.id,
              storageKey: mediaAsset.storageKey,
              contentKind: mediaAsset.contentKind,
              originalName: mediaAsset.originalName,
            }
          : null,
      },
    });
    if (outcome.status === "sent") {
      if (delivery.campaign.deleteRequested) {
        const messageRowId = await queueDeleteForSentDelivery(this.prisma, delivery.id);
        if (messageRowId) {
          await this.enqueueDeleteMessage(messageRowId);
        }
      }
      await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
      return;
    }
    if (outcome.status === "uncertain") {
      await this.prisma.broadcastDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: { status: "UNCERTAIN", reason: "uncertain" },
      });
      await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
      return;
    }
    const classified = classifySendError(outcome.cause ?? outcome.reason);
    if (classified.action === "retry") {
      await job.moveToDelayed(Date.now() + classified.delayMs, job.token);
      throw new DelayedError();
    }
    if (classified.action === "uncertain") {
      await this.prisma.broadcastDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: { status: "UNCERTAIN", reason: "uncertain" },
      });
      await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
      return;
    }
    await this.prisma.broadcastDelivery.updateMany({
      where: { id: delivery.id, status: "PENDING" },
      data: {
        status: "FAILED",
        reason: classified.action === "failed" ? classified.reason : outcome.reason,
      },
    });
    await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
  }

  async #deleteMessage(job: Job<{ messageRowId: string }>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, DELETE_GAP_MS));
    const outcome = await executeBroadcastMessageDelete({
      prisma: this.prisma,
      encryptionKey: this.env.ENCRYPTION_KEY,
      messageRowId: job.data.messageRowId,
    });
    if (outcome === "retry") {
      await job.moveToDelayed(Date.now() + 2000, job.token);
      throw new DelayedError();
    }
  }

  async #refresh(campaignId: string, stopRequested: boolean): Promise<void> {
    const pending = await this.prisma.broadcastDelivery.count({
      where: { campaignId, status: "PENDING" },
    });
    if (pending > 0) {
      return;
    }
    const status = stopRequested ? "STOPPED" : "COMPLETED";
    const campaign = await this.prisma.broadcastCampaign.findUnique({
      where: { id: campaignId },
      select: { endedAt: true },
    });
    await this.prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: {
        status,
        endedAt: campaign?.endedAt ?? new Date(),
      },
    });
  }
}
