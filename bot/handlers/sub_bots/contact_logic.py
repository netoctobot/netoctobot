import re
import asyncio
from aiogram import Router, types, F, Bot
from bot.utils.formatters import format_personal_message
from bot.utils.common import delete_message_after
from aiogram.filters import Command, CommandStart
from aiogram_i18n import I18nContext
from asgiref.sync import sync_to_async
from apps.bots.models import SubBot
from apps.accounts.models import TelegramUser
from aiogram.utils.keyboard import InlineKeyboardBuilder
from bot.config import BOT_TOKEN, ADMIN_IDS
from bot.db_operations import get_user_and_subscription, get_sub_bot_by_token

router = Router()
router.message.filter(F.bot.token != BOT_TOKEN)

@router.message(CommandStart())
async def sub_bot_start(message: types.Message, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    sub_bot = await sync_to_async(SubBot.objects.filter(token=bot.token).first)()
    
    if sub_bot:
        raw_welcome = sub_bot.welcome_msg or _("msg-defult-welcome")
        p_mode = sub_bot.welcome_parse_mode # القيمة المخزنة (HTML أو MDV2)
        
        # 1. تنسيق النص بالبيانات الشخصية
        personalized_text = format_personal_message(raw_welcome, message.from_user, p_mode,i18n)
                
        await message.answer(
            text=personalized_text,
            parse_mode=p_mode if p_mode != "PLAIN" else None,
            disable_web_page_preview=True
        )

@router.message(F.reply_to_message)
async def handle_owner_reply_smart(message: types.Message, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    reply = message.reply_to_message
    user_id = None

    sub_bot = await sync_to_async(SubBot.objects.filter(token=bot.token).select_related('owner').first)()
    if not sub_bot: return
    if message.from_user.id != sub_bot.owner.telegram_id:
        # إذا لم يكن المالك، نخرج ونترك المعالج الآخر يتولى الأمر
        return await handle_sub_bot_messages(message, bot, i18n)

    # الحالة 1: الرد على رسالة موجهة مباشرة (Forward)
    if reply.forward_from:
        user_id = reply.forward_from.id
    # جلب الـ ID من أزرار الـ Inline (أضمن طريقة)
    elif reply.reply_markup:
        for row in reply.reply_markup.inline_keyboard:
            for button in row:
                if button.callback_data and button.callback_data.startswith("view_sender_"):
                    user_id = int(button.callback_data.split("_")[-1])
                    break
    # الحالة 2: الرد على رسالة البوت التوضيحية (استخراج الـ ID من النص)
    if not user_id and reply.html_text:
        # نبحث عن نمط الرقم (ID) في نص الرسالة التي يرد عليها صاحب البوت
        # جلب النمط من الترجمة
        raw_pattern = _("search-sender-id") 
        match = re.search(raw_pattern, reply.html_text)

        if match:
            user_id = int(match.group(1))

    # تنفيذ الإرسال إذا تم إيجاد الـ ID
    if user_id:
        try:
            await bot.copy_message(
                chat_id=user_id,
                from_chat_id=message.chat.id,
                message_id=message.message_id
            )
            await message.react([types.ReactionTypeEmoji(emoji="👍")])
        except Exception as e:
            await message.reply(_("msg-err-reply",e=e))
    else:
        await message.reply(_("msg-not-user-id"))


@router.message(F.chat.type == "private")
async def handle_sub_bot_messages(message: types.Message, bot: Bot, i18n: I18nContext):
    
    _ = i18n.get
    # 1. جلب بيانات البوت والمالك
    sub_bot = await sync_to_async(SubBot.objects.filter(token=bot.token).first)()
    if not sub_bot: return
    
    owner_id = sub_bot.owner.telegram_id
    if owner_id == message.from_user.id:
        warning_msg = await message.reply(text=_("msg-warning-reply-required"))
        asyncio.create_task(delete_message_after(warning_msg))
        return

    # 2. محاولة إعادة التوجيه
    forwarded_msg = None
    try:
        forwarded_msg = await message.forward(chat_id=owner_id)
    except Exception:
        pass # فشل التوجيه تماماً

    # 3. التحقق من الخصوصية: هل نجح التوجيه وهل الحساب متاح؟
    # إذا كان الحساب مخفي (forward_from هو None) أو التوجيه فشل أصلاً
    is_private = forwarded_msg is None or forwarded_msg.forward_from is None

    # 4. إرسال رسالة التحكم "فقط" عند وجود خصوصية
    if is_private:
        builder = InlineKeyboardBuilder()
        # الزر الأول الحقيقي
        builder.button(text="👤 الحساب الحقيقي", url=f"tg://user?id={message.from_user.id}")
        # الزر الثاني للبيانات
        builder.button(text="ℹ️ بياناتنا", callback_data=f"view_sender_{message.from_user.id}")
        builder.adjust(2)
        
        await bot.send_message(
            chat_id=owner_id,
            text=f"📥 <b>رسالة من حساب خاص:</b>\n👤 {message.from_user.full_name}\n🆔 <code>{message.from_user.id}</code>\n\n⚠️ للرد: استعمل الـ (Reply) على هذه الرسالة.",
            reply_markup=builder.as_markup()
        )
    
    # 5. التفاعل للمرسل دائماً لتأكيد الاستلام
    await message.react([types.ReactionTypeEmoji(emoji="👍")])


@router.callback_query(F.data.startswith("view_sender_"))
async def view_sender_profile(callback: types.CallbackQuery):
    sender_id = callback.data.split("_")[-1]

    user = await sync_to_async(TelegramUser.objects.filter(telegram_id=sender_id).first)()

    if user:
        # إظهار البيانات في بوب أب نظيف جداً
        await callback.answer(
            text=f"👤 الاسم: {user.full_name}\n💎 الحالة: {'شريك' if user.is_partner else 'عادي'}",
            show_alert=True
        )
    else:
        # بوب أب للفشل
        await callback.answer(text="⚠️ غير مسجل في قاعدة بياناتنا", show_alert=True)