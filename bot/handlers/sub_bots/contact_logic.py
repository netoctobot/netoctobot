import re
from aiogram import Router, types, F, Bot
from bot.utils.formatters import format_personal_message
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

@router.message(F.chat.type == "private")
async def handle_sub_bot_messages(message: types.Message, bot: Bot):

    # 1. جلب بيانات البوت والمالك
    sub_bot = await sync_to_async(SubBot.objects.filter(token=bot.token).first)()
    if not sub_bot: return
    
    owner_id = sub_bot.owner.telegram_id

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

@router.message(F.reply_to_message)
async def handle_owner_reply_smart(message: types.Message, bot: Bot):
    reply = message.reply_to_message
    user_id = None

    # الحالة 1: الرد على رسالة موجهة مباشرة (Forward)
    if reply.forward_from:
        user_id = reply.forward_from.id
    
    # الحالة 2: الرد على رسالة البوت التوضيحية (استخراج الـ ID من النص)
    else:
        # نبحث عن نمط الرقم (ID) في نص الرسالة التي يرد عليها صاحب البوت
        match = re.search(r"آيدي المرسل:<\/b> <code>(\d+)<\/code>", reply.html_text)
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
            await message.react([types.ReactionTypeEmoji(emoji="✅")])
        except Exception as e:
            await message.reply(f"❌ <b>فشل التوصيل:</b> المستخدم أغلق البوت.\n<code>{e}</code>")
    else:
        await message.reply(
            "⚠️ <b>تعذر تحديد المستلم!</b>\n\n"
            "يرجى الرد (Reply) على رسالة البوت التي تحتوي على 'آيدي المرسل'."
        )

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