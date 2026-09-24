-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BotType" AS ENUM ('PLATFORM_BOT', 'CONTACT_BOT', 'SUPPORT_LIST_BOT');

-- CreateEnum
CREATE TYPE "SupportedLanguage" AS ENUM ('AR', 'EN');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PlacementStatus" AS ENUM ('SCHEDULED', 'POSTED', 'DELETED', 'FAILED', 'MANUALLY_DELETED', 'PERMISSION_ERROR', 'DELETE_FAILED', 'CHANNEL_NOT_FOUND', 'CANCELED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "EarningType" AS ENUM ('BOT_CREATOR_SHARE', 'CHANNEL_OWNER_SHARE');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'EARNING', 'REFUND', 'RESERVATION', 'RELEASE', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "TransactionPurpose" AS ENUM ('AD_PAYMENT', 'FOOTER_REMOVAL', 'PLATFORM_FORCED_SUBSCRIPTION_REMOVAL', 'FORCED_SUBSCRIPTION_LIMIT_INCREASE', 'WALLET_DEPOSIT', 'WITHDRAWAL', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "WithdrawalMethod" AS ENUM ('TELEGRAM_STARS', 'PAYPAL', 'USDT');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCESS');

-- CreateEnum
CREATE TYPE "ContactMessageDirection" AS ENUM ('INCOMING', 'COPIED', 'REPLY', 'SENT');

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "platformBotId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isTrustedAdvertiser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "telegramBotId" BIGINT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "botUsername" TEXT NOT NULL,
    "botType" "BotType" NOT NULL DEFAULT 'CONTACT_BOT',
    "welcomeMessages" JSONB NOT NULL,
    "footerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "footerTexts" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "forcedSubscriptionsLimit" INTEGER NOT NULL DEFAULT 1,
    "allowPlatformForced" BOOLEAN NOT NULL DEFAULT true,
    "currentTierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_bot_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL DEFAULT 'EN',
    "isExplicit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_bot_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelTelegramId" BIGINT NOT NULL,
    "title" TEXT,
    "username" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "isPlatformCatalog" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivationReason" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_forced_channels" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_forced_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_channel_links" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_channel_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_share_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelOwnerPct" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_share_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_creator_tiers" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minTotalMembers" INTEGER NOT NULL,
    "maxTotalMembers" INTEGER,
    "botCreatorPercentage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_creator_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "budget" INTEGER NOT NULL,
    "cpmRate" INTEGER,
    "durationHours" INTEGER NOT NULL,
    "targetCategories" TEXT[],
    "status" "AdStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_placements" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "botCreatorId" TEXT NOT NULL,
    "channelOwnerId" TEXT NOT NULL,
    "revenueSharePolicyId" TEXT NOT NULL,
    "revenueShareSnapshot" JSONB NOT NULL,
    "scheduledPostAt" TIMESTAMP(3) NOT NULL,
    "scheduledDeleteAt" TIMESTAMP(3),
    "price" INTEGER NOT NULL,
    "status" "PlacementStatus" NOT NULL DEFAULT 'SCHEDULED',
    "postedMessageId" BIGINT,
    "postedAt" TIMESTAMP(3),
    "messageDeletedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "earningSettledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adPlacementId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "EarningType" NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_ledger" (
    "id" TEXT NOT NULL,
    "adPlacementId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reservedBalance" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'STARS',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "purpose" "TransactionPurpose",
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "externalId" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "TransactionPurpose" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XTR',
    "telegramInvoicePayload" TEXT,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "adId" TEXT,
    "botId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "purpose" "TransactionPurpose" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XTR',
    "telegramChargeId" TEXT NOT NULL,
    "telegramInvoicePayload" TEXT,
    "adId" TEXT,
    "botId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "WithdrawalMethod" NOT NULL,
    "encryptedAccountDetails" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "reservationTransactionId" TEXT,
    "finalTransactionId" TEXT,
    "releaseTransactionId" TEXT,
    "externalId" TEXT,
    "approvedById" TEXT,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forced_subscriptions" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forced_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_conversations" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "originalUserId" BIGINT NOT NULL,
    "ownerChatId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "ContactMessageDirection" NOT NULL,
    "sourceChatId" BIGINT NOT NULL,
    "sourceMessageId" BIGINT NOT NULL,
    "targetChatId" BIGINT,
    "targetMessageId" BIGINT,
    "mediaGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_clicks" (
    "id" TEXT NOT NULL,
    "referralLinkId" TEXT NOT NULL,
    "telegramUserId" BIGINT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_relations" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_platformBotId_key" ON "platform_settings"("platformBotId");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "bots_telegramBotId_key" ON "bots"("telegramBotId");

-- CreateIndex
CREATE UNIQUE INDEX "bots_botUsername_key" ON "bots"("botUsername");

-- CreateIndex
CREATE INDEX "bots_ownerId_idx" ON "bots"("ownerId");

-- CreateIndex
CREATE INDEX "bots_botType_idx" ON "bots"("botType");

-- CreateIndex
CREATE INDEX "user_bot_preferences_botId_idx" ON "user_bot_preferences"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "user_bot_preferences_userId_botId_key" ON "user_bot_preferences"("userId", "botId");

-- CreateIndex
CREATE UNIQUE INDEX "channels_channelTelegramId_key" ON "channels"("channelTelegramId");

-- CreateIndex
CREATE INDEX "channels_ownerId_idx" ON "channels"("ownerId");

-- CreateIndex
CREATE INDEX "channels_isPlatformCatalog_idx" ON "channels"("isPlatformCatalog");

-- CreateIndex
CREATE UNIQUE INDEX "platform_forced_channels_channelId_key" ON "platform_forced_channels"("channelId");

-- CreateIndex
CREATE INDEX "platform_forced_channels_isActive_sortOrder_idx" ON "platform_forced_channels"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "bot_channel_links_channelId_idx" ON "bot_channel_links"("channelId");

-- CreateIndex
CREATE INDEX "bot_channel_links_status_idx" ON "bot_channel_links"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bot_channel_links_botId_channelId_key" ON "bot_channel_links"("botId", "channelId");

-- CreateIndex
CREATE INDEX "bot_creator_tiers_policyId_idx" ON "bot_creator_tiers"("policyId");

-- CreateIndex
CREATE INDEX "ads_advertiserId_idx" ON "ads"("advertiserId");

-- CreateIndex
CREATE INDEX "ads_status_idx" ON "ads"("status");

-- CreateIndex
CREATE INDEX "ad_placements_adId_idx" ON "ad_placements"("adId");

-- CreateIndex
CREATE INDEX "ad_placements_channelId_idx" ON "ad_placements"("channelId");

-- CreateIndex
CREATE INDEX "ad_placements_botId_idx" ON "ad_placements"("botId");

-- CreateIndex
CREATE INDEX "ad_placements_status_idx" ON "ad_placements"("status");

-- CreateIndex
CREATE INDEX "ad_placements_settlementStatus_idx" ON "ad_placements"("settlementStatus");

-- CreateIndex
CREATE INDEX "earnings_userId_idx" ON "earnings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_adPlacementId_type_key" ON "earnings"("adPlacementId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "platform_ledger_adPlacementId_key" ON "platform_ledger"("adPlacementId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_externalId_key" ON "transactions"("externalId");

-- CreateIndex
CREATE INDEX "transactions_walletId_idx" ON "transactions"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_telegramInvoicePayload_key" ON "payment_intents"("telegramInvoicePayload");

-- CreateIndex
CREATE INDEX "payment_intents_userId_idx" ON "payment_intents"("userId");

-- CreateIndex
CREATE INDEX "payment_intents_adId_idx" ON "payment_intents"("adId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paymentIntentId_key" ON "payments"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transactionId_key" ON "payments"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_telegramChargeId_key" ON "payments"("telegramChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_adId_key" ON "payments"("adId");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_reservationTransactionId_key" ON "withdrawals"("reservationTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_finalTransactionId_key" ON "withdrawals"("finalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_releaseTransactionId_key" ON "withdrawals"("releaseTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_externalId_key" ON "withdrawals"("externalId");

-- CreateIndex
CREATE INDEX "withdrawals_userId_idx" ON "withdrawals"("userId");

-- CreateIndex
CREATE INDEX "withdrawals_walletId_idx" ON "withdrawals"("walletId");

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE INDEX "forced_subscriptions_botId_idx" ON "forced_subscriptions"("botId");

-- CreateIndex
CREATE INDEX "forced_subscriptions_channelId_idx" ON "forced_subscriptions"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "forced_subscriptions_botId_channelId_isPlatform_key" ON "forced_subscriptions"("botId", "channelId", "isPlatform");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_userId_key" ON "admin_roles"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "contact_conversations_botId_idx" ON "contact_conversations"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_conversations_botId_originalUserId_key" ON "contact_conversations"("botId", "originalUserId");

-- CreateIndex
CREATE INDEX "contact_messages_conversationId_idx" ON "contact_messages"("conversationId");

-- CreateIndex
CREATE INDEX "contact_messages_sourceChatId_sourceMessageId_idx" ON "contact_messages"("sourceChatId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "contact_messages_targetChatId_targetMessageId_idx" ON "contact_messages"("targetChatId", "targetMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_links_userId_key" ON "referral_links"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_links_code_key" ON "referral_links"("code");

-- CreateIndex
CREATE INDEX "referral_clicks_referralLinkId_idx" ON "referral_clicks"("referralLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_relations_referredId_key" ON "referral_relations"("referredId");

-- CreateIndex
CREATE INDEX "referral_relations_referrerId_idx" ON "referral_relations"("referrerId");

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_platformBotId_fkey" FOREIGN KEY ("platformBotId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "bot_creator_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bot_preferences" ADD CONSTRAINT "user_bot_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bot_preferences" ADD CONSTRAINT "user_bot_preferences_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_forced_channels" ADD CONSTRAINT "platform_forced_channels_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_channel_links" ADD CONSTRAINT "bot_channel_links_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_channel_links" ADD CONSTRAINT "bot_channel_links_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_creator_tiers" ADD CONSTRAINT "bot_creator_tiers_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "revenue_share_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_botCreatorId_fkey" FOREIGN KEY ("botCreatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_channelOwnerId_fkey" FOREIGN KEY ("channelOwnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_revenueSharePolicyId_fkey" FOREIGN KEY ("revenueSharePolicyId") REFERENCES "revenue_share_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_adPlacementId_fkey" FOREIGN KEY ("adPlacementId") REFERENCES "ad_placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_ledger" ADD CONSTRAINT "platform_ledger_adPlacementId_fkey" FOREIGN KEY ("adPlacementId") REFERENCES "ad_placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reservationTransactionId_fkey" FOREIGN KEY ("reservationTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_finalTransactionId_fkey" FOREIGN KEY ("finalTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_releaseTransactionId_fkey" FOREIGN KEY ("releaseTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forced_subscriptions" ADD CONSTRAINT "forced_subscriptions_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forced_subscriptions" ADD CONSTRAINT "forced_subscriptions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forced_subscriptions" ADD CONSTRAINT "forced_subscriptions_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_conversations" ADD CONSTRAINT "contact_conversations_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "contact_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_referralLinkId_fkey" FOREIGN KEY ("referralLinkId") REFERENCES "referral_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_relations" ADD CONSTRAINT "referral_relations_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_relations" ADD CONSTRAINT "referral_relations_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
