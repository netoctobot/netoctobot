from aiogram import Bot
from aiogram.client.default import DefaultBotProperties 
from django.db import models
from django.utils.translation import gettext_lazy as _
from apps.accounts.models import TelegramUser
from apps.core.models import BaseModel # الاستيراد من المكان العام

class AdminChannel(BaseModel):
    channel_id = models.BigIntegerField(
        unique=True,
        null=True,
        blank=True,
        verbose_name=_("Channel ID"),
    )
    title = models.CharField(
        max_length=255,
        blank=True,
        default="",
        verbose_name=_("Display title"),
        help_text=_("Shown on mandatory-subscribe buttons"),
    )
    username = models.CharField(
        max_length=255, 
        null=True, 
        blank=True, 
        verbose_name=_("Username") # اسم المستخدم
    )
    # رسالة تظهر للمستخدم عندما لا يكون مشتركاً
    force_msg = models.TextField(
        blank=True, 
        null=True, 
        verbose_name=_("Force Subscribe Message")
    )

class SubBot(BaseModel):
    """بيانات البوتات الفرعية"""
    class BotType(models.TextChoices):
        CONTACT = 'CON', _('Contact Bot')
        LIST = 'LST', _('List Bot')
    
    class ParseMode(models.TextChoices):
        HTML = 'HTML', 'HTML'
        MARKDOWN = 'MDV2', 'Markdown V2'
        PLAIN = 'PLAIN', _('Plain Text')

    owner = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='my_bots', verbose_name=_("Owner"))
    token = models.CharField(max_length=255, unique=True, verbose_name=_("Bot Token"))
    name = models.CharField(max_length=255, verbose_name=_("Bot Name"))
    username = models.CharField(max_length=255, null=True, blank=True)
    bot_type = models.CharField(max_length=3, choices=BotType.choices, default=BotType.CONTACT, verbose_name=_("Bot Type"))
    is_active = models.BooleanField(default=True, verbose_name=_("Is Active"))
    welcome_msg = models.TextField(
        blank=True, 
        null=True, 
        verbose_name=_("Welcome Message"),
        help_text=_("The message shown to users when they send /start")
    )
    welcome_parse_mode = models.CharField(
        max_length=5, 
        choices=ParseMode.choices, 
        default=ParseMode.HTML,
        verbose_name=_("Welcome Message Format")
    )
    template_msg = models.TextField(
        verbose_name=_("Template msg")
    )
    teplate_parse_mode = models.CharField(
        max_length=5, 
        choices=ParseMode.choices, 
        default=ParseMode.HTML,
        verbose_name=_("List Message Format")
    )
    
    # أزرار المالك (نص خام يتم معالجته برمجياً)
    owner_buttons = models.TextField(
        null=True, 
        blank=True, 
        verbose_name=_("Owner Custom Buttons"),
        help_text=_("Format: Button Name | URL (one per line)")
    )
    # القنوات التي يفرضها صاحب البوت
    # ملاحظة: يمكن للبوت الواحد فرض عدة قنوات
    force_channels = models.ManyToManyField(
        'Channel', 
        blank=True, 
        related_name="forced_in_bots",
        verbose_name=_("Force Subscribe Channels")
    )
    
    # رسالة تظهر للمستخدم عندما لا يكون مشتركاً
    force_msg = models.TextField(
        blank=True, 
        null=True, 
        verbose_name=_("Force Subscribe Message")
    )

    def get_bot_instance(self):
        """إرجاع نسخة جاهزة من البوت للتشغيل"""
        return Bot(token=self.token,default=DefaultBotProperties(parse_mode="HTML"))
    
    def __str__(self):
        return f"{self.name} ({self.get_bot_type_display()})"

    class Meta:
        verbose_name = _("Sub Bot")
        verbose_name_plural = _("Sub Bots")

