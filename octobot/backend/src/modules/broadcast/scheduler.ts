import { DelayedError, Queue, Worker, type Job } from "bullmq";
import { Api } from "grammy";
import { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { decryptToken } from "../../lib/token-crypto.js";
import { classifySendError, nextDelivery } from "./plan.js";

const QUEUE_NAME = "broadcast-send";
const SEND_GAP_MS = 50;

function connection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export class BroadcastScheduler {
  readonly #queue: Queue;
  readonly #worker: Worker;
  readonly #connections: Redis[];

  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaClient,
  ) {
    const queueConnection = connection(env.REDIS_URL);
    const workerConnection = connection(env.REDIS_URL);
    this.#connections = [queueConnection, workerConnection];
    this.#queue = new Queue(QUEUE_NAME, { connection: queueConnection });
    this.#worker = new Worker(QUEUE_NAME, (job) => this.#send(job), {
      connection: workerConnection,
      concurrency: 1,
    });
  }

  async enqueue(campaignId: string, deliveryId: string): Promise<void> {
    await this.#queue.add(
      "send",
      { campaignId, deliveryId },
      { jobId: deliveryId, removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }

  async stop(): Promise<void> {
    await this.#worker.close();
    await this.#queue.close();
    await Promise.all(this.#connections.map((redis) => redis.quit()));
  }

  async #send(job: Job<{ campaignId: string; deliveryId: string }>): Promise<void> {
    const delivery = await this.prisma.broadcastDelivery.findUnique({
      where: { id: job.data.deliveryId },
      select: {
        id: true,
        status: true,
        botId: true,
        campaign: { select: { id: true, text: true, stopRequested: true } },
        channel: { select: { channelTelegramId: true } },
        bot: { select: { tokenEncrypted: true } },
      },
    });
    if (!delivery) {
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
    if (!delivery.bot?.tokenEncrypted) {
      await this.prisma.broadcastDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", reason: "invalid_token" },
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
    try {
      const api = new Api(token);
      const sent = await api.sendMessage(
        Number(delivery.channel.channelTelegramId),
        delivery.campaign.text,
      );
      await this.prisma.broadcastDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: { status: "SENT", telegramMessageId: BigInt(sent.message_id) },
      });
    } catch (error) {
      const outcome = classifySendError(error);
      if (outcome.action === "retry") {
        await job.moveToDelayed(Date.now() + outcome.delayMs, job.token);
        throw new DelayedError();
      }
      await this.prisma.broadcastDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: {
          status: outcome.action === "uncertain" ? "UNCERTAIN" : "FAILED",
          reason: outcome.action === "failed" ? outcome.reason : "uncertain",
        },
      });
    }
    await this.#refresh(delivery.campaign.id, delivery.campaign.stopRequested);
  }

  async #refresh(campaignId: string, stopRequested: boolean): Promise<void> {
    const pending = await this.prisma.broadcastDelivery.count({
      where: { campaignId, status: "PENDING" },
    });
    if (pending > 0) {
      return;
    }
    await this.prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: { status: stopRequested ? "STOPPED" : "COMPLETED" },
    });
  }
}
