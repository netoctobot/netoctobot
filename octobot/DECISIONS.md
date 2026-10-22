# Locked decisions

These decisions are the source of truth for implementation. They supersede conflicting details in `PROJECT_BLUEPRINT.md`.

## Scope

- Ads start as a small fixed-price service (see "Ads: fixed price v1"). Telegram Stars, split invoices, CPC, and commercial CPM stay deferred. The CPM measurement lab is a separate test service (see "CPM measurement lab").
- User-facing bot types from day one: `CONTACT_BOT` and `SUPPORT_LIST_BOT`, plus the central platform bot.
- `SUPPORT_LIST_BOT` runs one exchange list per bot. Membership, acceptance, disable reasons, list shape, and schedule are stored apart from `BotChannelLink`. Contact-bot linking and messaging stay unchanged. Publishing uses PostgreSQL cycles as the source of truth and BullMQ only to deliver and delete posts. A unique publication row or job id does not prove a Telegram send happened once: the row is marked `SENDING` before the request, and a timeout or a crash before `messageId` is stored becomes `UNCONFIRMED` and is not sent again. The owner is told. A stored message id is required before a delete can be queued. Delete time is the successful send time plus the keep duration. Schedule gaps include a 30-minute send-delay allowance. Changing the schedule or time zone skips unstarted publish cycles and leaves delete jobs for posts already sent. Resume skips pending cycles whose time has passed instead of publishing that backlog. Pause stops new publishes and keeps delete jobs. A deactivated or deleted support-list bot unloads its chat runtime as before; delete jobs can still use the saved token.

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

- Shares per ad placement: channel 50%, bot owner's account 15–25%, platform the rest. An account that is both the channel-share beneficiary and the bot owner receives both shares.
- The bot-owner rate is per account, never per bot, and does not rise because an account creates more bots. Default 15%; an admin may raise it to 20% or 25% by a documented decision (reason, admin, date) against written criteria that do not depend on measured views. Changes apply to new placements only. Automatic tiers from views wait for the CPM lab to succeed.
- Each user has one wallet with a separate balance per currency. Balances in different currencies are never summed as one amount. Withdrawals use the single wallet, per currency.
- Wallet balance states per currency: pending, available, and reserved for a withdrawal request.
- Create the wallet lazily on the first earnings-eligible event for that user:
  - first bot create, or
  - first placement where the user's account is the verified channel-share beneficiary. Linking a channel alone creates no wallet and no entitlement.
- Later bots or channels for the same user reuse that single wallet; never create a second one.
- Money is calculated with exact arithmetic, never floating point: integer amounts in each currency's smallest unit, using that currency's decimal places from the admin-managed currency list (for example USD 2, KWD 3).
- Rounding: the channel and bot-owner shares are each rounded down to the currency's smallest unit; the platform share is the placement amount minus those shares. The rounding difference goes to the platform, is disclosed in the terms, and is recorded per placement. Shares always sum exactly to the placement amount.

## Platform forced-subscription channels

- Multiple platform channels via a catalog (`PlatformForcedChannel` + `Channel.isPlatformCatalog`), not a single env channel id.
- Do not copy catalog channels into `ForcedSubscription` when a user bot is created.
- Every bot reads the live catalog: current active and inactive platform channels, not a snapshot from create time.
- Active catalog channels apply to `PLATFORM_BOT`, `CONTACT_BOT`, and `SUPPORT_LIST_BOT`. `allowPlatformForced` is historical data and does not exempt a bot.
- The platform bot checks membership with `getChatMember`. A catalog channel can be activated only when that bot’s returned status is `administrator` or `creator`, and a join URL exists. Public channels use `https://t.me/username`. Private channels need an invite link created or exported by the platform bot; activation is refused when that link cannot be produced.
- Adding a channel to the catalog records the dashboard admin who added it. It does not assign `OWNER_TELEGRAM_ID` as the channel owner and does not change `ownerId` or `telegramOwnerId` on an existing channel. A new channel row stores a Telegram creator only when `getChatAdministrators` returns one, and a platform `User` owner only when that creator already has an account.
- Owner-forced subscriptions (non-platform) still use `ForcedSubscription` as today and are not copied from the catalog or enforced by this gate.
- The gate covers private messages, commands, and callbacks, including `/start`. It allows join links, `forced:check`, and the language callbacks. Network failures and an inability to check are a short retry, not a missing subscription. An inactive contact bot still tells visitors it is stopped before the gate. Web admin routes, `my_chat_member`, channel posts, and scheduled workers are outside the gate.

