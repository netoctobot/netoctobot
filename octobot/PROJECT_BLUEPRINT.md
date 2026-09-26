📦 الحزمة الكاملة النهائية لمشروع تيليجرام SaaS (الإصدار 2.5 – جاهزة للنسخ إلى Cursor)

هذه النسخة معتمدة بعد دمج جميع الملاحظات والمراجعات الهندسية.

لا تبدأ التنفيذ مباشرة؛ اقرأ "تعليمات البداية لـ Cursor" أولاً.



⚠️ تعليمات البداية لـ Cursor (إلزامية)

لا تنفذ المشروع الآن.

أول مهمة لك هي إجراء تدقيق هندسي كامل للمواصفات التالية.



اعتبر هذه الوثيقة المصدر الوحيد للحقيقة (Single Source of Truth).

قم بتحليلها كاملة، ثم قدّم تقرير تدقيق يتضمن:



أخطاء مخطط Prisma والعلاقات الناقصة.



العلاقات العكسية المفقودة.



الفهارس والقيود الفريدة المفقودة.



مشاكل الاتساق المالي.



انتقالات الحالة غير المكتملة.



ضمانات Idempotency المفقودة.



افتراضات Telegram Bot API التي يجب التحقق منها مقابل التوثيق الرسمي الأحدث.



ثغرات أمنية.



مشاكل اتساق الطوابير/العمال.



قواعد عمل غامضة تؤثر على المعمارية أو قاعدة البيانات أو المدفوعات أو المحاسبة.



غموض في ملكية البوت/القناة.



معمارية Webhook/تشغيل البوتات الديناميكية غير محددة.



منطق تسوية الأرباح/المحفظة غير مكتمل.



منطق معالجة السحب غير مكتمل.



قواعد RBAC غير محددة.



لكل مشكلة، اذكر:



الخطورة: BLOCKER / HIGH / MEDIUM / LOW



الموقع في المواصفات



المشكلة



لماذا هي مهمة



الحل المقترح



هل تتطلب موافقة؟



لا تعدّل الكود أو المخطط الآن.

لا تخترع متطلبات جديدة.



إذا كانت المشكلة تؤثر على:



مخطط قاعدة البيانات



المحاسبة المالية



تدفق الدفع



نموذج الأمان



المعمارية



توقف واطلب الموافقة قبل التنفيذ.



للقرارات الهندسية الصغيرة، وثّقها في DECISIONS.md.



بعد التدقيق، قدّم:



قائمة قرارات المعمارية.



قائمة تصحيحات قاعدة البيانات.



قائمة تصحيحات منطق العمل.



قائمة تصحيحات الأمان.



خطة التنفيذ.



قائمة القرارات التي تتطلب موافقتي.



فقط بعد الموافقة يمكنك البدء بالتنفيذ.



1. وصف المشروع

نظام SaaS متكامل يعمل داخل تيليجرام لإنشاء وإدارة بوتات متعددة، مع شبكة إعلانية وتوزيع أرباح تلقائي بين المنصة وأصحاب القنوات ومنشئي البوتات.



يتكون النظام من:



بوت رئيسي (BotFather-like) لإنشاء البوتات وإدارتها.



لوحة تحكم ويب للمشرف والمعلنين والمستخدمين.



خدمة خلفية لجدولة ونشر الإعلانات وحساب الأرباح.



ملاحظة حول أنواع البوتات:

النظام يبدأ حالياً بنوع واحد فقط هو بوت التواصل (CONTACT\_BOT)، لكن البنية مصممة بحيث يمكن إضافة أنواع جديدة مستقبلاً مثل:



بوت قائمة دعم القنوات (SUPPORT\_LIST\_BOT)



بوت إدارة المجموعات (GROUP\_MANAGEMENT\_BOT)



وغيرها.



2. التقنيات المختارة

Backend: Node.js + TypeScript + Fastify



Telegram Bot Library: grammY



ORM: Prisma



قاعدة البيانات: PostgreSQL



Cache/Queue: Redis + BullMQ



Frontend: Next.js (React)



مدير الحزم: pnpm



النشر: Docker Compose أولاً، ثم Kubernetes لاحقاً



البنية: Modular Monolith (يمكن التحول إلى Microservices لاحقاً)



المدفوعات: Telegram Stars API (وفق التوثيق الرسمي الحالي)



الأمان: HTTPS + Webhook Signature Verification + AES-256-GCM لتشفير التوكنات



3\. البنية المعمارية (Architecture)

النظام يبدأ كـ Modular Monolith مقسم إلى وحدات واضحة (Modules) بحيث يسهل فصلها لاحقاً إلى Microservices عند الحاجة.



