import { Api } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { decryptToken } from "../../lib/token-crypto.js";
import { classifyMembershipError } from "../forced-subscription/membership.js";
import { canPublishAsAdmin, type ProbeResult } from "./plan.js";

export function broadcastProbe(
  prisma: PrismaClient,
  encryptionKey: string,
): (botId: string, channelId: string) => Promise<ProbeResult> {
  return async (botId, channelId) => {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { tokenEncrypted: true },
    });
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { channelTelegramId: true },
    });
    if (!bot || !channel) {
      return { ok: false, reason: "invalid_token" };
    }
    let token = "";
    try {
      token = decryptToken(bot.tokenEncrypted, encryptionKey);
    } catch {
      return { ok: false, reason: "invalid_token" };
    }
    if (!token) {
      return { ok: false, reason: "invalid_token" };
    }
    const api = new Api(token);
    try {
      const me = await api.getMe();
      const member = await api.getChatMember(Number(channel.channelTelegramId), me.id);
      if (canPublishAsAdmin(member)) {
        return { ok: true };
      }
      return {
        ok: false,
        reason:
          member.status === "administrator" || member.status === "creator"
            ? "no_post_permission"
            : "not_admin",
      };
    } catch (error) {
      if (classifyMembershipError(error) === "unavailable") {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: false, reason: "not_admin" };
    }
  };
}