## Channel ownership

- Any Telegram channel creator, or administrator with `can_promote_members`, can link a channel to a platform-managed bot; creator status is not required, and they do not need to own that bot.
- Linking is event-driven from each bot’s `my_chat_member` update when it becomes a channel administrator, and forwarding is available immediately after choosing “Add channel” or opening the exact bot’s private chat. The user can forward a channel post or submit the channel’s complete username/link/ID without first pressing a separate recovery button.
- Manual channel references are accepted only while that bot-scoped flow is active. A forward must have a Telegram-attested channel origin, and text must consist solely of one channel reference; mentions embedded in arbitrary text are never used as channel identity.
- The add-to-channel link suggests post, edit, delete, and invite rights. Linking requires only administrator status plus post and delete rights; edit and invite remain optional.
- The platform records the linking user as the channel adder and separately snapshots the Telegram ID of the current `creator`.
- A `my_chat_member` update immediately inactivates only that bot/channel link when the bot is removed or loses post/delete rights. The verified linker is notified when Telegram permits a private message. Restored rights never reactivate an inactive link; a qualified administrator must explicitly run the bot-scoped link flow again.
- Channel-link feedback uses the user’s `UserBotPreference` for that specific bot. Success is a separate message deleted after five seconds, then the same dashboard message returns to that bot’s home view.
- “My channels” is always scoped to the bot where the button was pressed. The platform bot shows only that user’s links to the platform bot; each sub-bot shows only links to itself. Both surfaces use the same list and link-level actions.
- `Channel.ownerId` is the platform user who linked the channel and manages the link. Linking rights give no automatic financial entitlement and no access to another beneficiary's wallet.
- `Channel.telegramOwnerId` stores the current Telegram owner and is refreshed on verified links.
- The channel-share beneficiary is the Telegram owner snapshotted on each placement at booking. Delegating the share to another beneficiary is out of v1.
- The service runs without requiring the Telegram owner to register or consent. Verifying the beneficiary (matching a platform account to the snapshotted Telegram owner) and paying out are a separate process.
- If the beneficiary is not resolved, the channel share stays pending and tied to that placement; it never goes automatically to the linker or to the platform.
- A later ownership change does not automatically reassign historical entitlements. Historical placements keep their snapshotted beneficiary and revenue policy.

## User-managed lifecycle

- Bot, channel, and bot-channel-link status are separate. New service work is eligible only when the bot and channel are active and not deleted and the link is `ACTIVE`.
- User deletion is always a soft delete: rows and historical relations remain, but deleted resources are hidden from user lists and excluded from new services.
- Deleting a channel inactivates all of its bot links. Re-adding the channel reuses its row but activates only links that are explicitly verified again.
- Deactivating a user bot preserves every channel-link status and setting. An inactive contact bot retains a dormant runtime/webhook solely to tell visitors that the owner stopped it and link them to the platform bot; it must not relay messages or perform management work. Other bot types unload their runtime and webhook. Deletion remains destructive to current service eligibility and inactivates links. Neither action changes Telegram administrator membership.
- Reactivating a bot verifies its saved active links against current Telegram membership and post/delete permissions before restoring runtime services. Valid links resume without relinking; links that actually lost Telegram membership or permissions become inactive. Legacy links marked `BOT_DEACTIVATED` are restored when verification succeeds.
- Channel management inside a contact bot is scoped to that bot’s `BotChannelLink`. Deactivate/remove actions must not alter the channel row or another bot’s link; activation verifies the contact bot’s current Telegram permissions.
- The platform bot cannot be managed through the user “My bots” lifecycle.

