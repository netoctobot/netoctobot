import type { PrismaClient } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { hashPassword } from "./password.js";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const MIN_PASSWORD_LENGTH = 8;

export async function bootstrapLocalDashboardAdmin(
  prisma: PrismaClient,
  env: Env,
  log: (message: string) => void = () => undefined,
): Promise<void> {
  const username = env.LOCAL_ADMIN_USERNAME;
  const password = env.LOCAL_ADMIN_PASSWORD;
  if (env.NODE_ENV === "production") {
    if (username || password) {
      log("Local dashboard admin bootstrap is disabled in production");
    }
    return;
  }
  if (!username && !password) {
    return;
  }
  if (!username || !password) {
    throw new Error(
      "LOCAL_ADMIN_USERNAME and LOCAL_ADMIN_PASSWORD must both be set or both be omitted",
    );
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(
      "LOCAL_ADMIN_USERNAME must be 3 to 32 characters of lowercase letters, digits, underscores, or hyphens",
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `LOCAL_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  const existing = await prisma.dashboardAdmin.findFirst({
    select: { id: true },
  });
  if (existing) {
    return;
  }

  await prisma.dashboardAdmin.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
    },
  });
  log("Created local dashboard admin");
}