الوحدات الأساسية:



Users Module: إدارة المستخدمين والأدوار والصلاحيات.



Bots Module: إنشاء وإدارة البوتات وتشفير التوكنات، وإدارة تشغيلها (BotRuntimeManager).



Channels Module: ربط القنوات وإدارة استضافتها.



Ads Module: الحملات الإعلانية وجدولة النشر.



Earnings Module: حساب الأرباح وتوزيعها (يشمل حصة المنصة وسياسات التوزيع).



Wallet Module: المحافظ والمعاملات والسحب (Ledger).



ForcedSubscription Module: الاشتراكات الإجبارية.



Admin Module: لوحة المشرف وإدارة النظام.



Referral Module: نظام الإحالة والتتبع (أساسي للمستقبل).



Localization Module: إدارة اللغات والترجمات.



مبدأ مهم: كل وحدة مستقلة، والتواصل عبر واجهات (Interfaces).

قائمة الانتظار (Queue): BullMQ فوق Redis، مع اعتبار PostgreSQL المصدر الأساسي للحقيقة (Source of Truth) وBullMQ مجرد آلية تنفيذ وتسليم.



4. السيناريو الكامل

4.1 الأدوار

المشرف العام (Owner): صلاحيات كاملة، تعيين مشرفين آخرين عبر لوحة الويب.



منشئ البوت (Bot Creator): أي مستخدم أنشأ بوتاً.



صاحب القناة (Channel Owner): أي مستخدم ربط قناة بالبوت.



المعلن (Advertiser): مستخدم يقدم حملة إعلانية.



ملاحظة: لا اختيار نوع حساب، الأدوار تُحدد تلقائياً حسب النشاط.



4.2 التسجيل والدخول

المستخدم يرسل /start للبوت الرئيسي.



يُنشأ حساب تلقائياً بـ telegram\_id وusername.



لا يُطلب بيانات إضافية ولا وسيلة سحب.



تظهر لوحة تحكم بسيطة داخل البوت (رسالة واحدة فقط يتم تعديلها عند كل تفاعل):



إنشاء بوت جديد



إضافة قناة



بوتاتي



قنواتي



الإعلانات



المحفظة (رصيد سريع)



مساعدة



قاعدة ثابتة: رسالة واحدة فقط، تُعدل عبر editMessageText وeditMessageReplyMarkup.



4.2.1 نظام اللغات (Localization)

يدعم النظام لغتين: ar وen.



اللغة الافتراضية: من language\_code في Telegram، مع تطبيع: أي ar\* -> العربية، أي en\* -> الإنجليزية، غيرها -> الإنجليزية.



نطاق اللغة: لكل User + Bot علاقة مستقلة. لا توجد لغة عامة للمستخدم.



الاختيار اليدوي: يوفر البوت زرين لاختيار اللغة. الاختيار اليدوي له الأولوية ويُحفظ في UserBotPreference.isExplicit = true.



قاعدة مهمة: لا يجوز تغيير اللغة تلقائياً بعد حفظها.



الترجمات: ملفات locales/ar.json وlocales/en.json. جميع النصوص والأزرار والرسائل يجب أن تكون قابلة للترجمة ولا توضع مباشرة في الكود.



تغيير اللغة: تحديث التفضيل ثم إعادة عرض الرسالة الحالية باللغة الجديدة.



رسائل النظام: تستخدم لغة User + Bot المحددة.



4.3 إنشاء بوت جديد (بوت تواصل احترافي)

المستخدم يختار "إنشاء بوت جديد".



البوت يرسل رسالة واحدة تحتوي على شرح ورابط فيديو وطلب التوكن.



يرسل المستخدم التوكن، يتحقق البوت عبر getMe.



إذا صحيح:



يحفظ البوت بنوع CONTACT\_BOT.



يُعيَّن welcomeMessages كـ JSON متعدد اللغات، وfooterTexts كذلك.



الاشتراك الإجباري للمنصة: يضاف تلقائياً قناة المنصة، ويمكن للمالك إزالتها بالدفع.



بوت التواصل:



استقبال رسائل من الجمهور دون كشف هوية المالك.



الخصوصية: عند إعادة التوجيه للمالك، يجب استخدام copyMessage أو إعادة إرسال المحتوى بدلاً من forwardMessage حتى لا يظهر اسم المرسل الأصلي.



الردود: المالك يرد على الرسالة، يلتقط النظام reply\_to\_message\_id ليعرف المستخدم الأصلي ويرسل الرد.



MediaGroup: تُجمَّع الأجزاء مؤقتاً في Redis (نافذة \~1 ثانية) قبل المعالجة، وتُسجَّل برسالة mediaGroupId.



