from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.config import ADMIN_IDS
from aiogram.utils.keyboard import InlineKeyboardBuilder
from bot.utils.interface import update_main_interface
from bot.db_operations import get_user_and_subscription

# تعريف الراوتر الخاص بهذا الملف
router = Router()

@router.callback_query(F.data == "cancel_operation")
async def cancel_handler(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot):
    """معالج زر الإلغاء: يمسح الحالة ويعيد المستخدم للقائمة الرئيسية"""
    _ = i18n.get
    
    # 1. مسح أي حالة (FSM) نشطة
    await state.clear()
    
    # 2. جلب بيانات المستخدم لإظهار القائمة الرئيسية الصحيحة (Admin/Partner)
    from bot.db_operations import get_user_and_subscription
    from bot.keyboards.main_menu import get_main_keyboard
    from bot.utils.interface import update_main_interface
    
    user, subscription, created = await get_user_and_subscription(callback.from_user, bot.token)
    
    # 3. تحديث الواجهة للعودة للرئيسية
    await update_main_interface(
        bot=bot,
        chat_id=callback.message.chat.id,
        subscription=subscription,
        text=_("welcome-back", full_name=user.full_name),
        reply_markup=get_main_keyboard(
            i18n, 
            is_admin=(user.telegram_id in ADMIN_IDS), # تأكد من تعريف ADMIN_IDS
            is_partner=user.is_partner
        )
    )
    
    # 4. تنبيه سريع للمستخدم (Toast)
    await callback.answer(_("toast-cancelled"))

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