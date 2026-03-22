from asgiref.sync import sync_to_async
from apps.accounts.models import TelegramUser, Wallet
from apps.bots.models import SubBot, BotSubscription
from aiogram import types
from bot.config import BOT_TOKEN

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

@sync_to_async
def get_user_bots(user, master_token=BOT_TOKEN): # <-- أضف master_token هنا
    """جلب بوتات المستخدم مع استثناء البوت الماستر"""
    from apps.bots.models import SubBot
    
    # نقوم باستبعاد (exclude) البوت الذي يحمل توكن الماستر لكي لا يظهر في قائمة الحذف
    return list(
        SubBot.objects.filter(owner=user)
        .exclude(token=master_token)
        .order_by('-created_at')
    )

@sync_to_async
def get_sub_bot_by_id(bot_id, owner):
    """جلب بوت معين والتأكد من أنه يخص المستخدم الحالي"""
    try:
        return SubBot.objects.get(id=bot_id, owner=owner)
    except Exception:
        return None

@sync_to_async
def get_sub_bot_by_token(bot_token, owner):
    """جلب بوت معين والتأكد من أنه يخص المستخدم الحالي"""
    try:
        return SubBot.objects.get(token=bot_token, owner=owner)
    except Exception:
        return None

@sync_to_async
def toggle_sub_bot_status(bot_id, owner):
    """تغيير حالة البوت من نشط إلى متوقف والعكس"""
    try:
        sub_bot = SubBot.objects.get(id=bot_id, owner=owner)
        sub_bot.is_active = not sub_bot.is_active
        sub_bot.save()
        return sub_bot
    except Exception:
        return None
    
@sync_to_async
def delete_sub_bot(bot_id, owner):
    """حذف البوت نهائياً من قاعدة البيانات"""
    try:
        sub_bot = SubBot.objects.get(id=bot_id, owner=owner)
        sub_bot.delete()
        return True
    except Exception:
        return False