4.4 إضافة قناة (استضافة)

الطريقة الأساسية (الإضافة المباشرة):



يضيف المستخدم البوت كمشرف، يصل تحديث my\_chat\_member.



التحقق الآمن:



لا نعتمد على from.id فقط.

نرسل رسالة تأكيد مع زر "تأكيد الربط".

المستخدم يعيد توجيه رسالة من القناة أو يدخل @username.

نستخدم getChatMember ونتحقق أن حالة المستخدم creator (مالك). المشرف فقط غير كافٍ.

إذا تحقق، نربط القناة بالمستخدم.

الطريقة البديلة: عبر البوت الرئيسي خطوة بخطوة.



إدارة القنوات: المشرف يمكنه تعطيل/تفعيل مع سبب.



صلاحيات البوت تُخزن في BotChannelLink.permissions.



ملاحظة معمارية: أي بوت (رئيسي أو فرعي) يمكن إضافته لقناة، ويمكن للقناة أن تستضيف عدة بوتات. عند نشر إعلان، يجب أن يكون botId وchannelId مرتبطين بـ BotChannelLink نشط.



4.5 تقديم إعلان

المعلن يقدم حملة عبر البوت أو الويب.



يحدد المحتوى والمدة والميزانية والفئات.



يدفع عبر Telegram Stars.



معالجة الدفع:



إنشاء PaymentIntent مع purpose=AD\_PAYMENT وadId.

إرسال sendInvoice بعملة XTR، provider\_token فارغ، وpayload = PaymentIntent.telegramInvoicePayload.

استقبال pre\_checkout\_query والرد بالموافقة بعد التحقق من الـ payload.

استقبال successful\_payment مع telegram\_payment\_charge\_id.

التحقق من عدم وجود Payment بنفس telegramChargeId (Idempotency).

إنشاء Payment وTransaction وتحديث PaymentIntent وتفعيل الإعلان داخل DB transaction واحدة.

قبل التنفيذ: يجب على Cursor مراجعة أحدث Telegram Bot API وتوثيق Stars.



4.6 مراجعة الإعلان والموافقة

المشرف يوافق/يرفض، و"معلن موثوق" يتجاوز المراجعة.



4.7 جدولة الإعلان ونشره تلقائياً

عند الموافقة، تُنشأ مهام BullMQ لكل AdPlacement بأسماء post:{id} وdelete:{id}.



النشر: يتحقق الـ worker من الحالة قبل التنفيذ، ثم يرسل الرسالة، ويحدث الحالة إلى POSTED ويخزن postedMessageId.



الحذف: يحاول deleteMessage:



نجاح => DELETED وتُحتسب الأرباح.



message to delete not found => MANUALLY\_DELETED ولا أرباح.



خطأ صلاحيات => PERMISSION\_ERROR.



خطأ مؤقت => إعادة محاولة، ثم DELETE\_FAILED.



قناة غير موجودة => CHANNEL\_NOT\_FOUND.



Idempotency: المصدر الأساسي هو PostgreSQL (الحالة)، وBullMQ مجرد آلية تنفيذ.



4.8 حساب الأرباح وتوزيعها (سياسة ديناميكية)

نظام النسب:



حصة صاحب القناة: ثابتة 40%.



حصة منشئ البوت: حسب المستوى (Tier) المحدد من مجموع أعضاء القنوات النشطة المرتبطة بالبوت (وليس عدد القنوات).



حصة المنصة = 100 - (حصة القناة + حصة المنشئ).



المستويات:



Starter: أقل من 500 عضو → 15% (المنصة 45%).



Growth: 500-1,999 → 20% (المنصة 40%).



Pro: 2,000-9,999 → 25% (المنصة 35%).



Partner: 10,000+ → 30% (المنصة 30%).



إجمالي الأعضاء: مجموع memberCount للقنوات النشطة المرتبطة بالبوت عبر BotChannelLink.status = ACTIVE (بغض النظر عن مالك القناة).



التحديث: دوري كل 24 ساعة وعند تغيير الروابط.



تثبيت الأطراف والسياسة: عند إنشاء AdPlacement تُخزن botCreatorId وchannelOwnerId وrevenueShareSnapshot.



عملية التسوية (Settlement):



بعد نجاح الحذف (DELETED)، تُنشأ سجلات Earning لكل من صاحب القناة ومنشئ البوت، وPlatformLedger للمنصة.

في نفس DB transaction، يُضاف المبلغ إلى Wallet.balance للمستفيدين (لكل مستخدم Transaction نوع EARNING).

تُحدَّث حالة settlementStatus إلى SETTLED وearningSettledAt.

