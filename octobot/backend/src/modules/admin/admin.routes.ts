import { SupportedLanguage, type PrismaClient, type User } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { disableByAdmin } from "../support-list/membership.service.js";
import { normalizeAdminReason } from "./admin-reason.js";
import {
  clearSessionCookieHeader,
  readAdminSession,
  readCookie,
  sessionCookieHeader,
  sessionExpiry,
  signAdminSession,
  ADMIN_SESSION_COOKIE,
} from "./admin-session.js";
import { reorderCatalog, setCatalogActive } from "./catalog.service.js";
import {
  readAudit,
  readBot,
  readBots,
  readCatalog,
  readChannel,
  readChannels,
  readForcedSubscriptions,
  readOverview,
  readPublishing,
  readPublishingDetail,
  readUsers,
} from "./admin-read.service.js";
import {
  parseTelegramLoginBody,
  verifyTelegramLogin,
} from "./telegram-login.js";
import { getWebLocale, setWebLocale } from "./web-locale.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface AdminRouteOptions {
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestedPage(query: unknown): number {
  if (!isRecord(query) || query.page === undefined) {
    return 1;
  }
  const value = Number(query.page);
  if (!Number.isInteger(value) || value < 1) {
    return 1;
  }
  return value;
}

function routeId(value: string): string | null {
  return ID_PATTERN.test(value) ? value : null;
}

