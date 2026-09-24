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
- A `User` is created when someone uses the platform bot (`/start`). No wallet at that point.

## Revenue share vs wallet

- Creator tier is computed per bot (sum of members on that bot’s active channel links).
- Each user has one wallet. Earnings from all bots and channels credit that wallet. UI can aggregate and break down; withdrawals use the single wallet.
- Create the wallet lazily on the first earnings-eligible event for that user:
  - first bot create, or
  - first channel link as channel owner.
- Later bots or channels for the same user reuse that single wallet; never create a second one.
- Remainder Stars after integer percentage splits go to the platform.

## Platform forced-subscription channels

- Multiple platform channels via a catalog (`PlatformForcedChannel` + `Channel.isPlatformCatalog`), not a single env channel id.
- Catalog channel rows are owned by the Owner account.
- Do not copy catalog channels into `ForcedSubscription` when a user bot is created.
- Every bot reads the live catalog: current active and inactive platform channels, not a snapshot from create time.
- Owner-forced subscriptions (non-platform) still use `ForcedSubscription` as today.
- If a bot owner removes platform forced subscription (later via `PLATFORM_FORCED_SUBSCRIPTION_REMOVAL`), record that opt-out on the bot (e.g. `allowPlatformForced = false`). The shared catalog is unchanged for other bots.

## Schema

- Corrected models live in `backend/prisma/schema.prisma`. Do not copy the blueprint schema as-is.
- `BotType`: `PLATFORM_BOT`, `CONTACT_BOT`, `SUPPORT_LIST_BOT`.
- `PlatformSettings` is a singleton pointing at the platform bot.
- Contact conversations have no `userId`; visitors are Telegram IDs only.
- Creator tier is stored on `Bot.currentTierId`, not on `User`.
- `Channel.isPlatformCatalog` plus `PlatformForcedChannel` hold multiple platform forced-subscription channels.
- Placement message deletion time is `AdPlacement.messageDeletedAt`, not a row soft-delete.