Idempotency: بسبب القيود الفريدة (Earning @@unique(\[adPlacementId, type])، PlatformLedger @@unique(\[adPlacementId])، وفحص settlementStatus قبل البدء)، لن تتكرر العملية.

4.9 سحب الأرباح

المستخدم يطلب السحب من المحفظة.



تدفق السحب:



حجز المبلغ: Wallet.balance - reservedBalance >= amount ثم reservedBalance += amount، وإنشاء Transaction نوع RESERVATION.

إنشاء Withdrawal بحالة PENDING وreservationTransactionId.

المشرف يوافق/يرفض.

عند الموافقة: الحالة تصبح PROCESSING، ثم تنفيذ السحب الخارجي (حالياً يدوي بواسطة المشرف أو آلي لاحقاً).

عند النجاح: إنشاء Transaction نوع WITHDRAWAL (تخفيض balance وreservedBalance)، وتحديث Withdrawal.status = SUCCESS مع finalTransactionId وexternalId وprocessedAt.

عند الرفض: تحرير المبلغ (reservedBalance -= amount)، Transaction نوع RELEASE، وتحديث الحالة REJECTED.

ملاحظة: يجب أن تكون الحجز ذرياً مع SELECT ... FOR UPDATE.



السحب عبر Telegram Stars: يجب دراسة API الخاص بالدفع للمستخدمين (قد يكون غير متاح مباشرة، لذا البدء بالمعالجة اليدوية مقبول).



4.10 لوحات التحكم والتقارير

المشرف: إدارة مشرفين/قنوات/إعلانات/سحوبات/سياسات/مستويات.



المعلن: حملاته وتتبع النشر.



منشئ البوت/صاحب القناة: بوتاتهم/قنواتهم، أرباحهم، إعداداتهم.



جميع التقارير المالية في الويب.



4.11 الاشتراكات الإجبارية

اشتراك المنصة: يُفرض تلقائياً، يمكن إزالته بالدفع.



اشتراك المالك: حد أقصى 1، يزيد مع عدد القنوات المرتبطة (1 قناة=1، 2=2، 3+=3).



التحقق: عند بدء المحادثة، يفحص اشتراك المستخدم في القنوات المفروضة.



4.12 نظام الإحالة (أساسي)

جداول ReferralLink, ReferralClick, ReferralRelation بدون مكافآت حالياً.



4.13 الأمان

تشفير التوكنات AES-256-GCM (مفتاح 32 بايت، مخزن بشكل آمن).



تشفير encryptedAccountDetails.



HTTPS + تحقق من X-Telegram-Bot-Api-Secret-Token.



Rate limiting على الويبهوك والـ APIs.



RBAC: صلاحيات محددة مثل MANAGE\_ADS, MANAGE\_CHANNELS, MANAGE\_WITHDRAWALS, إلخ.



Soft delete: إضافة deletedAt للبوتات والقنوات والإعلانات والحسابات.



نسخ احتياطي لقاعدة البيانات وتدوير مفاتيح التشفير.



5. مخطط قاعدة البيانات (Prisma Schema)

prisma

// schema.prisma

// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                   String   @id @default(cuid())
  telegramId           BigInt   @unique
  username             String?
  firstName            String?
  lastName             String?
  isTrustedAdvertiser  Boolean  @default(false)
  currentTierId        String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  deletedAt            DateTime?

  bots                 Bot[]
  channels             Channel[]
  ads                  Ad[]
  wallet               Wallet?
  earnings             Earning[]
  withdrawals          Withdrawal[] @relation("WithdrawalUser")
  forcedSubscriptions  ForcedSubscription[]
  adminRoles           AdminRole[]
  auditLogs            AuditLog[]
  payments             Payment[]
  paymentIntents       PaymentIntent[]
  contactConversations ContactConversation[]
  userBotPreferences   UserBotPreference[]
  referralLink         ReferralLink?
  referralClicks       ReferralClick[]
  referralRelationsAsReferrer ReferralRelation[] @relation("Referrer")
  referralRelationsAsReferred ReferralRelation[] @relation("Referred")
  adPlacementsAsBotCreator AdPlacement[] @relation("AdPlacementBotCreator")
  adPlacementsAsChannelOwner AdPlacement[] @relation("AdPlacementChannelOwner")

  currentTier          BotCreatorTier?  @relation("CurrentTier", fields: [currentTierId], references: [id])

  @@map("users")
}

