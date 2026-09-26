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
- Bootstrap the Owner user from `OWNER_TELEGRAM_ID`; this does not create a wallet.
- Webhook registration can be disabled for local development, but must use HTTPS when enabled.

## Users and contact visitors

- Contact-bot visitors do not get a SaaS `User` or wallet. Contact messages, conversations, and reply mappings are never stored in PostgreSQL or Redis.
- Visitor messages are forwarded natively to the owner. Owner replies are copied back to hide the owner’s identity. Replies route from Telegram’s forward origin; privacy-hidden visitors receive a bot-authored anchor containing their Telegram ID.
- Media albums may be buffered in process memory for about one second only, then forwarded as one Telegram album. Successful deliveries receive a best-effort 👍 reaction; failures receive an explicit error and no success signal.
- A contact-bot owner sees an owner-only `/start` panel for welcome messages and that bot’s channel links. Visitors see only the localized welcome and never receive owner callbacks.
- Welcome content is stored per supported language. View/edit/reset language choices are generated from the central language registry; reset restores the default for only the selected language. Interface and visitor welcome language default from each Telegram user’s current `language_code`.
- A `User` is created when someone uses the platform bot (`/start`). No wallet at that point.
- The platform bot keeps one dashboard message and one active flow per user in Redis.
- `/start`, `/cancel`, Home, or entering another section cancels stale flow state and edits the existing dashboard instead of leaving old prompts behind.

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

## Channel ownership

- Any Telegram channel administrator or creator can link a channel to a platform-managed bot; they do not need to own that bot.
- Linking is event-driven from each bot’s `my_chat_member` update when it becomes a channel administrator, and forwarding is available immediately after choosing “Add channel” or opening the exact bot’s private chat. The user can forward a channel post or submit the channel’s complete username/link/ID without first pressing a separate recovery button.
- Manual channel references are accepted only while that bot-scoped flow is active. A forward must have a Telegram-attested channel origin, and text must consist solely of one channel reference; mentions embedded in arbitrary text are never used as channel identity.
- The add-to-channel link suggests post, edit, delete, and invite rights. Linking requires only administrator status plus post and delete rights; edit and invite remain optional.
- Linking requires the adding user to be a Telegram administrator or creator. The platform records that user as the channel adder and separately snapshots the Telegram ID of the current `creator`; future earnings policy will decide how those identities affect permissions and revenue.
- A `my_chat_member` update immediately inactivates only that bot/channel link when the bot is removed or loses post/delete rights. The verified linker is notified when Telegram permits a private message. Restored rights never reactivate an inactive link; the creator must explicitly run the bot-scoped link flow again.
- Channel-link feedback uses the user’s `UserBotPreference` for that specific bot. Success is a separate message deleted after five seconds, then the same dashboard message returns to that bot’s home view.
- “My channels” is always scoped to the bot where the button was pressed. The platform bot shows only that user’s links to the platform bot; each sub-bot shows only links to itself. Both surfaces use the same list and link-level actions.
- `Channel.ownerId` identifies the platform user who added the channel for account management. `Channel.telegramOwnerId` stores the current Telegram creator and is refreshed on verified links.
- Historical ad placements keep their snapshotted `channelOwnerId` and revenue policy.
- The first successfully linked channel lazily creates the owner’s single wallet.

## User-managed lifecycle

- Bot, channel, and bot-channel-link status are separate. New service work is eligible only when the bot and channel are active and not deleted and the link is `ACTIVE`.
- User deletion is always a soft delete: rows and historical relations remain, but deleted resources are hidden from user lists and excluded from new services.
- Deleting a channel inactivates all of its bot links. Re-adding the channel reuses its row but activates only links that are explicitly verified again.
- Deactivating a user bot preserves every channel-link status and setting. An inactive contact bot retains a dormant runtime/webhook solely to tell visitors that the owner stopped it and link them to the platform bot; it must not relay messages or perform management work. Other bot types unload their runtime and webhook. Deletion remains destructive to current service eligibility and inactivates links. Neither action changes Telegram administrator membership.
- Reactivating a bot verifies its saved active links against current Telegram membership and post/delete permissions before restoring runtime services. Valid links resume without relinking; links that actually lost Telegram membership or permissions become inactive. Legacy links marked `BOT_DEACTIVATED` are restored when verification succeeds.
- Channel management inside a contact bot is scoped to that bot’s `BotChannelLink`. Deactivate/remove actions must not alter the channel row or another bot’s link; activation verifies the contact bot’s current Telegram permissions.
- The platform bot cannot be managed through the user “My bots” lifecycle.

## Schema

- Corrected models live in `backend/prisma/schema.prisma`. Do not copy the blueprint schema as-is.
- `BotType`: `PLATFORM_BOT`, `CONTACT_BOT`, `SUPPORT_LIST_BOT`.
- `PlatformSettings` is a singleton pointing at the platform bot.
- Contact conversations have no `userId`; visitors are Telegram IDs only.
- Creator tier is stored on `Bot.currentTierId`, not on `User`.
- `Channel.isPlatformCatalog` plus `PlatformForcedChannel` hold multiple platform forced-subscription channels.
- Placement message deletion time is `AdPlacement.messageDeletedAt`, not a row soft-delete.