## Ads: fixed price v1

### Settled

- Scope: small fixed-price ad orders. CPC is out of scope. Commercial CPM waits for lab results and an explicit decision. Fixed-price ads and bot-owner rates never depend on the lab.
- Agreement and payment happen with the admin outside the bot. The bot does not create purchase offers for digital services in currencies other than Stars, or display links, buttons, or instructions directing users to external payment. It displays recorded amounts for existing orders, refunds, and wallets as account information, without purchase or payment actions. This is a product-design distinction, not a claim of explicit approval by Telegram.
- Nothing is published until the admin confirms the money actually arrived; a receipt image is not proof. No forced top-up and no forced Stars. Credit cards are not accepted in v1.
- A payment method is accepted only with written terms: how arrival is verified, its settlement period, and its chargeback risk. Risk is reduced, never promised to be zero.
- Every order is recorded before publishing. No order record, no publish.
- Channels are assigned to one ads bot only: the first one linked. Transfer requires confirmation by the channel's Telegram owner and applies to new placements only.
- FX and transfer fees are paid by the beneficiary, except where a policy below assigns them to the platform. They are shown before paying or withdrawing and charged once.

#### Currencies

- USD may be the reference pricing unit, but every amount is stored in its original currency with an ISO code (`USD`, `KWD`, `SAR`...). Converted values never replace original values.
- Accepted currencies are an admin-managed list, each with its decimal places. No automatic exchange-rate feed in v1.
- Stored separately: order price and currency; payment actually received, its currency, method, reference, proof, confirming admin, and time; agreed exchange rate and the time it was fixed (only when currencies differ); each fee, its currency, and who bears it; how much of the order the payment covers and any remaining difference; the amount allocated to each placement; the refund amount and currency.
- A shortfall is recorded as a remaining difference. No publishing until it is paid or the admin explicitly reduces the order, with the decision recorded.
- The refund amount and currency are fixed before payment and are never recalculated at a new exchange rate.
- Fixing the refund amount protects the advertiser from rate changes. It does not protect the platform from FX loss or gain if it converts funds; the platform stays bound to the agreed amount and currency.

#### Placement snapshot

- Each placement gets its own snapshot when approved and booked: channel, executing bot, channel-share beneficiary identity, bot owner, amount and currency, share rates, duration, approved content, and refund amount and currency.
- Later changes to rate, ownership, or channel assignment never rewrite a snapshot. A change before publishing is explicit, recorded, and re-approved where needed.
- Approved content versions and approval times are kept. Authorized edits are recorded with their approval.

#### Earnings availability

- Earnings show as pending while conditions are open. They become available only after all of: the commitment is proven completed, the complaint window has ended, the payment settlement period has ended, no review on the placement is open, and the beneficiary is verified.
- A problem is handled as soon as it is found, without waiting for the complaint window to end.
- The end of the complaint window does not guarantee no later disputes and does not cancel legal obligations or fraud handling. Late complaints are still reviewed.

#### Commitment status

- Each placement has one of: completed (proven), not completed (proven), or cannot be verified.
- Completed means the approved content was published in the agreed channel at the agreed time and stayed for the agreed duration without unauthorized changes. An `edited_channel_post` update or hash change alone is not a breach; the current content is compared with the approved and authorized versions. Approved, recorded edits are not a breach.
- An advertiser-requested early deletion after a correct publication is classified under its own Remedy policy, not as "not completed".
- Not proving channel responsibility does not prove the commitment was completed and does not by itself justify paying out earnings.
- Cannot be verified: the placement stays in review. Closing a review requires a stated reason, evidence, and an explicit decision. Nothing is paid out or cancelled automatically because evidence is missing or a reply deadline passed.
- Loss of bot access does not make a case impossible; it goes to review with the evidence available.