model Bot {
  id                      String   @id @default(cuid())
  ownerId                 String
  tokenEncrypted          String
  botUsername             String
  botType                 BotType  @default(CONTACT_BOT)
  welcomeMessages         Json     // { "ar": "...", "en": "..." }
  footerEnabled           Boolean  @default(true)
  footerTexts             Json     // { "ar": "...", "en": "..." }
  isActive                Boolean  @default(true)
  forcedSubscriptionsLimit Int    @default(1)
  allowPlatformForced     Boolean  @default(true)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  deletedAt               DateTime?

  owner                   User     @relation(fields: [ownerId], references: [id])
  botChannelLinks         BotChannelLink[]
  adPlacements            AdPlacement[]
  forcedSubscriptions     ForcedSubscription[]
  contactConversations    ContactConversation[]
  userPreferences         UserBotPreference[]
  paymentIntents          PaymentIntent[]
  payments                Payment[]

  @@map("bots")
}

enum BotType {
  CONTACT_BOT
}

model UserBotPreference {
  id          String            @id @default(cuid())
  userId      String
  botId       String
  language    SupportedLanguage @default(EN)
  isExplicit  Boolean           @default(false)
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  user        User              @relation(fields: [userId], references: [id])
  bot         Bot               @relation(fields: [botId], references: [id])

  @@unique([userId, botId])
  @@index([botId])
  @@map("user_bot_preferences")
}

enum SupportedLanguage {
  AR
  EN
}

model Channel {
  id                   String   @id @default(cuid())
  ownerId              String
  channelTelegramId    BigInt   @unique
  title                String?
  username             String?
  memberCount          Int      @default(0)
  category             String?
  isActive             Boolean  @default(true)
  deactivationReason   String?
  addedAt              DateTime @default(now())
  updatedAt            DateTime @updatedAt
  deletedAt            DateTime?

  owner                User     @relation(fields: [ownerId], references: [id])
  botChannelLinks      BotChannelLink[]
  adPlacements         AdPlacement[]
  forcedSubscriptions  ForcedSubscription[]

  @@map("channels")
}

model BotChannelLink {
  id          String     @id @default(cuid())
  botId       String
  channelId   String
  permissions Json
  status      LinkStatus @default(ACTIVE)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  bot         Bot        @relation(fields: [botId], references: [id])
  channel     Channel    @relation(fields: [channelId], references: [id])

  @@unique([botId, channelId])
  @@map("bot_channel_links")
}

enum LinkStatus {
  ACTIVE
  INACTIVE
}

model RevenueSharePolicy {
  id              String   @id @default(cuid())
  name            String
  channelOwnerPct Int      // نسبة صاحب القناة (مثلاً 40)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  adPlacements    AdPlacement[]
  botCreatorTiers BotCreatorTier[]

  @@map("revenue_share_policies")
}

model BotCreatorTier {
  id                   String   @id @default(cuid())
  policyId             String
  name                 String   // Starter, Growth, Pro, Partner
  minTotalMembers      Int      // الحد الأدنى (شامل)
  maxTotalMembers      Int?     // الحد الأقصى (غير شامل)، null يعني بلا حد
  botCreatorPercentage Int      // نسبة منشئ البوت (مثلاً 15)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  policy               RevenueSharePolicy @relation(fields: [policyId], references: [id])
  users                User[] @relation("CurrentTier")

  @@map("bot_creator_tiers")
}

model Ad {
  id               String      @id @default(cuid())
  advertiserId     String
  title            String
  content          Json
  budget           Int         // الميزانية بوحدات Stars
  cpmRate          Int?        // سعر لكل 1000 مشترك (اختياري)
  durationHours    Int
  targetCategories String[]
  status           AdStatus    @default(PENDING)
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  deletedAt        DateTime?

  advertiser       User        @relation(fields: [advertiserId], references: [id])
  placements       AdPlacement[]
  paymentIntent    PaymentIntent?
  payments         Payment[]

  @@map("ads")
}

enum AdStatus {
  PENDING
  APPROVED
  REJECTED
  COMPLETED
  CANCELED
}

model AdPlacement {
  id                  String          @id @default(cuid())
  adId                String
  channelId           String
  botId               String
  botCreatorId        String
  channelOwnerId      String
  revenueSharePolicyId String
  revenueShareSnapshot Json           // لقطة النسب الفعلية
  scheduledPostAt     DateTime
  scheduledDeleteAt   DateTime?
  price               Int             // سعر هذا الموضع بوحدات Stars
  status              PlacementStatus @default(SCHEDULED)
  postedMessageId     BigInt?
  postedAt            DateTime?
  deletedAt           DateTime?
  errorMessage        String?
  settlementStatus    SettlementStatus @default(PENDING)
  earningSettledAt    DateTime?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  ad                  Ad              @relation(fields: [adId], references: [id])
  channel             Channel         @relation(fields: [channelId], references: [id])
  bot                 Bot             @relation(fields: [botId], references: [id])
  botCreator          User            @relation("AdPlacementBotCreator", fields: [botCreatorId], references: [id])
  channelOwner        User            @relation("AdPlacementChannelOwner", fields: [channelOwnerId], references: [id])
  revenueSharePolicy  RevenueSharePolicy @relation(fields: [revenueSharePolicyId], references: [id])
  earnings            Earning[]
  platformLedger      PlatformLedger?

  @@index([adId])
  @@index([channelId])
  @@index([status])
  @@index([settlementStatus])
  @@map("ad_placements")
}

