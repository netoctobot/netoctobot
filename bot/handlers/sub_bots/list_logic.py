import asyncio
from aiogram import Router, types, Bot, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.filters import BotTypeFilter
from bot.db_operations import get_user_and_subscription, get_sub_bot_by_token
from bot.utils.formatters import format_personal_message
from bot.keyboards.inline.bot_management import get_LST_owner_control_panel
from apps.bots.models import SubBot
from bot.utils.checks import check_all_subscriptions, handle_force_subscribe
from bot.keyboards.inline.subscriptions import get_force_sub_keyboard
from bot.keyboards.main_menu import get_user_main_menu

router = Router()
router.message.filter(BotTypeFilter(SubBot.BotType.LIST)) # قفل أمان
router.callback_query.filter(BotTypeFilter(SubBot.BotType.LIST))

@router.message(CommandStart())
async def list_bot_start(message: types.Message, bot: Bot, i18n: I18nContext, state: FSMContext):    
    _ = i18n.get
    await state.clear() # تنظيف أي حالة سابقة
    
    # استخدام الدالة المركزية لجلب بيانات المستخدم واشتراكه في هذا البوت
    # الدالة تقوم بإنشاء TelegramUser و BotSubscription تلقائياً
    user, subscription, created = await get_user_and_subscription(
        tg_user=message.from_user,
        bot_token=bot.token
    )

    # إذا لم يتم العثور على البوت في القاعدة (توكن غير مسجل عندنا)
    if not subscription:
        return

    # ضبط اللغة بناءً على ما هو مخزن في اشتراك المستخدم لهذا البوت
    await i18n.set_locale(subscription.language)
    _ = i18n.get

    sub_bot = subscription.bot
    
    not_joined = await check_all_subscriptions(bot, message.from_user.id)
    
    if not_joined:
        return await handle_force_subscribe(message, i18n, sub_bot, not_joined)
    # --- أ: حالة المالك (Owner) ---
    if message.from_user.id == sub_bot.owner.telegram_id:
        owner_text = _("owner-control-panel")
        return await message.answer(
            text=owner_text,
            reply_markup=get_LST_owner_control_panel(i18n, "LST")
        )
    # تحضير رسالة الترحيب
    raw_welcome = sub_bot.welcome_msg or _("msg-list-default-welcome")
    p_mode = sub_bot.welcome_parse_mode
    
    # تنسيق النص بالبيانات الشخصية (اسم المستخدم، الخ)
    text = format_personal_message(raw_welcome, message.from_user, p_mode, i18n)

    await message.answer(
        text=text,
        parse_mode=p_mode if p_mode != "PLAIN" else None,
        disable_web_page_preview=True
    )

@router.callback_query(F.data == "check_again")
async def check_again_callback(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    not_joined = await check_all_subscriptions(bot, callback.from_user.id)
    
    if not_joined:
        await callback.message.edit_text(
            text=_("still-not-subscribed"),
            reply_markup=get_force_sub_keyboard(i18n, not_joined)
            )
    else:
        # إعادة إرسال رسالة الترحيب الأصلية
        sub_bot = await get_sub_bot_by_token(bot.token)
        await callback.message.edit_text(
            text=sub_bot.welcome_msg or _("thank-you-for-subscribing"),
            reply_markup=get_user_main_menu(i18n, sub_bot.bot_type)
        )