#### Remedy

- After a correct publication, an advertiser-requested early deletion is an agreed early termination, not a channel breach. The full fixed price remains payable and shares are earned under this policy, subject to the normal settlement, review, and beneficiary-verification conditions. This must be disclosed before payment.
- Completed, then a refund granted by the admin as a commercial courtesy: the refund is funded by the platform and does not cancel the entitlements of parties that fulfilled their commitment.
- Advertiser content removed for violating terms: handled under the content policy.
- Not completed (any cause other than the above): the advertiser is refunded the placement's full fixed refund amount, and a replacement happens only with the advertiser's consent. No ad shares are distributed for that placement to the channel, the bot owner, or the platform. Credited shares not yet withdrawn are reversed with entries linked to the placement; the original records are not changed. This cancels shares of an incomplete placement; it is not a penalty and not proof of channel responsibility.
- The original payment fee is not refunded, except on platform error, where the platform bears all fees. This is disclosed before payment.
- The advertiser's refund never waits for the responsibility decision.

#### Responsibility

- Determined separately from the commitment status. It affects the refund transfer fee and actions toward the party in breach.
- Platform: our records show a deletion or edit by our system that breaks the agreement, or a wrong publish. Advertiser: a recorded request. Channel: evidence linking a channel admin's action to this breach (an admission, or a "Recent Actions" record showing the deletion or edit). Otherwise: undetermined.
- Being unable to verify, or not knowing the cause, proves no one's responsibility.
- Not evidence of channel responsibility on their own: missing post, bot permission removal (it proves a permission change and who made it, via `from` in `my_chat_member`, not who deleted the post), or no reply before the deadline (it allows an explicit decision on existing evidence; it creates no new evidence).
- A channel harmed by a platform error may receive separate compensation by a documented decision, at the platform's cost. It is not automatic, not automatically equal to the share, and not an ad commission.

#### Refund funding and recovery

- The advertiser's right and recovery from responsible parties are separate. A channel that fulfilled its commitment never bears a platform error.
- Refund transfer fee: when channel responsibility is proven, it is deducted from that channel's earnings existing at the time of the decision, in the same currency; otherwise the platform bears it. It never extends to future earnings. The reason and amount are recorded and it is charged once per refund.
- After shares were withdrawn: no automatic deduction from future earnings and no negative balance in v1. The platform funds the approved refund and records the loss and the amounts already paid out. A channel with proven breach is suspended from new ads pending review.
- No claim against a user without an explicit approved policy and documented basis.
- Corrections are reversing ledger entries that reference the original. The original record is never deleted or edited.

#### Cancellation and deletion

- Not optional cancellations, each with its own policy: cancellation before publishing, platform error, and advertiser content that violates the agreement or terms.
- End of accounting (the agreed window ended) and deletion completed (the post is actually gone) are separate states. No extra amount is charged because a post stayed past the window.
- Deletion follow-up stays open until the post is actually deleted or the case is closed with records. A short duration helps scheduling but does not guarantee deletion.
- Late deletion responsibility follows cause and evidence: a platform outage is never charged to the channel; a channel blocking or refusing deletion it agreed to is reviewed as a possible breach.

#### Visibility in the bot

- Required in v1 and not deferred with web dashboards.
- A beneficiary sees only their own: earnings and balances per currency; pending, available, and reserved-for-withdrawal amounts; transaction history; withdrawal requests and their statuses; and the reason a balance is held, limited to what concerns them.
- Access is permission-checked per account. The channel linker does not automatically see another beneficiary's wallet or earnings.
- An advertiser sees a summary of their existing orders, execution status, and refund status, with recorded amounts as account information and without purchase or payment actions.

### Initial settings (adjustable)