enum PlacementStatus {
  SCHEDULED
  POSTED
  DELETED
  FAILED
  MANUALLY_DELETED
  PERMISSION_ERROR
  DELETE_FAILED
  CHANNEL_NOT_FOUND
}

enum SettlementStatus {
  PENDING
  SETTLED
  FAILED
}

model Earning {
  id             String        @id @default(cuid())
  userId         String
  adPlacementId  String
  amount         Int           // بوحدات Stars
  type           EarningType
  status         EarningStatus @default(PENDING)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  user           User          @relation(fields: [userId], references: [id])
  adPlacement    AdPlacement   @relation(fields: [adPlacementId], references: [id])

  @@unique([adPlacementId, type])
  @@index([userId])
  @@map("earnings")
}

enum EarningType {
  BOT_CREATOR_SHARE
  CHANNEL_OWNER_SHARE
}

enum EarningStatus {
  PENDING
  PAID
  CANCELED
}

model PlatformLedger {
  id              String   @id @default(cuid())
  adPlacementId   String   @unique
  amount          Int
  description     String?
  createdAt       DateTime @default(now())

  adPlacement     AdPlacement @relation(fields: [adPlacementId], references: [id])

  @@map("platform_ledger")
}

model Wallet {
  id                String   @id @default(cuid())
  userId            String   @unique
  balance           Int      @default(0)
  reservedBalance   Int      @default(0)
  currency          String   @default("STARS")
  updatedAt         DateTime @updatedAt

  user              User     @relation(fields: [userId], references: [id])
  transactions      Transaction[]
  withdrawals       Withdrawal[]

  @@map("wallets")
}

model Transaction {
  id          String          @id @default(cuid())
  walletId    String
  type        TransactionType
  purpose     TransactionPurpose?
  amount      Int             // يمكن أن يكون موجب أو سالب حسب النوع
  description String?
  externalId  String?         @unique
  status      TransactionStatus @default(PENDING)
  createdAt   DateTime        @default(now())

  wallet      Wallet          @relation(fields: [walletId], references: [id])
  payment     Payment?
  withdrawalReservation Withdrawal? @relation("WithdrawalReservation")
  withdrawalFinal       Withdrawal? @relation("WithdrawalFinal")
  withdrawalRelease     Withdrawal? @relation("WithdrawalRelease")

  @@index([walletId])
  @@map("transactions")
}

enum TransactionType {
  DEPOSIT        // +amount
  EARNING        // +amount
  REFUND         // +amount
  RESERVATION    // يزيد reservedBalance فقط
  RELEASE        // ينقص reservedBalance فقط
  WITHDRAWAL     // -amount (يخفض balance و reservedBalance)
}

enum TransactionPurpose {
  AD_PAYMENT
  FOOTER_REMOVAL
  PLATFORM_FORCED_SUBSCRIPTION_REMOVAL
  FORCED_SUBSCRIPTION_LIMIT_INCREASE
  WALLET_DEPOSIT
  WITHDRAWAL
  REFUND
  OTHER
}

enum TransactionStatus {
  PENDING
  SUCCESS
  FAILED
}

model PaymentIntent {
  id                    String   @id @default(cuid())
  userId                String
  purpose               TransactionPurpose
  amount                Int
  currency              String   @default("XTR")
  telegramInvoicePayload String? @unique
  status                PaymentIntentStatus @default(PENDING)
  adId                  String?
  botId                 String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user                  User     @relation(fields: [userId], references: [id])
  ad                    Ad?      @relation(fields: [adId], references: [id])
  bot                   Bot?     @relation(fields: [botId], references: [id])
  payment               Payment?

  @@index([userId])
  @@map("payment_intents")
}

enum PaymentIntentStatus {
  PENDING
  PAID
  CANCELED
  FAILED
}

