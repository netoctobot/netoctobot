import asyncio
from aiogram import Router, types, Bot, F
from aiogram.filters import CommandStart
from aiogram_i18n import I18nContext

from bot.db_operations import get_user_and_subscription
from bot.utils.formatters import format_personal_message
from apps.bots.models import SubBot

router = Router()

# تصفية الرسائل لتشمل البوتات من نوع LIST فقط ومن المحادثات الخاصة
router.message.filter(F.chat.type == "private")

@router.message(CommandStart())
async def list_bot_start(message: types.Message, bot: Bot, i18n: I18nContext):
    # 1. استخدام الدالة المركزية لجلب بيانات المستخدم واشتراكه في هذا البوت
    # الدالة تقوم بإنشاء TelegramUser و BotSubscription تلقائياً
    user, subscription, created = await get_user_and_subscription(
        tg_user=message.from_user,
        bot_token=bot.token
    )

    # إذا لم يتم العثور على البوت في القاعدة (توكن غير مسجل عندنا)
    if not subscription:
        return

    # 2. ضبط اللغة بناءً على ما هو مخزن في اشتراك المستخدم لهذا البوت
    await i18n.set_locale(subscription.language)
    _ = i18n.get

    # 3. التأكد أن البوت فعلياً من نوع LIST (قائمة)
    # (subscription.bot يعطينا الوصول لكائن SubBot المرتبط)
    sub_bot = subscription.bot
    if sub_bot.bot_type != SubBot.BotType.LIST:
        return # نترك المعالج الآخر (contact_logic) يتولى الأمر

    # 4. تحضير رسالة الترحيب
    raw_welcome = sub_bot.welcome_msg or _("msg-list-default-welcome")
    p_mode = sub_bot.welcome_parse_mode
    
    # تنسيق النص بالبيانات الشخصية (اسم المستخدم، الخ)
    text = format_personal_message(raw_welcome, message.from_user, p_mode, i18n)

    # 5. عرض قائمة الدعم (هنا سنضع منطق الأزرار لاحقاً)
    # حالياً سنرسل رسالة الترحيب فقط مع زر تجريبي
    await message.answer(
        text=text,
        parse_mode=p_mode if p_mode != "PLAIN" else None,
        disable_web_page_preview=True
    )