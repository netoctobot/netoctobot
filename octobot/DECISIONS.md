# Locked decisions

These decisions are the source of truth for implementation. They supersede conflicting details in `PROJECT_BLUEPRINT.md`.

## Scope

- Ads, Telegram Stars, earnings settlement, and withdrawals are deferred past the first build slices.
- User-facing bot types from day one: `CONTACT_BOT` and `SUPPORT_LIST_BOT`, plus the central platform bot.
- Support-list runtime logic is deferred. The type must exist in the schema and create flow; the handler stays a stub.

## Platform bot

- The main bot is a real `Bot` row (`BotType.PLATFORM_BOT`).
- It is not offered in the “create bot” UI.
- `PlatformSettings` is a singleton that points at `platformBotId`.
- On boot: read `BOT_TOKEN` from env, call `getMe`, upsert the row, register the webhook.

## Users and contact visitors

- Contact-bot visitors do not get a SaaS `User` or wallet. Conversations use Telegram `originalUserId` only.
- A `User` (and wallet) is created when someone uses the platform bot (`/start`).

## Revenue share vs wallet

- Creator tier is computed per bot (sum of members on that bot’s active channel links).
- Each user has one wallet. Earnings from all bots and channels credit that wallet. UI can aggregate and break down; withdrawals use the single wallet.
- Remainder Stars after integer percentage splits go to the platform.

## Platform forced-subscription channels

- Multiple platform channels via a catalog (`PlatformForcedChannel` + `Channel.isPlatformCatalog`), not a single env channel id.
- Catalog channel rows are owned by the Owner account.
- On user-bot create, every active catalog channel is copied as `ForcedSubscription` with `isPlatform = true`.
- Later payment (`PLATFORM_FORCED_SUBSCRIPTION_REMOVAL`) removes all platform forced subscriptions from that bot at once (`allowPlatformForced = false`). The catalog is unchanged for new bots.

## Schema timing

- Corrected Prisma models (types, catalog, single wallet, relation fixes) land in step 2. This repo bootstrap does not copy the blueprint schema as-is.
