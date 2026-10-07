import { SupportedLanguage, type PrismaClient } from "@prisma/client";
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
import { verifyPassword } from "./password.js";
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

interface DashboardAdminRecord {
  id: string;
  username: string;
  passwordHash: string;
}

function publicAdmin(admin: DashboardAdminRecord) {
  return {
    id: admin.id,
    username: admin.username,
  };
}

function loginBody(
  value: unknown,
): { username: string; password: string } | null {
  if (
    !isRecord(value) ||
    typeof value.username !== "string" ||
    typeof value.password !== "string"
  ) {
    return null;
  }
  const username = value.username.trim();
  if (!username || !value.password) {
    return null;
  }
  return { username, password: value.password };
}

export function registerAdminRoutes(
  app: FastifyInstance,
  env: Env,
  prisma: PrismaClient,
  options: AdminRouteOptions = {},
): void {
  const now = options.now ?? Date.now;
  const secure = new URL(env.PUBLIC_BASE_URL).protocol === "https:";

  async function requireAdmin(
    request: { headers: { cookie?: string | string[] }; ip: string },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ): Promise<DashboardAdminRecord | null> {
    const header = Array.isArray(request.headers.cookie)
      ? request.headers.cookie.join("; ")
      : request.headers.cookie;
    const session = readAdminSession(
      readCookie(header, ADMIN_SESSION_COOKIE),
      env.ENCRYPTION_KEY,
      now(),
    );
    if (!session) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const admin = await prisma.dashboardAdmin.findUnique({
      where: { id: session.adminId },
    });
    if (!admin) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return admin;
  }

  app.post("/admin/session", async (request, reply) => {
    const login = loginBody(request.body);
    const admin = login
      ? await prisma.dashboardAdmin.findUnique({
          where: { username: login.username },
        })
      : null;
    const valid = await verifyPassword(
      login?.password ?? "",
      admin?.passwordHash ?? null,
    );
    if (!login || !admin || !valid) {
      return reply.code(401).send({ error: "invalid_login" });
    }
    const webLocale = await getWebLocale(prisma, admin.id);
    const token = signAdminSession(
      {
        adminId: admin.id,
        exp: sessionExpiry(now()),
      },
      env.ENCRYPTION_KEY,
    );
    reply.header("set-cookie", sessionCookieHeader(token, secure));
    return { admin: publicAdmin(admin), webLocale };
  });

  app.delete("/admin/session", async (_request, reply) => {
    reply.header("set-cookie", clearSessionCookieHeader(secure));
    return reply.code(204).send();
  });

  app.get("/admin/me", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }
    return {
      admin: publicAdmin(admin),
      webLocale: await getWebLocale(prisma, admin.id),
    };
  });

  app.put("/admin/locale", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
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
    const saved = await setWebLocale(prisma, admin.id, language);
    await prisma.auditLog.create({
      data: {
        action: "web_locale.set",
        entityType: "WebLocalePreference",
        entityId: admin.id,
        details: { language: saved, adminUsername: admin.username },
        ip: request.ip,
      },
    });
    return { language: saved };
  });

  app.get("/admin/overview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readOverview(prisma);
  });

  app.get("/admin/users", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readUsers(prisma, requestedPage(request.query));
  });

  app.get("/admin/bots", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readBots(prisma, requestedPage(request.query));
  });

  app.get<{ Params: { id: string } }>("/admin/bots/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) {
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
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readChannels(prisma, requestedPage(request.query));
  });

  app.get<{ Params: { id: string } }>(
    "/admin/channels/:id",
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) {
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
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readPublishing(prisma, requestedPage(request.query));
  });

  app.get<{ Params: { botId: string } }>(
    "/admin/publishing/:botId",
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) {
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
      const admin = await requireAdmin(request, reply);
      if (!admin) {
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
          action: "support_list.admin_disable",
          entityType: "SupportListMembership",
          entityId: updated.id,
          details: { botId, reason, adminUsername: admin.username },
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
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readCatalog(prisma);
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/catalog/:id",
    async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) {
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
        admin.username,
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
    const admin = await requireAdmin(request, reply);
    if (!admin) {
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
    const saved = await reorderCatalog(prisma, admin.username, ids, request.ip);
    if (!saved) {
      return reply.code(400).send({ error: "invalid_order" });
    }
    return { ids };
  });

  app.get("/admin/forced-subscriptions", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readForcedSubscriptions(prisma);
  });

  app.get("/admin/audit", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) {
      return;
    }
    return readAudit(prisma, requestedPage(request.query));
  });
}
