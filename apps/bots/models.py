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
        verbose_name=_("Channel ID")
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
    owner = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='my_channels', verbose_name=_("Owner"))
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