- Bot-owner rate raise criteria (numbers set before implementation): active unique channels linked to the account, placements completed without breach in the last 90 days, value of completed placements, no proven breach. `getChatMemberCount` may be a secondary criterion only. Lowering uses the same process, for new placements only.
- Channel transfer cooldown: 30 days between transfers.
- Withdrawals: monthly window on days 1–5 with a minimum of 10 USD, or anytime with a minimum of 50 USD. Minimums are set per currency.
- Settlement before earnings become available: cash 0 days, local bank transfer 7 days after arrival, e-wallets per provider terms. These reduce chargeback risk; they do not end it.
- Complaint window: 7 days after the placement window ends.
- Platform reserve: 5% of the platform share, held per currency. It reduces exposure; it does not guarantee coverage.
- New advertisers start with a small spend limit that the admin raises.
- Breach deadlines: the channel is notified at once and has 48 hours to reply; decision within 72 hours of opening review; refund within 5 business days of the decision.
- Missing-post check: two checks 10 minutes apart.
- Cancellation before publishing: full placement price refunded; original payment fee not refunded unless the cause is a platform error.
- Platform error: full refund, or republish with the advertiser's consent. The platform bears all fees; nothing is charged to the channel.
- Advertiser content: reviewed before publishing. If a violation appears after publishing and removal is required, it is handled like an advertiser-requested deletion. If the violation was obvious and we approved it by mistake, it is a platform error.
- Default duration 24 hours; automated duration under 48 hours (`deleteMessage` limit). Admin alert if deletion is not complete 1 hour after the window ends; urgent alert 6 hours before the 48-hour limit; then manual deletion with the actual time recorded.
- Financial records: append-only, never deleted. Initial retention 7 years; this is not a verified legal requirement and must be checked with a local accountant or lawyer.

## CPM measurement lab

### Settled

- A real test service, automated where possible, in the same repo and package, with its own entrypoint and exactly one replica. Fixed-price ads do not depend on it.
- Resources: two phone numbers, two real channels (about 100 and about 350 subscribers), extra test channels, and the project owner for manual steps and alerts.
- The bot is tested first via MTProto `channels.getMessages` with its token and compared with a user account using `increment=false`. A single `views` value is not enough.
- Load and failure tests run only in test channels. Real channels get a few posts agreed in advance.
- Never provoke bans or limits; never rotate accounts or IPs to get around them. Results separate real Telegram errors from locally injected ones.
- Readings are stored as received and never edited. A drop in the counter is an event to explain, not automatic proof of bad data.
- Errors are recorded by their documented meaning only. `USER_DEACTIVATED` means deleted or deactivated, cause unknown; it is not called a punitive ban without further evidence.
- A lock prevents parallel use of the lab's own authorization session (`AUTH_KEY_DUPLICATED`). The account's sessions on its owner's devices are separate and are not duplicates.
- Reports separate channel count, post count, request count, and read frequency. Results are not generalized to scale not tested, and the real channels' size does not prove commercial readiness.
- The Telegram counter is not the number of human viewers, and reading availability does not prove CPM accounting accuracy.
- Lab logs are append-only during retention, then deleted under a written policy, separate from financial records.

### Initial settings (adjustable)

- Real channels: 1–3 posts per day on an agreed schedule. Channel B is used for audience comparison, counter growth, and forwarding.
- At least 3 closed test channels, one private.
- Minimum 14 days. Load steps 10, 25, 50, 100 tracked posts, two days each, in test channels; one step down at the first real `FLOOD_WAIT`.
- Stop the account and alert on: restriction evidence, revoked session, `FLOOD_WAIT` over 1 hour or 3 times a day, data-integrity violation, lock failure. Switch to the second account only for a revoked session or network failure.
- Recommendation criteria: ≥99% of posts with a reading within the last 20 minutes (availability, not accuracy); no counter change with `increment=false`; 100% deletion detection; zero duplicate readings; every drop explained or shown as unexplained; no restriction evidence.
- Per post: age of the last reading before the window end, gap to the end, first reading after it. These two readings form an estimated range only if the counter shows no significant drops or corrections; otherwise show the data, gap, and uncertainty without a range.
- Retention: raw details 90 days after the final report, then deleted by a recorded job; key evidence 2 years; reports for the life of the project. Reports show row counts, size, and daily growth.