model Payment {
  id                    String   @id @default(cuid())
  paymentIntentId       String   @unique
  userId                String
  transactionId         String   @unique
  purpose               TransactionPurpose
  amount                Int
  currency              String   @default("XTR")
  telegramChargeId      String   @unique
  telegramInvoicePayload String?
  adId                  String?  @unique
  botId                 String?
  createdAt             DateTime @default(now())

  user                  User     @relation(fields: [userId], references: [id])
  transaction           Transaction @relation(fields: [transactionId], references: [id])
  paymentIntent         PaymentIntent @relation(fields: [paymentIntentId], references: [id])
  ad                    Ad?      @relation(fields: [adId], references: [id])
  bot                   Bot?     @relation(fields: [botId], references: [id])

  @@index([userId])
  @@map("payments")
}

model Withdrawal {
  id                      String           @id @default(cuid())
  userId                  String
  walletId                String
  amount                  Int
  method                  WithdrawalMethod
  encryptedAccountDetails String
  status                  WithdrawalStatus @default(PENDING)
  reservationTransactionId String?         @unique
  finalTransactionId      String?          @unique
  releaseTransactionId    String?          @unique
  externalId              String?          @unique
  approvedById            String?
  processedById           String?
  processedAt             DateTime?
  rejectionReason         String?
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt

  user                    User             @relation("WithdrawalUser", fields: [userId], references: [id])
  wallet                  Wallet           @relation(fields: [walletId], references: [id])
  reservationTransaction  Transaction?     @relation("WithdrawalReservation", fields: [reservationTransactionId], references: [id])
  finalTransaction        Transaction?     @relation("WithdrawalFinal", fields: [finalTransactionId], references: [id])
  releaseTransaction      Transaction?     @relation("WithdrawalRelease", fields: [releaseTransactionId], references: [id])
  approvedBy              User?            @relation("WithdrawalApprovedBy", fields: [approvedById], references: [id])
  processedBy             User?            @relation("WithdrawalProcessedBy", fields: [processedById], references: [id])

  @@index([userId])
  @@index([status])
  @@map("withdrawals")
}

enum WithdrawalMethod {
  TELEGRAM_STARS
  PAYPAL
  USDT
}

enum WithdrawalStatus {
  PENDING
  APPROVED
  REJECTED
  PROCESSING
  SUCCESS
}

model ForcedSubscription {
  id          String   @id @default(cuid())
  botId       String
  channelId   String
  isPlatform  Boolean  @default(false)
  addedBy     String
  createdAt   DateTime @default(now())

  bot         Bot      @relation(fields: [botId], references: [id])
  channel     Channel  @relation(fields: [channelId], references: [id])
  addedByUser User     @relation(fields: [addedBy], references: [id])

  @@unique([botId, channelId, isPlatform])
  @@map("forced_subscriptions")
}

model AdminRole {
  id          String   @id @default(cuid())
  userId      String
  permissions Json     // قائمة صلاحيات مثل ["MANAGE_ADS", "MANAGE_WITHDRAWALS"]
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [userId], references: [id])

  @@map("admin_roles")
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  action    String
  entityType String?
  entityId  String?
  details   Json?
  ip        String?
  createdAt DateTime @default(now())

  user      User?    @relation(fields: [userId], references: [id])

  @@index([entityType, entityId])
  @@map("audit_logs")
}

// --- نماذج محادثات بوت التواصل ---

model ContactConversation {
  id             String   @id @default(cuid())
  botId          String
  originalUserId BigInt
  ownerChatId    BigInt   // معرف محادثة المالك (غالباً = owner.telegramId)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  bot            Bot      @relation(fields: [botId], references: [id])
  messages       ContactMessage[]

  @@unique([botId, originalUserId])
  @@map("contact_conversations")
}

model ContactMessage {
  id              String   @id @default(cuid())
  conversationId  String
  direction       ContactMessageDirection
  sourceChatId    BigInt
  sourceMessageId BigInt
  targetChatId    BigInt?
  targetMessageId BigInt?
  mediaGroupId    String?
  createdAt       DateTime @default(now())

  conversation    ContactConversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId])
  @@index([sourceMessageId])
  @@map("contact_messages")
}

enum ContactMessageDirection {
  INCOMING
  FORWARDED
  REPLY
  SENT
}

// --- نظام الإحالة ---

model ReferralLink {
  id          String   @id @default(cuid())
  userId      String   @unique
  code        String   @unique
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [userId], references: [id])
  clicks      ReferralClick[]

  @@map("referral_links")
}

model ReferralClick {
  id              String   @id @default(cuid())
  referralLinkId  String
  telegramUserId  BigInt?
  clickedAt       DateTime @default(now())

  referralLink    ReferralLink @relation(fields: [referralLinkId], references: [id])

  @@map("referral_clicks")
}

