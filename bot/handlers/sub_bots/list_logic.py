import asyncio
from aiogram import Router, types, F, Bot
from aiogram.filters import CommandStart
from aiogram_i18n import I18nContext
from asgiref.sync import sync_to_async
from apps.bots.models import SubBot, BotSubscription
from bot.utils.formatters import format_personal_message

router = Router()

# فلاتر لضمان أن هذا الراوتر يعمل فقط للبوتات من نوع LIST
router.message.filter(F.chat.type == "private")

@router.message(CommandStart())
async def list_bot_start(message: types.Message, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    
    # 1. جلب بيانات البوت من قاعدة البيانات
    sub_bot = await sync_to_async(
        SubBot.objects.filter(token=bot.token, bot_type=SubBot.BotType.LIST).first
    )()
    
    if not sub_bot:
        return # هذا البوت ليس من نوع "قائمة" أو غير موجود

    # 2. تسجيل المستخدم في نظام العزل (BotSubscription) أو تحديث بياناته
    # لضمان حفظ لغته وتاريخ انضمامه لهذا البوت تحديداً
    subscription, created = await sync_to_async(BotSubscription.objects.get_or_create)(
        bot=sub_bot,
        user_id=message.from_user.id,
        defaults={'language': i18n.locale}
    )

    # 3. تحضير رسالة الترحيب
    raw_welcome = sub_bot.welcome_msg or _("msg-list-default-welcome")
    p_mode = sub_bot.welcome_parse_mode
    
    # تنسيق الرسالة (اسم المستخدم، الخ)
    text = format_personal_message(raw_welcome, message.from_user, p_mode, i18n)

    # 4. بناء القائمة (قوائم الدعم) - سنفترض وجود نظام أزرار لاحقاً
    # هنا يمكنك إضافة منطق جلب القنوات المرتبطة بالبوت
    
    await message.answer(
        text=text,
        parse_mode=p_mode if p_mode != "PLAIN" else None,
        disable_web_page_preview=True
    )