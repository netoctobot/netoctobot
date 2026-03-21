from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.config import ADMIN_IDS

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