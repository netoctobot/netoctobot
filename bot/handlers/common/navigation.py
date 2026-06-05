import asyncio
from typing import Union
from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.config import ADMIN_IDS
from aiogram.utils.keyboard import InlineKeyboardBuilder
from bot.utils.common import delete_message_after
from bot.utils.interface import update_main_interface, show_main_menu_edit, return_to_bot_settings
from bot.db.db_operations import get_user_and_subscription
from bot.utils.checks import check_all_subscriptions, get_force_sub_keyboard
from bot.keyboards.inline.bot_management import get_parse_mode_keyboard, get_LST_user_main_keyboard
from bot.states.sub_bot_states import SubBotSettingsSG, AddChannelSG
from bot.loader import bot as main_bot
from bot.keyboards.inline.bot_management import get_LST_owner_control_panel
from bot.keyboards.main_menu import get_user_main_menu
from bot.utils.formatters import format_personal_message

# تعريف الراوتر الخاص بهذا الملف
router = Router()

async def perform_navigation(bot: Bot, i18n: I18nContext, user, subscription, event: Union[types.Message, types.CallbackQuery]):
    _ = i18n.get
    tg_user = event.from_user
    chat_id = event.chat.id if isinstance(event, types.Message) else event.message.chat.id

    # 1. التحقق من الاشتراكات الإجبارية
    not_joined = await check_all_subscriptions(bot, tg_user.id)
    
    if not_joined:
        markup = await get_force_sub_keyboard(i18n, not_joined, bot)
        text = _("still-not-subscribed")
        
        # إذا كان الحدث عبارة عن ضغطة زر "تحقق"، نظهر تنبيه سريع
        if isinstance(event, types.CallbackQuery):
            await event.answer(_("msg-not-joined-all"), show_alert=True)

        return await update_main_interface(bot, chat_id, subscription, text, markup)

    # 2. إذا اشترك بنجاح أو كان مشتركاً بالفعل
    if isinstance(event, types.CallbackQuery):
        await event.answer(_("msg-success-subscription"))
        
    await i18n.set_locale(subscription.language)

    # --- تحديد الوجهة المنطقية (رئيسي أم فرعي) ---
    text = ""
    reply_markup = None
    parse_mode = "HTML"

    if bot.token == main_bot.token:
        # البوت الرئيسي للمنصة
        from bot.keyboards.main_menu import get_main_keyboard
        text = _("welcome-back", full_name=user.full_name)
        reply_markup = get_main_keyboard(
            i18n, 
            is_admin=(tg_user.id in ADMIN_IDS), 
            is_partner=user.is_partner
        )
    else:
        # بوت فرعي (لستة أو تواصل)
        sub_bot = subscription.bot
        if tg_user.id == sub_bot.owner.telegram_id:
            # لوحة تحكم المالك
            text = _("owner-control-panel")
            reply_markup = get_LST_owner_control_panel(i18n, sub_bot.bot_type)
        else:
            # واجهة المستخدم العادي للبوت الفرعي
            default_key = "msg-list-default-welcome" if sub_bot.bot_type == "LST" else "msg-defult-welcome"
            raw_welcome = sub_bot.welcome_msg or _(default_key)
            parse_mode = sub_bot.welcome_parse_mode
            text = format_personal_message(raw_welcome, tg_user, parse_mode, i18n)
            
            if sub_bot.bot_type == "LST":
                reply_markup = get_LST_user_main_keyboard(i18n)
            else:
                reply_markup = get_user_main_menu(i18n, sub_bot.bot_type)

    # تحديث الواجهة النهائية (حذف القديم وإرسال الجديد)
    await update_main_interface(
        bot=bot,
        chat_id=chat_id,
        subscription=subscription,
        text=text,
        reply_markup=reply_markup,
        parse_mode=parse_mode if parse_mode != "PLAIN" else None
    )

@router.callback_query(F.data == "check_again")
async def check_again_handler(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    user, subscription, is_new_user = await get_user_and_subscription(callback.from_user, bot.token)
    if subscription:
        await perform_navigation(bot, i18n, user, subscription, callback)


@router.callback_query(F.data == "ok_and_remove")
async def cancel_handler(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot):
    asyncio.create_task(delete_message_after(callback.message,3))


@router.callback_query(F.data == "cancel_operation")
async def cancel_handler(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    current_state = await state.get_state()

    # إذا لم يكن هناك حالة نشطة، نعدله للرئيسية (احتياطاً)
    if current_state is None:
        return await show_main_menu_edit(callback, i18n, bot, state)

    # --- منطق العودة خطوة للخلف بناءً على الحالة ---
    
    # 1. إذا كان ينتظر النص -> نعيده لاختيار التنسيق
    if current_state == SubBotSettingsSG.waiting_for_welcome_msg:
        data = await state.get_data()
        bot_id = data.get('target_bot_id')
        await state.set_state(SubBotSettingsSG.waiting_for_parse_mode)

        await callback.message.edit_text(
            text=_("msg-select-parse-mode"),
            reply_markup=get_parse_mode_keyboard(i18n,bot_id)
        )

    # 2. إذا كان في اختيار التنسيق -> نعيده لواجهة إدارة البوت
    elif current_state == SubBotSettingsSG.waiting_for_parse_mode:
        data = await state.get_data()
        bot_id = data.get('target_bot_id')
        await state.clear()
        # هنا نستدعي دالة إدارة البوت التي برمجناها سابقاً لكن بصيغة edit
        await return_to_bot_settings(callback, bot_id, i18n, bot)
    
    elif current_state == AddChannelSG.waiting_for_forward:
        data = await state.get_data()
        bot_id = data.get('target_bot_id')
        await state.clear()
        # هنا نستدعي دالة إدارة البوت التي برمجناها سابقاً لكن بصيغة edit
        await return_to_bot_settings(callback, bot_id, i18n, bot)

    else:
        # لأي حالة أخرى غير معرفة، نعود للرئيسية
        await show_main_menu_edit(callback, i18n, bot, state)
    
    await callback.answer()

@router.callback_query(F.data.in_({
    "user_profile",
    "partner_dashboard", 
    "manage_sub_bots", 
    "admin_settings",
    "user_wallet",
    "list_info"
}))

async def placeholder_handler(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
        
    # 2. نص الرسالة
    text = f"⚠️ {_('msg-feature-not-ready')}\n\n{_('msg-stay-tuned')}"
    
    await callback.answer(
        text=text,show_alert=True
    )
    await callback.answer()