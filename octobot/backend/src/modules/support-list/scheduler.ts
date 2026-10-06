import { DelayedError, Queue, Worker, type Job } from "bullmq";
import { Bot as TelegramBot } from "grammy";
import { Redis } from "ioredis";
import type { Env } from "../../config/env.js";
import { decryptToken } from "../../lib/token-crypto.js";
import type { PrismaClient } from "@prisma/client";
import { retryAfterMs, TelegramUnavailableError } from "./access.js";
import { PublishDeferredError } from "./delivery.js";
import { ensureSupportListHorizon } from "./cycles.js";
import {
  deletePublishedMessage,
  markDeleteFailed,
  publishCycle,
} from "./publisher.js";

const PUBLISH_QUEUE = "support-list-publish";
const DELETE_QUEUE = "support-list-delete";

function bullConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

async function delayForTelegram(
  job: Job,
  token: string | undefined,
  error: unknown,
): Promise<boolean> {
  const retryDelay = retryAfterMs(error);
  const delay =
    retryDelay ??
    (error instanceof TelegramUnavailableError ? 15_000 : null);
  if (delay === null || !token) {
    return false;
  }
  await job.moveToDelayed(Date.now() + delay, token);
  return true;
}

export class SupportListScheduler {
  readonly #publishQueue: Queue;
  readonly #deleteQueue: Queue;
  readonly #publishWorker: Worker;
  readonly #deleteWorker: Worker;
  readonly #connections: Redis[];

  constructor(
    env: Env,
    private readonly prisma: PrismaClient,
  ) {
    const publishConnection = bullConnection(env.REDIS_URL);
    const deleteConnection = bullConnection(env.REDIS_URL);
    const publishWorkerConnection = bullConnection(env.REDIS_URL);
    const deleteWorkerConnection = bullConnection(env.REDIS_URL);
    this.#connections = [
      publishConnection,
      deleteConnection,
      publishWorkerConnection,
      deleteWorkerConnection,
    ];
    this.#publishQueue = new Queue(PUBLISH_QUEUE, {
      connection: publishConnection,
    });
    this.#deleteQueue = new Queue(DELETE_QUEUE, {
      connection: deleteConnection,
    });
    const openTelegram = async (tokenEncrypted: string) => {
      const bot = new TelegramBot(
        decryptToken(tokenEncrypted, env.ENCRYPTION_KEY),
      );
      await bot.init();
      return bot;
    };
    const deps = {
      prisma,
      openTelegram,
      enqueueDelete: (publicationId: string, deleteAt: Date) =>
        this.enqueueDelete(publicationId, deleteAt),
    };

    this.#publishWorker = new Worker(
      PUBLISH_QUEUE,
      async (job, token) => {
        try {
          if (job.name === "horizon") {
            await this.syncHorizon();
            return;
          }
          await publishCycle(deps, String(job.data.cycleId));
        } catch (error) {
          if (
            error instanceof PublishDeferredError &&
            token
          ) {
            await job.moveToDelayed(error.resumeAt.getTime(), token);
            throw new DelayedError();
          }
          if (await delayForTelegram(job, token, error)) {
            throw new DelayedError();
          }
          throw error;
        }
      },
      { connection: publishWorkerConnection, concurrency: 1 },
    );

    this.#deleteWorker = new Worker(
      DELETE_QUEUE,
      async (job, token) => {
        try {
          await deletePublishedMessage(deps, String(job.data.publicationId));
        } catch (error) {
          if (await delayForTelegram(job, token, error)) {
            throw new DelayedError();
          }
          throw error;
        }
      },
      { connection: deleteWorkerConnection, concurrency: 2 },
    );
    this.#deleteWorker.on("failed", (job) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) {
        return;
      }
      void markDeleteFailed(prisma, String(job.data.publicationId));
    });
  }

  async start(): Promise<void> {
    await this.#publishQueue.upsertJobScheduler(
      "support-list-horizon",
      { every: 60_000 },
      { name: "horizon", data: {} },
    );
    await this.syncHorizon();
  }

  async syncHorizon(): Promise<void> {
    const cycles = await ensureSupportListHorizon(this.prisma);
    for (const cycle of cycles) {
      await this.enqueuePublish(cycle.id, cycle.scheduledAt);
    }
  }

  async enqueuePublish(cycleId: string, scheduledAt: Date): Promise<void> {
    const delay = Math.max(0, scheduledAt.getTime() - Date.now());
    await this.#publishQueue
      .add(
        "publish",
        { cycleId },
        {
          jobId: `publish:${cycleId}`,
          delay,
          attempts: 8,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      )
      .catch(() => undefined);
  }

  async enqueueDelete(publicationId: string, deleteAt: Date): Promise<void> {
    const delay = Math.max(0, deleteAt.getTime() - Date.now());
    await this.#deleteQueue
      .add(
        "delete",
        { publicationId },
        {
          jobId: `delete:${publicationId}`,
          delay,
          attempts: 8,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      )
      .catch(() => undefined);
  }

  async stop(): Promise<void> {
    await this.#publishWorker.close();
    await this.#deleteWorker.close();
    await this.#publishQueue.close();
    await this.#deleteQueue.close();
    await Promise.all(
      this.#connections.map((connection) => connection.quit()),
    );
  }
}