### Hypotheses (require testing)

- Bot reads views: returned, updates over time, matches the user account, stable under repeated reads, across permissions and public and private channels.
- Reliance on personal accounts depends on that result: full success means comparison only; partial means fallback only for failures; failure means CPM relies on accounts and is assessed on that basis.
- `increment=false` does not raise the counter.
- The response of `channels.getMessages` for a known deleted message id.
- Lost message id (send succeeded, response lost or id not saved): whether `channel_post` helps; neighbouring-id checks only in authorized test channels, with at most 20 ids per case and a request limit; content-and-time matching is not conclusive when several results match or doubt remains. Until verified: no republish and no financial accounting. Without a reliable path, manual review stays the approved method.
- Forwarded copies' views are documented to count; we test delay and whether origin and copies can be told apart.
- Effect of the roughly 4-day recount on CPM windows.
- Highest safe load, found only by measurement.
- Handling of injected `FLOOD_WAIT`, session loss, timeout, and failed id save.
- Whether a bot can read the channel admin log via MTProto; otherwise the channel provides it.
- Whether negotiating via a human account inside Telegram, then paying outside, is acceptable to Telegram (undocumented; the safe limit is the no-outside-payment-in-bot rule).

## Deferred (not built in v1)

- Stars payments and pricing (USD ÷ 0.013).
- Split invoices and non-withdrawable ad credit.
- Automatic bot-owner tiers from views.
- Commercial CPM.
- USDT or Crypto Pay.
- Automatic exchange rates.
- Delegating the channel share to a beneficiary other than the Telegram owner.
- No models or logic are built for these just because they were discussed.
## Schema

- Corrected models live in `backend/prisma/schema.prisma`. Do not copy the blueprint schema as-is.
- `BotType`: `PLATFORM_BOT`, `CONTACT_BOT`, `SUPPORT_LIST_BOT`.
- `PlatformSettings` is a singleton pointing at the platform bot.
- Contact conversations have no `userId`; visitors are Telegram IDs only.
- The bot-owner rate is stored per account and snapshotted per ad placement; `Bot.currentTierId` is no longer the source of the rate.
- Existing ad and wallet models predate the ads decisions and must be reviewed against them before any ads logic is written. Models for Stars or split invoices are not used or extended in v1.
- `Channel.isPlatformCatalog` plus `PlatformForcedChannel` hold multiple platform forced-subscription channels.
- Placement message deletion time is `AdPlacement.messageDeletedAt`, not a row soft-delete.

## Web admin dashboard

