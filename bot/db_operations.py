from asgiref.sync import sync_to_async
from apps.accounts.models import TelegramUser, Wallet
from aiogram import types

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