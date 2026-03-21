from asgiref.sync import sync_to_async
from apps.accounts.models import TelegramUser, Wallet
from apps.bots.models import SubBot, BotSubscription
from aiogram import types
from .config import BOT_TOKEN, ADMIN_IDS
from .loader import bot

@sync_to_async
def get_or_create_user(tg_user: types.User):
    """جلب أو إنشاء المستخدم بدون محفظة تلقائية"""
    user, created = TelegramUser.objects.get_or_create(
        telegram_id=tg_user.id,
        defaults={
            'full_name': tg_user.full_name,
            'username': tg_user.username,
            'is_partner': False, # القيمة الافتراضية
        }
    )
    return user, created

@sync_to_async
def activate_partner_wallet(user):
    """
    هذه الدالة تُستدعى فقط عندما يربط المستخدم بوتاً أو قناة.
    تقوم بتحويله لشريك وإنشاء محفظته.
    """
    if not user.is_partner:
        user.is_partner = True
        user.save()
    
    wallet, created = Wallet.objects.get_or_create(user=user)
    return wallet, created

# دالة سريعة جداً تعتمد على البحث المباشر
@sync_to_async
def get_user_and_subscription(tg_user_id: int, full_name: str, bot_token: str):
    # 1. جلب المستخدم (ضروري)
    user, _ = TelegramUser.objects.get_or_create(
        telegram_id=tg_user_id,
        defaults={'full_name': full_name}
    )

    # 2. جلب البوت (سريع جداً لأنه بالـ token الفريد)
    # ملاحظة: Django يقوم بعمل Cache داخلي للاستعلامات المتكررة أحياناً
    try:
        bot_inst = SubBot.objects.get(token=bot_token)
        subscription, created = BotSubscription.objects.get_or_create(
            bot=bot_inst,
            user=user
        )
        return user, subscription, created
    except SubBot.DoesNotExist:
        return None, None, False