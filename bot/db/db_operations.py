from asgiref.sync import sync_to_async
from apps.accounts.models import TelegramUser, Wallet
from apps.bots.models import (
    SubBot,
    BotSubscription,
    AdminChannel,
    SubBotChannel,
    Channel,
)
from aiogram import types
from bot.config import BOT_TOKEN


@sync_to_async
def get_main_channels_list():
    return list(AdminChannel.objects.all())


@sync_to_async
def get_subbot_channels_list(bot_token):
    # نستخدم .first() لجلب كائن البوت أولاً
    sub_bot = SubBot.objects.filter(token=bot_token).first()
    if sub_bot:
        # نحول القنوات إلى قائمة لضمان فك الارتباط بقاعدة البيانات قبل العودة للـ async
        return list(sub_bot.force_channels.all())
    return []

@sync_to_async
def get_subbot_active_channels_list(sub_bot):
    # نستخدم .first() لجلب كائن البوت أولاً
    bot_channels = (list)(
        SubBotChannel.objects.filter(sub_bot=sub_bot, is_active=True)
        .select_related('channel')
        .order_by('order')
    )
    if not bot_channels:
        return []
    return bot_channels

@sync_to_async
def get_user_and_subscription(tg_user: types.User, bot_token: str):
    """
    الدالة المركزية لجلب بيانات المستخدم واشتراكه في البوت الحالي.
    """
    # 1. تحديد اللغة الافتراضية
    detected_lang = tg_user.language_code if tg_user.language_code else "en"
    final_lang = "ar" if detected_lang.startswith("ar") else "en"

    # 2. جلب أو إنشاء المستخدم العام (TelegramUser)
    user, _ = TelegramUser.objects.get_or_create(
        telegram_id=tg_user.id,
        defaults={
            "full_name": tg_user.full_name,
            "username": tg_user.username,
        },
    )

    # 3. جلب البوت الفرعي (SubBot) بناءً على التوكن
    try:
        bot_inst = SubBot.objects.get(token=bot_token, is_active=True)

        # 4. جلب أو إنشاء سجل الاشتراك (BotSubscription)
        subscription, created = BotSubscription.objects.get_or_create(
            bot=bot_inst,
            user=user,
            defaults={"language": final_lang},  # تُضبط فقط عند أول دخول للبوت
        )
        return user, subscription, created
    except SubBot.DoesNotExist:
        return None, None, False


@sync_to_async
def activate_partner_wallet(user):
    """تحويل المستخدم لشريك وتفعيل محفظته عند إضافة أول بوت/قناة"""
    if not user.is_partner:
        user.is_partner = True
        user.save(update_fields=["is_partner"])  # تحديث حقل واحد فقط للأداء

    wallet, created = Wallet.objects.get_or_create(user=user)
    return wallet, created


@sync_to_async
def get_or_create_user(tg_user: types.User):
    """جلب بيانات المستخدم الأساسية فقط (تُستخدم في العمليات العامة)"""
    user, created = TelegramUser.objects.get_or_create(
        telegram_id=tg_user.id,
        defaults={
            "full_name": tg_user.full_name,
            "username": tg_user.username,
        },
    )
    return user, created


@sync_to_async
def get_user_bots(user, master_token=BOT_TOKEN):  # <-- أضف master_token هنا
    """جلب بوتات المستخدم مع استثناء البوت الماستر"""
    from apps.bots.models import SubBot

    # نقوم باستبعاد (exclude) البوت الذي يحمل توكن الماستر لكي لا يظهر في قائمة الحذف
    return list(
        SubBot.objects.filter(owner=user)
        .exclude(token=master_token)
        .order_by("-created_at")
    )


@sync_to_async
def get_sub_bot_by_id(bot_id, owner):
    """جلب بوت معين والتأكد من أنه يخص المستخدم الحالي"""
    try:
        return SubBot.objects.get(id=bot_id, owner=owner)
    except Exception:
        return None


@sync_to_async
def get_sub_bot_by_token(bot_token):
    """جلب بوت معين والتأكد من أنه يخص المستخدم الحالي"""
    try:
        return SubBot.objects.get(token=bot_token)
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
        token = sub_bot.token
        sub_bot.delete()
        return token
    except Exception:
        return None


@sync_to_async
def get_sub_bot_channels_list(sub_bot):
    """جلب قائمة القنوات المرتبطة ببوت فرعي محدد مع بيانات القناة الأصلية"""
    return list(
        SubBotChannel.objects.filter(sub_bot=sub_bot)
        .select_related("channel")
        .order_by("order")
    )


@sync_to_async
def delete_sub_bot_channel(bot_chan_id):
    """حذف ارتباط القناة بالبوت الفرعي"""
    try:
        obj = SubBotChannel.objects.select_related("channel").get(id=bot_chan_id)
        name = obj.channel.title
        obj.delete()
        return name
    except SubBotChannel.DoesNotExist:
        return None


# bot\db_operations.py

@sync_to_async
def add_channel_to_sub_bot_logic(sub_bot, chat_id, title, username, invite_link, telegram_user_id):
    """المنطق الشامل لإضافة قناة/مجموعة للبوت الفرعي"""
    
    # 1. جلب أو إنشاء المستخدم الذي قام بالإضافة في قاعدة بياناتنا
    user_obj = TelegramUser.objects.get(telegram_id=telegram_user_id)
    
    # 2. تحديث أو إنشاء القناة العامة
    channel, _ = Channel.objects.update_or_create(
        channel_id=chat_id,
        defaults={
            'owner': user_obj,
            'title': title,
            'username': username.replace("@", "") if username else None,
            'invite_link': invite_link
        }
    )

    # 3. تحديد هل المضيف هو صاحب البوت (المالك) أم شخص غريب (شريك)
    is_owner = (sub_bot.owner.telegram_id == telegram_user_id)
    
    # 4. ربط القناة بالبوت الفرعي
    # إذا كان المالك: الحالة True | إذا كان شريك: الحالة False (بانتظار الموافقة)
    sub_chan, created = SubBotChannel.objects.get_or_create(
        sub_bot=sub_bot,
        channel=channel,
        defaults={'is_active': is_owner}
    )

    if not created:
        return False, "exists", is_owner

    # 5. إذا كان شريكاً، نفعل محفظته فوراً (دالتك السابقة)
    if not is_owner:
        activate_partner_wallet(user_obj)

    return True, "success", is_owner