- The platform owner dashboard gains only what fixed-price ads v1 needs: recording orders, confirming received payments, approving content, reviewing commitment status and breaches, beneficiary verification, and manual deletion follow-up. Full web dashboards for advertisers, bot creators, and channel owners stay deferred; their in-bot visibility is not (see "Visibility in the bot").
- Contact conversations are not shown; they are not stored.
- Sign-in uses a username and password for a single `DashboardAdmin` account. The password is stored as a scrypt hash. The session is an HttpOnly cookie and is not tied to a Telegram user, `/start`, or `OWNER_TELEGRAM_ID`. There is no public registration and no second dashboard account. A local development account is created once from `LOCAL_ADMIN_USERNAME` and `LOCAL_ADMIN_PASSWORD` when `NODE_ENV` is not `production` and no admin row exists; those variables are ignored in production and an existing password is never reset on startup. Assigning other admins stays deferred, and blueprint permission names such as `MANAGE_ADS` are not introduced.
- Web language is `WebLocalePreference`, one row per dashboard admin, separate from `UserBotPreference`. The dashboard never reads or writes bot language. Before sign-in the choice lives in the `octobot-web-locale` cookie. After sign-in the saved account preference is restored and copied to that cookie. An explicit choice is never replaced by a Telegram `language_code` or by the browser language. With no cookie and no account preference, the dashboard uses English.
- The UI is a Next.js App Router app. Arabic is RTL and English is LTR. Interface copy, alerts, and validation come from `frontend/messages/ar.json` and `en.json`. User-authored content is shown as stored.
- The dashboard reads users, bots, channels, support-list publishing, broadcast campaigns, and audit records. It can disable a support-list membership through `disableByAdmin`, and it can add, remove, activate, or reorder `PlatformForcedChannel` rows. Catalog changes do not copy rows into `ForcedSubscription`. A broadcast sends one deduplicated delivery per recipient without changing bot, channel, or link state. Audience kinds are channels (`BotChannelLink` and `SupportListMembership`), bot users with a registered private-chat relationship on the sending bot, and deduplicated bot owners reached through the platform bot when possible or another selected bot they actually used. Private-chat registration happens on incoming private interaction before the forced-subscription gate and does not store message content. It does not run bot or channel lifecycle actions. Forced subscription is enforced in Telegram chats by the platform bot, not by the web routes.
- Broadcast content (phase 2): campaigns may be plain text or one uploaded media item with optional caption and inline URL buttons. Upload validation uses magic-byte detection and per-kind Telegram/product size limits; storage keys are server-generated. Admin preview and confirm show the full content (media via an authenticated `/admin/broadcasts/media/:id/content` route). Orphan uploads expire after 24 hours; campaign media files are deleted 48 hours after `endedAt` only when no `PENDING` deliveries remain and no other campaign references the asset. Linked uploads cannot be deleted via the orphan DELETE route. A successful Telegram send does not depend on persisting per-bot `file_id` cache rows. If delivery persistence fails after a likely send, the delivery becomes `UNCERTAIN` and is not blindly retried.
- Owner bot broadcast: bot owners start a flow inside their bot (all user-bot types) that creates normal `BroadcastCampaign` rows and uses the same BullMQ send queue as the admin dashboard. Access is enforced server-side on every step (`initiatorBotId`, `createdByUserId`, `createdByKind = BOT_OWNER`); owner identity and bot access are re-checked on callbacks and owner messages, not only draft presence. The owner UI skips content-type selection: after audience choice the bot asks for the post, then shows a live preview on the dashboard message (text or media with link buttons plus owner-only control rows). Owner media is limited to photo, animation, and video (5 MB video cap); adding media to a text post moves the text to the media caption. Draft state lives in Redis with a TTL; content is cleared after publish. `publishNonce` is unique in PostgreSQL so retries enqueue remaining deliveries without creating a duplicate campaign. Owner campaigns re-check bot `isActive` before each send; admin campaigns are unchanged.
- Broadcast Telegram delete (phase 3): `BroadcastDelivery.status` stays `SENT`; per-message delete state lives on `BroadcastDeliveryMessage` (`NONE` through `UNAVAILABLE`). `deleteRequested` on the campaign stops remaining sends and queues delete work for every future `SENT` row. Workers claim `PENDING` atomically to `IN_PROGRESS` with a lease; expired leases are reclaimable. A periodic reconciler (not only boot) promotes `SENT` messages still at `NONE` when delete was requested and re-enqueues `PENDING` rows if Redis enqueue failed. `deletedAt` is set only on successful `DELETED`; `deleteSettledAt` records terminal `GONE`/`UNAVAILABLE`. Deletes use the sending bot (`delivery.botId`) and always attempt `deleteMessage`, classifying Telegram errors (`message to delete not found` → `GONE`, `message can't be deleted` → `UNAVAILABLE`). Legacy sends without message rows are backfilled from `telegramMessageId`/`recipientTelegramChatId` at delete time.
