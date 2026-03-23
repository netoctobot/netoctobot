from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.config import ADMIN_IDS
from aiogram.utils.keyboard import InlineKeyboardBuilder
from bot.utils.interface import update_main_interface, show_main_menu_edit, return_to_bot_settings
from bot.db_operations import get_user_and_subscription
from bot.keyboards.inline.bot_management import get_parse_mode_keyboard
from bot.states.sub_bot_states import SubBotSettingsSG, AddChannelSG

# تعريف الراوتر الخاص بهذا الملف
router = Router()

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
    "contact_support", 
    "partner_dashboard", 
    "manage_sub_bots", 
    "admin_settings"
}))

async def placeholder_handler(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    
    # 1. جلب بيانات الاشتراك لتحديث الواجهة (نفس الرسالة الأساسية)
    user, subscription, __ = await get_user_and_subscription(callback.from_user, bot.token)
    
    # 2. نص الرسالة
    text = f"⚠️ <b>{_('msg-feature-not-ready')}</b>\n\n{_('msg-stay-tuned')}"
    
    # 3. كيبورد يحتوي على زر العودة للقائمة الرئيسية فقط
    builder = InlineKeyboardBuilder()
    builder.button(text=_("btn-back-to-main"), callback_data="cancel_operation") # نستخدم cancel_operation التي برمجناها سابقاً للعودة
    
    await update_main_interface(
        bot=bot,
        chat_id=callback.message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=builder.as_markup()
    )
    await callback.answer()