function publicUser(user: User) {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export function registerAdminRoutes(
  app: FastifyInstance,
  env: Env,
  prisma: PrismaClient,
  options: AdminRouteOptions = {},
): void {
  const now = options.now ?? Date.now;
  const secure = new URL(env.PUBLIC_BASE_URL).protocol === "https:";

  async function requireOwner(
    request: { headers: { cookie?: string | string[] }; ip: string },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ): Promise<User | null> {
    const header = Array.isArray(request.headers.cookie)
      ? request.headers.cookie.join("; ")
      : request.headers.cookie;
    const session = readAdminSession(
      readCookie(header, ADMIN_SESSION_COOKIE),
      env.ENCRYPTION_KEY,
      now(),
    );
    if (!session || session.telegramId !== env.OWNER_TELEGRAM_ID.toString()) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (
      !user ||
      user.deletedAt ||
      user.telegramId !== env.OWNER_TELEGRAM_ID
    ) {
      reply.code(403).send({ error: "not_owner" });
      return null;
    }
    return user;
  }

  app.get("/admin/login-info", async (_request, reply) => {
    const settings = await prisma.platformSettings.findUnique({
      where: { id: "default" },
      select: { platformBot: { select: { botUsername: true } } },
    });
    if (!settings) {
      return reply.code(404).send({ error: "platform_bot_missing" });
    }
    return { botUsername: settings.platformBot.botUsername };
  });

  app.post("/admin/session", async (request, reply) => {
    const login = parseTelegramLoginBody(request.body);
    if (!login || !verifyTelegramLogin(login, env.BOT_TOKEN, now())) {
      return reply.code(401).send({ error: "invalid_login" });
    }
    if (BigInt(login.id) !== env.OWNER_TELEGRAM_ID) {
      return reply.code(403).send({ error: "not_owner" });
    }
    const existing = await prisma.user.findUnique({
      where: { telegramId: BigInt(login.id) },
    });
    if (!existing || existing.deletedAt) {
      return reply.code(403).send({ error: "owner_not_registered" });
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        firstName: login.first_name,
        ...(login.last_name ? { lastName: login.last_name } : {}),
        ...(login.username ? { username: login.username } : {}),
      },
    });
    const webLocale = await getWebLocale(prisma, user.id);
    const token = signAdminSession(
      {
        userId: user.id,
        telegramId: user.telegramId.toString(),
        exp: sessionExpiry(now()),
      },
      env.ENCRYPTION_KEY,
    );
    reply.header("set-cookie", sessionCookieHeader(token, secure));
    return { user: publicUser(user), webLocale };
  });

  app.delete("/admin/session", async (_request, reply) => {
    reply.header("set-cookie", clearSessionCookieHeader(secure));
    return reply.code(204).send();
  });

  app.get("/admin/me", async (request, reply) => {
    const user = await requireOwner(request, reply);
    if (!user) {
      return;
    }
    return {
      user: publicUser(user),
      webLocale: await getWebLocale(prisma, user.id),
    };
  });

  app.put("/admin/locale", async (request, reply) => {
    const user = await requireOwner(request, reply);
    if (!user) {
      return;
    }
    const language =
      isRecord(request.body) &&
      (request.body.language === SupportedLanguage.AR ||
        request.body.language === SupportedLanguage.EN)
        ? request.body.language
        : null;
    if (!language) {
      return reply.code(400).send({ error: "invalid_language" });
    }
    const saved = await setWebLocale(prisma, user.id, language);
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "web_locale.set",
        entityType: "WebLocalePreference",
        entityId: user.id,
        details: { language: saved },
        ip: request.ip,
      },
    });
    return { language: saved };
  });

  app.get("/admin/overview", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readOverview(prisma);
  });

  app.get("/admin/users", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readUsers(prisma, requestedPage(request.query));
  });

  app.get("/admin/bots", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readBots(prisma, requestedPage(request.query));
  });

  app.get<{ Params: { id: string } }>("/admin/bots/:id", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    const id = routeId(request.params.id);
    const bot = id ? await readBot(prisma, id) : null;
    if (!bot) {
      return reply.code(404).send({ error: "not_found" });
    }
    return bot;
  });

  app.get("/admin/channels", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readChannels(prisma, requestedPage(request.query));
  });

  app.get<{ Params: { id: string } }>(
    "/admin/channels/:id",
    async (request, reply) => {
      if (!(await requireOwner(request, reply))) {
        return;
      }
      const id = routeId(request.params.id);
      const channel = id ? await readChannel(prisma, id) : null;
      if (!channel) {
        return reply.code(404).send({ error: "not_found" });
      }
      return channel;
    },
  );

  app.get("/admin/publishing", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readPublishing(prisma, requestedPage(request.query));
  });

  app.get<{ Params: { botId: string } }>(
    "/admin/publishing/:botId",
    async (request, reply) => {
      if (!(await requireOwner(request, reply))) {
        return;
      }
      const botId = routeId(request.params.botId);
      const detail = botId ? await readPublishingDetail(prisma, botId) : null;
      if (!detail) {
        return reply.code(404).send({ error: "not_found" });
      }
      return detail;
    },
  );

  app.post<{ Params: { botId: string; membershipId: string } }>(
    "/admin/publishing/:botId/memberships/:membershipId/admin-disable",
    async (request, reply) => {
      const user = await requireOwner(request, reply);
      if (!user) {
        return;
      }
      const botId = routeId(request.params.botId);
      const membershipId = routeId(request.params.membershipId);
      const reason =
        isRecord(request.body) && typeof request.body.reason === "string"
          ? normalizeAdminReason(request.body.reason)
          : null;
      if (!botId || !membershipId || !reason) {
        return reply.code(400).send({ error: "invalid_reason" });
      }
      const updated = await disableByAdmin(prisma, botId, membershipId, reason);
      if (!updated) {
        return reply.code(404).send({ error: "not_found" });
      }
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "support_list.admin_disable",
          entityType: "SupportListMembership",
          entityId: updated.id,
          details: { botId, reason },
          ip: request.ip,
        },
      });
      return {
        id: updated.id,
        adminDisabled: updated.adminDisabled,
        adminDisableReason: updated.adminDisableReason,
      };
    },
  );

  app.get("/admin/catalog", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readCatalog(prisma);
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/catalog/:id",
    async (request, reply) => {
      const user = await requireOwner(request, reply);
      if (!user) {
        return;
      }
      const id = routeId(request.params.id);
      const isActive =
        isRecord(request.body) && typeof request.body.isActive === "boolean"
          ? request.body.isActive
          : null;
      if (!id || isActive === null) {
        return reply.code(400).send({ error: "invalid_order" });
      }
      const updated = await setCatalogActive(
        prisma,
        user.id,
        id,
        isActive,
        request.ip,
      );
      if (!updated) {
        return reply.code(404).send({ error: "not_found" });
      }
      return updated;
    },
  );

  app.put("/admin/catalog/order", async (request, reply) => {
    const user = await requireOwner(request, reply);
    if (!user) {
      return;
    }
    const ids =
      isRecord(request.body) &&
      Array.isArray(request.body.ids) &&
      request.body.ids.every(
        (id): id is string => typeof id === "string" && ID_PATTERN.test(id),
      )
        ? request.body.ids
        : null;
    if (!ids) {
      return reply.code(400).send({ error: "invalid_order" });
    }
    const saved = await reorderCatalog(prisma, user.id, ids, request.ip);
    if (!saved) {
      return reply.code(400).send({ error: "invalid_order" });
    }
    return { ids };
  });

  app.get("/admin/forced-subscriptions", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readForcedSubscriptions(prisma);
  });

  app.get("/admin/audit", async (request, reply) => {
    if (!(await requireOwner(request, reply))) {
      return;
    }
    return readAudit(prisma, requestedPage(request.query));
  });
}
