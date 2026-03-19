import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from django.conf import settings

class BaseModel(models.Model):
    """
    قالب أساسي (Abstract) لجميع موديلات المشروع.
    """
    # معرف فريد بدلاً من الرقم التسلسلي التقليدي
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # تواريخ التتبع
    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("Created At"))
    updated_at = models.DateTimeField(auto_now=True, verbose_name=_("Updated At"))
    
    # من قام بإنشاء السجل
    # ملاحظة: نستخدم settings.AUTH_USER_MODEL لضمان المرونة
    created_by = models.ForeignKey(
        'accounts.TelegramUser', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name="%(class)s_created", # توليد اسم فريد للعلاقة تلقائياً
        verbose_name=_("Created By")
    )

    class Meta:
        abstract = True # ضروري جداً لكي لا ينشئ Django جدولاً لهذا الكلاس