class Channel(BaseModel):
    """بيانات القنوات المرتبطة"""
    class Status(models.TextChoices):
        ACTIVE = 'ACT', _('Active')
        LEFT = 'LFT', _('Bot Left')
        BANNED = 'BAN', _('Banned')
        REFRESH = 'REF', _('Needs Refresh')

    owner = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='my_channels', verbose_name=_("Owner"))
    channel_id = models.BigIntegerField(unique=True, verbose_name=_("Channel ID"))
    title = models.CharField(max_length=255, verbose_name=_("Channel Title"))
    member_count = models.PositiveIntegerField(default=0, verbose_name=_("Member Count"))
    status = models.CharField(max_length=3, choices=Status.choices, default=Status.ACTIVE, verbose_name=_("Status"))
    last_sync = models.DateTimeField(auto_now=True, verbose_name=_("Last Sync"))
    invite_link = models.URLField(null=True, blank=True, verbose_name=_("Invite Link"))
    username = models.CharField(max_length=255, null=True, blank=True, verbose_name=_("Username"))
    
    def __str__(self):
        return self.title

    class Meta:
        verbose_name = _("Channel")
        verbose_name_plural = _("Channels")

class SubBotChannel(BaseModel):
    """إعدادات القناة داخل بوت فرعي محدد"""
    sub_bot = models.ForeignKey(SubBot, on_delete=models.CASCADE, related_name='bot_channels')
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name='in_bots')
    
    # إعدادات خاصة بكل بوت
    custom_invite_link = models.URLField(null=True, blank=True, verbose_name=_("Custom Link for this Bot"))
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ('sub_bot', 'channel') # القناة لا تتكرر في نفس البوت

class BotSubscription(BaseModel):
    """سجل المشتركين في البوتات (العزل)"""
    bot = models.ForeignKey(SubBot, on_delete=models.CASCADE, related_name='subscribers', verbose_name=_("Bot"))
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='subscriptions', verbose_name=_("User"))
    last_main_message_id = models.BigIntegerField(
        null=True, 
        blank=True, 
        verbose_name=_("Last Main Message ID")
    )
    # لغة المستخدم داخل هذا البوت تحديداً
    language = models.CharField(
        max_length=10, 
        default='ar', 
        verbose_name=_("Language")
    )
    joined_at = models.DateTimeField(auto_now_add=True, verbose_name=_("Joined At"))

    class Meta:
        unique_together = ('bot', 'user')
        verbose_name = _("Bot Subscription")
        verbose_name_plural = _("Bot Subscriptions")

class ListTemplate(BaseModel):
    """نظام التمبلت والجدولة المنفصل"""
    class IntervalUnit(models.TextChoices):
        SECONDS = "sec", _("Seconds")
        MINUTES = "min", _("Minutes")
        HOURS = "hour", _("Hours")

    sub_bot = models.OneToOneField(
        SubBot, 
        on_delete=models.CASCADE, 
        related_name='list_config', # استعمل اسم واضح للوصول إليه
        verbose_name=_("Sub Bot")
    )
    
    # محتوى الرسالة
    header_text = models.TextField(
        null=True, blank=True, 
        verbose_name=_("Header Text"),
        help_text=_("The text that appears above the channel list")
    )
    footer_text = models.TextField(
        null=True, blank=True, 
        verbose_name=_("Footer Text"),
        help_text=_("The text that appears at the bottom of the channel list")
    )
    
    # إعدادات الجدولة: رقم + وحدة (ثوانٍ / دقائق / ساعات)
    post_interval = models.PositiveIntegerField(
        default=24,
        verbose_name=_("Post interval value"),
        help_text=_("Numeric part of the auto-post interval (interpreted with post_interval_unit)."),
    )
    post_interval_unit = models.CharField(
        max_length=4,
        choices=IntervalUnit.choices,
        default=IntervalUnit.HOURS,
        verbose_name=_("Post interval unit"),
    )
    delete_after = models.PositiveIntegerField(
        default=2,
        verbose_name=_("Delete after value"),
        help_text=_("0 disables auto-delete; otherwise delay before deleting posted lists."),
    )
    delete_after_unit = models.CharField(
        max_length=4,
        choices=IntervalUnit.choices,
        default=IntervalUnit.HOURS,
        verbose_name=_("Delete after unit"),
    )
    
    # حالة التشغيل
    is_enabled = models.BooleanField(
        default=False, 
        verbose_name=_("Auto Posting Enabled")
    )
    last_run = models.DateTimeField(null=True, blank=True, verbose_name=_("Last Run Time"))

    class Meta:
        verbose_name = _("List Template")
        verbose_name_plural = _("List Templates")

    def __str__(self):
        return f"Config for {self.sub_bot.name}"