model ReferralRelation {
  id          String   @id @default(cuid())
  referrerId  String
  referredId  String   @unique
  createdAt   DateTime @default(now())

  referrer    User     @relation("Referrer", fields: [referrerId], references: [id])
  referred    User     @relation("Referred", fields: [referredId], references: [id])

  @@map("referral_relations")
}

6\. تعليمات الإعداد لـ Cursor

6.1 هيكل المشروع

text

project/

├── backend/

│   ├── src/

│   │   ├── modules/

│   │   │   ├── users/

│   │   │   ├── bots/

│   │   │   ├── channels/

│   │   │   ├── ads/

│   │   │   ├── earnings/

│   │   │   ├── wallet/

│   │   │   ├── forcedSubscriptions/

│   │   │   ├── referrals/

│   │   │   └── localization/

│   │   ├── config/

│   │   ├── lib/

│   │   ├── locales/

│   │   │   ├── ar.json

│   │   │   └── en.json

│   │   ├── bot.ts

│   │   ├── webhook.ts

│   │   └── index.ts

│   ├── prisma/

│   │   └── schema.prisma

│   ├── .env.example

│   ├── .gitignore

│   ├── package.json

│   └── tsconfig.json

├── frontend/

│   ├── pages/

│   ├── components/

│   ├── styles/

│   ├── package.json

│   └── next.config.js

└── docker-compose.yml

6.2 خطوات التنفيذ الأولية

تثبيت pnpm (إن لم يكن مثبتاً): npm install -g pnpm



إنشاء مجلد المشروع وتهيئة backend وfrontend.



تثبيت الحزم:



bash

cd backend

pnpm init

pnpm add fastify grammY @prisma/client ioredis bullmq

pnpm add -D typescript @types/node prisma ts-node

npx prisma init --datasource-provider postgresql

نسخ مخطط Prisma أعلاه في ملف prisma/schema.prisma.



إنشاء ملف .env.example يحتوي على المتغيرات التالية (بدون قيم حقيقية):



text

DATABASE\_URL="postgresql://user:password@localhost:5432/mydb"

REDIS\_URL="redis://localhost:6379"

BOT\_TOKEN="ضع\_توكن\_البوت\_الرئيسي\_هنا"

ENCRYPTION\_KEY="ضع\_مفتاح\_تشفير\_32\_بايت\_بصيغة\_hex"

WEBHOOK\_SECRET="سر\_للتحقق\_من\_الويب هوك"

وأضف .env إلى .gitignore.



تشغيل قاعدة البيانات عبر Docker Compose:



yaml

version: '3.8'

services:

&#x20; postgres:

&#x20;   image: postgres:15

&#x20;   environment:

&#x20;     POSTGRES\_USER: user

&#x20;     POSTGRES\_PASSWORD: password

&#x20;     POSTGRES\_DB: mydb

&#x20;   ports:

&#x20;     - "5432:5432"

&#x20; redis:

&#x20;   image: redis:7

&#x20;   ports:

&#x20;     - "6379:6379"

تنفيذ الهجرة:



bash

npx prisma migrate dev --name init

6.3 تسلسل البناء المقترح (بعد الموافقة على التدقيق)

Project setup + configuration



Prisma schema validation



Users module + Localization



Main Telegram bot



Bot management (create/encrypt/token/register webhook)



Channel management (my\_chat\_member, verification)



Forced subscriptions



Ads (create, payment, approval, placement)



Scheduling/queues (BullMQ)



Earnings settlement + Wallet + Platform Ledger



Telegram Stars payments (after API review)



Admin dashboard



Advertiser dashboard



Bot creator / channel owner dashboard



Security hardening (rate limiting, RBAC, soft delete)



Tests



Docker Compose



Production readiness (backups, monitoring)



7\. ملاحظات ختامية

الـ Webhook: يجب دعم Webhook لكل بوت ديناميكي، عبر مسار مثل /webhooks/telegram/:botId مع secret.



BotRuntimeManager: عند إنشاء بوت، يتم التحقق من التوكن، تشفيره، حفظه، تسجيل الويبهوك، وبدء معالجة التحديثات.



Idempotency في BullMQ: PostgreSQL هو المصدر الرسمي للحالة، وBullMQ مجرد آلية توصيل. استخدم الحالة في DB لمنع التكرار.



النسخ الاحتياطي: جدولة نسخ احتياطي يومي لقاعدة البيانات، وتخزين مفتاح التشفير في مكان آمن منفصل.



Telegram Stars: قبل تنفيذ أي جزء متعلق بالدفع، يجب مراجعة أحدث توثيق رسمي من Telegram.



انتهت الحزمة.

