from asgiref.sync import sync_to_async
from apps.accounts.models import TelegramUser, Wallet
from apps.bots.models import SubBot, BotSubscription
from aiogram import types

@sync_to_async
def get_user_and_subscription(tg_user: types.User, bot_token: str):
    """
    الدالة المركزية لجلب بيانات المستخدم واشتراكه في البوت الحالي.
    """
    # 1. تحديد اللغة الافتراضية
    detected_lang = tg_user.language_code if tg_user.language_code else 'en'
    final_lang = 'ar' if detected_lang.startswith('ar') else 'en'

    # 2. جلب أو إنشاء المستخدم العام (TelegramUser)
    user, _ = TelegramUser.objects.get_or_create(
        telegram_id=tg_user.id,
        defaults={
            'full_name': tg_user.full_name,
            'username': tg_user.username,
        }
    )

    # 3. جلب البوت الفرعي (SubBot) بناءً على التوكن
    try:
        bot_inst = SubBot.objects.get(token=bot_token, is_active=True)
        
        # 4. جلب أو إنشاء سجل الاشتراك (BotSubscription)
        subscription, created = BotSubscription.objects.get_or_create(
            bot=bot_inst,
            user=user,
            defaults={
                'language': final_lang  # تُضبط فقط عند أول دخول للبوت
            }
        )
        return user, subscription, created
    except SubBot.DoesNotExist:
        return None, None, False

@sync_to_async
def activate_partner_wallet(user):
    """تحويل المستخدم لشريك وتفعيل محفظته عند إضافة أول بوت/قناة"""
    if not user.is_partner:
        user.is_partner = True
        user.save(update_fields=['is_partner']) # تحديث حقل واحد فقط للأداء
    
    wallet, created = Wallet.objects.get_or_create(user=user)
    return wallet, created

@sync_to_async
def get_or_create_user(tg_user: types.User):
    """جلب بيانات المستخدم الأساسية فقط (تُستخدم في العمليات العامة)"""
    user, created = TelegramUser.objects.get_or_create(
        telegram_id=tg_user.id,
        defaults={
            'full_name': tg_user.full_name,
            'username': tg_user.username,
        }
    )
    return user, created