# سجل تاريخي لعمليات النشر (لأغراض الحذف التلقائي)
class PublishedList(BaseModel):
    """سجل الرسائل المنشورة لحذفها لاحقاً"""
    sub_bot = models.ForeignKey(SubBot, on_delete=models.CASCADE)
    channel_id = models.BigIntegerField()
    message_id = models.BigIntegerField()
    delete_at = models.DateTimeField() # الوقت المجدد لحذف هذه الرسالة تحديداً
    is_deleted = models.BooleanField(default=False)


class ListButtonType(models.TextChoices):
    """أنواع أزرار شائعة في تليجرام: رابط، أو callback داخل البوت."""

    URL = "url", _("URL (opens link)")
    CALLBACK = "cb", _("Callback (in-bot action)")


class PlatformListButton(BaseModel):
    """أزرار ثابتة تُلحق برسالة اللستة — يضبطها مدير المنصة (أسفل أزرار المالك)."""

    label = models.CharField(max_length=64, verbose_name=_("Button text"))
    sort_order = models.PositiveIntegerField(default=0, verbose_name=_("Sort order"))
    is_active = models.BooleanField(default=True, verbose_name=_("Active"))
    button_type = models.CharField(
        max_length=8,
        choices=ListButtonType.choices,
        default=ListButtonType.URL,
        verbose_name=_("Button type"),
    )
    url = models.URLField(blank=True, null=True, verbose_name=_("URL"))
    callback_hint = models.CharField(
        max_length=180,
        blank=True,
        default="",
        verbose_name=_("Callback note"),
        help_text=_("Shown as alert when user taps a callback-type button"),
    )

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = _("Platform list button")
        verbose_name_plural = _("Platform list buttons")

    def __str__(self):
        return self.label


class SubBotListButton(BaseModel):
    """أزرار مخصصة لمالك البوت الفرعي على رسالة اللستة (فوق أزرار المنصة)."""

    sub_bot = models.ForeignKey(
        SubBot, on_delete=models.CASCADE, related_name="list_buttons"
    )
    label = models.CharField(max_length=64, verbose_name=_("Button text"))
    sort_order = models.PositiveIntegerField(default=0, verbose_name=_("Sort order"))
    is_active = models.BooleanField(default=True, verbose_name=_("Active"))
    button_type = models.CharField(
        max_length=8,
        choices=ListButtonType.choices,
        default=ListButtonType.URL,
        verbose_name=_("Button type"),
    )
    url = models.URLField(blank=True, null=True, verbose_name=_("URL"))
    callback_hint = models.CharField(
        max_length=180,
        blank=True,
        default="",
        verbose_name=_("Callback note"),
        help_text=_("Shown as alert when user taps a callback-type button"),
    )

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = _("Sub-bot list button")
        verbose_name_plural = _("Sub-bot list buttons")

    def __str__(self):
        return f"{self.sub_bot_id}: {self.label}"


class SubBotMandatoryChannel(BaseModel):
    """قنوات اشتراك إجباري لكل بوت فرعي — منفصلة عن قنوات نشر اللستة."""

    sub_bot = models.ForeignKey(
        SubBot, on_delete=models.CASCADE, related_name="mandatory_channels"
    )
    channel = models.ForeignKey(
        Channel, on_delete=models.CASCADE, related_name="mandatory_for_sub_bots"
    )
    sort_order = models.PositiveIntegerField(default=0, verbose_name=_("Sort order"))
    is_active = models.BooleanField(default=True, verbose_name=_("Active"))

    class Meta:
        unique_together = ("sub_bot", "channel")
        ordering = ["sort_order", "id"]
        verbose_name = _("Mandatory channel (per sub-bot)")
        verbose_name_plural = _("Mandatory channels (per sub-bot)")

    def __str__(self):
        return f"{self.sub_bot} → {self.channel}"


class SubBotSubscriptionQuota(BaseModel):
    """حد أقصى لقنوات الاشتراك الإجباري لكل بوت (قابل للتوسع لاحقاً بالدفع)."""

    sub_bot = models.OneToOneField(
        SubBot, on_delete=models.CASCADE, related_name="subscription_quota"
    )
    max_mandatory_slots = models.PositiveIntegerField(
        default=2,
        verbose_name=_("Max mandatory channels"),
        help_text=_("Owner cannot add more active mandatory channels than this."),
    )

    class Meta:
        verbose_name = _("Sub-bot subscription quota")
        verbose_name_plural = _("Sub-bot subscription quotas")

    def __str__(self):
        return f"{self.sub_bot_id}: max {self.max_mandatory_slots}"