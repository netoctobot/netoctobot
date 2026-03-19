from django.db import models
from django.utils.translation import gettext_lazy as _
from apps.accounts.models import TelegramUser
from apps.core.models import BaseModel # الاستيراد من المكان العام

class AdminChannel(BaseModel):
    channel_id = models.BigIntegerField(
        unique=True,
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
        SUPPORT = 'SUP', _('Support Bot')
        CONTACT = 'CON', _('Contact Bot')
        LIST = 'LST', _('List Bot')

    owner = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='my_bots', verbose_name=_("Owner"))
    token = models.CharField(max_length=255, unique=True, verbose_name=_("Bot Token"))
    name = models.CharField(max_length=255, verbose_name=_("Bot Name"))
    bot_type = models.CharField(max_length=3, choices=BotType.choices, default=BotType.SUPPORT, verbose_name=_("Bot Type"))
    is_active = models.BooleanField(default=True, verbose_name=_("Is Active"))
    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("Created At"))

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

    def __str__(self):
        return self.title

    class Meta:
        verbose_name = _("Channel")
        verbose_name_plural = _("Channels")

class BotSubscription(BaseModel):
    """سجل المشتركين في البوتات (العزل)"""
    bot = models.ForeignKey(SubBot, on_delete=models.CASCADE, related_name='subscribers', verbose_name=_("Bot"))
    user = models.ForeignKey(TelegramUser, on_delete=models.CASCADE, related_name='subscriptions', verbose_name=_("User"))
    joined_at = models.DateTimeField(auto_now_add=True, verbose_name=_("Joined At"))

    class Meta:
        unique_together = ('bot', 'user')
        verbose_name = _("Bot Subscription")
        verbose_name_plural = _("Bot Subscriptions")