from aiogram import Router, F, types
from aiogram_i18n import I18nContext
from ...db_operations import get_user_and_subscription
# استيراد الأزرار من المجلد الجديد
from ...keyboards.main_menu import get_main_keyboard
from ...keyboards.inline.settings import get_language_keyboard
router = Router()

@router.callback_query(F.data == "back_to_main")
async def back_to_main_menu(callback: types.CallbackQuery, i18n: I18nContext, bot: types.Bot):
    # جلب بيانات الاشتراك لضمان ظهور الأزرار الصحيحة (Partner/Admin)
    user, subscription, _ = await get_user_and_subscription(
        tg_user=callback.from_user,
        bot_token=bot.token
    )
    
    await callback.message.edit_text(
        text=i18n.get("welcome-back", full_name=user.full_name),
        reply_markup=get_main_keyboard(
            i18n, 
            is_admin=(callback.from_user.id in [6788475988, 6459379370]), # أو حسب منطق الـ config
            is_partner=user.is_partner
        )
    )
    await callback.answer()