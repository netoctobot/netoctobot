from django.contrib import admin
from django.utils.translation import gettext_lazy as _
from .models import SubBot, Channel, BotSubscription

@admin.register(SubBot)
class SubBotAdmin(admin.ModelAdmin):
    # الأعمدة التي ستظهر في القائمة الرئيسية
    list_display = ('name', 'owner', 'bot_type', 'is_active', 'created_at', 'get_subscribers_count')
    
    # الفلاتر الجانبية
    list_filter = ('bot_type', 'is_active', 'created_at')
    
    # حقول البحث
    search_fields = ('name', 'token', 'owner__full_name', 'owner__telegram_id')
    
    # دالة لحساب عدد المشتركين في كل بوت مباشرة
    def get_subscribers_count(self, obj):
        return obj.subscribers.count()
    get_subscribers_count.short_description = _("Subscribers")

@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = ('title', 'owner', 'channel_id', 'member_count', 'status', 'last_sync')
    list_filter = ('status', 'last_sync')
    search_fields = ('title', 'channel_id', 'owner__full_name')
    
    # تلوين القنوات النشطة وغير النشطة في لوحة التحكم (اختياري)
    list_editable = ('status',) 

@admin.register(BotSubscription)
class BotSubscriptionAdmin(admin.ModelAdmin):
    list_display = ('user', 'bot', 'joined_at')
    list_filter = ('bot', 'joined_at')
    search_fields = ('user__full_name', 'user__telegram_id', 'bot__name')
    
    # جعل البيانات للقراءة فقط لمنع التلاعب بسجلات الاشتراك يدوياً
    readonly_fields = ('joined_at',)