ALTER TABLE "channels"
ADD COLUMN "telegramOwnerId" BIGINT;

UPDATE "channels"
SET "telegramOwnerId" = "users"."telegramId"
FROM "users"
WHERE "users"."id" = "channels"."ownerId";

ALTER TABLE "channels"
ALTER COLUMN "telegramOwnerId" SET NOT NULL;

CREATE INDEX "channels_telegramOwnerId_idx"
ON "channels"("telegramOwnerId");
