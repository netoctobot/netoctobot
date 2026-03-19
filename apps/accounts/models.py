from django.db import models
from django.utils.translation import gettext_lazy as _
from apps.core.models import BaseModel
# ملاحظة: دالة _() تجعل النصوص قابلة للاستخراج لملف الترجمة لاحقاً

class TelegramUser(BaseModel):
    """
    موديل مستخدم التيليجرام الأساسي
    """
    telegram_id = models.BigIntegerField(
        unique=True, 
        verbose_name=_("Telegram ID") # معرف التيليجرام
    )
    full_name = models.CharField(
        max_length=255, 
        verbose_name=_("Full Name") # الاسم الكامل
    )
    username = models.CharField(
        max_length=255, 
        null=True, 
        blank=True, 
        verbose_name=_("Username") # اسم المستخدم
    )
    is_partner = models.BooleanField(
        default=False, 
        verbose_name=_("Is Partner") # هل هو شريك/صاحب بوت وقنوات
    )
    date_joined = models.DateTimeField(
        auto_now_add=True, 
        verbose_name=_("Date Joined") # تاريخ الانضمام للنظام
    )

    def __str__(self):
        return f"{self.full_name} ({self.telegram_id})"

    class Meta:
        verbose_name = _("Telegram User")
        verbose_name_plural = _("Telegram Users")


class Wallet(BaseModel):
    """
    المحفظة المالية المرتبطة بكل مستخدم
    """
    class PayoutMethod(models.TextChoices):
        CRYPTO = 'CRY', _('Crypto (USDT)')
        PAYPAL = 'PAL', _('PayPal')
        BANK = 'BNK', _('Bank Transfer')
        CASH = 'CSH', _('Local Wallet (Cash)')

    user = models.OneToOneField(
        TelegramUser, 
        on_delete=models.CASCADE, 
        related_name='wallet',
        verbose_name=_("User")
    )
    balance = models.DecimalField(
        max_digits=12, 
        decimal_places=2, 
        default=0.00, 
        verbose_name=_("Available Balance") # الرصيد المتاح للسحب
    )
    pending_balance = models.DecimalField(
        max_digits=12, 
        decimal_places=2, 
        default=0.00, 
        verbose_name=_("Pending Balance") # الرصيد المعلق (تحت المراجعة)
    )
    total_earned = models.DecimalField(
        max_digits=12, 
        decimal_places=2, 
        default=0.00, 
        verbose_name=_("Total Earned") # إجمالي ما ربحه المستخدم تاريخياً
    )
    country = models.CharField(
        max_length=100, 
        null=True, 
        blank=True, 
        verbose_name=_("Country") # بلد الإقامة لتحديد طرق السحب المتاحة
    )
    preferred_method = models.CharField(
        max_length=3, 
        choices=PayoutMethod.choices, 
        default=PayoutMethod.CASH,
        verbose_name=_("Preferred Payout Method") # طريقة السحب المفضلة
    )
    payout_details = models.TextField(
        null=True, 
        blank=True, 
        verbose_name=_("Payout Details") # تفاصيل الحساب (إيميل، رقم، عنوان محفظة)
    )

    def __str__(self):
        return f"{_('Wallet for')} {self.user.full_name}"

    class Meta:
        verbose_name = _("Wallet")
        verbose_name_plural = _("Wallets")


class Transaction(BaseModel):
    """
    سجل العمليات المالية (إيداع، ربح، سحب)
    """
    class Type(models.TextChoices):
        EARNING = 'EAR', _('Earning')   # ربح من إعلان
        WITHDRAWAL = 'WTH', _('Withdrawal') # طلب سحب
        REFERRAL = 'REF', _('Referral Commission') # عمولة دعوة

    class Status(models.TextChoices):
        PENDING = 'PEN', _('Pending')   # قيد المراجعة
        COMPLETED = 'COM', _('Completed') # مكتملة
        FAILED = 'FAI', _('Failed/Rejected') # مرفوضة أو فاشلة

    wallet = models.ForeignKey(
        Wallet, 
        on_delete=models.CASCADE, 
        related_name='transactions',
        verbose_name=_("Wallet")
    )
    amount = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        verbose_name=_("Amount")
    )
    tx_type = models.CharField(
        max_length=3, 
        choices=Type.choices, 
        verbose_name=_("Transaction Type")
    )
    status = models.CharField(
        max_length=3, 
        choices=Status.choices, 
        default=Status.PENDING, 
        verbose_name=_("Status")
    )
    reason = models.CharField(
        max_length=255, 
        verbose_name=_("Reason/Description") # سبب العملية (مثلاً: ربح من قناة X)
    )
    timestamp = models.DateTimeField(
        auto_now_add=True, 
        verbose_name=_("Timestamp")
    )

    def __str__(self):
        return f"{self.get_tx_type_display()} - {self.amount}"

    class Meta:
        verbose_name = _("Transaction")
        verbose_name_plural = _("Transactions")