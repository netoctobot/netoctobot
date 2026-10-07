import { z } from "zod";

function blankToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const optionalText = z.preprocess(blankToUndefined, z.string().min(1).optional());

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    BOT_TOKEN: z.string().min(1),
    OWNER_TELEGRAM_ID: z
      .string()
      .regex(/^-?[1-9]\d*$/, "OWNER_TELEGRAM_ID must be a Telegram integer id")
      .transform(BigInt),
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 32 bytes as 64 hex chars"),
    WEBHOOK_SECRET: z
      .string()
      .min(1)
      .max(256)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "WEBHOOK_SECRET may contain only A-Z, a-z, 0-9, _ and -",
      ),
    PUBLIC_BASE_URL: z.string().url(),
    WEBHOOK_REGISTRATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: optionalText,
    LOCAL_ADMIN_USERNAME: optionalText,
    LOCAL_ADMIN_PASSWORD: optionalText,
  })
  .superRefine((value, context) => {
    if (
      value.WEBHOOK_REGISTRATION_ENABLED &&
      new URL(value.PUBLIC_BASE_URL).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_BASE_URL"],
        message: "PUBLIC_BASE_URL must use HTTPS when webhook registration is enabled",
      });
    }
    if (
      value.NODE_ENV !== "production" &&
      (value.LOCAL_ADMIN_USERNAME !== undefined) !==
        (value.LOCAL_ADMIN_PASSWORD !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["LOCAL_ADMIN_PASSWORD"],
        message:
          "LOCAL_ADMIN_USERNAME and LOCAL_ADMIN_PASSWORD must both be set or both be omitted",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
