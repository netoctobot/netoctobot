from aiogram import Router, F, types, Bot
from aiogram_i18n import I18nContext
from ...db_operations import get_user_and_subscription
# استيراد الأزرار من المجلد الجديد
from ...keyboards.main_menu import get_main_keyboard
from ...keyboards.inline.settings import get_language_keyboard
from bot.config import ADMIN_IDS
from aiogram.filters import CommandStart
from aiogram_i18n import I18nContext
from bot.utils.interface import update_main_interface

router = Router()

@router.message(CommandStart())
async def cmd_start(message: types.Message, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    # جلب بيانات المستخدم والاشتراك (سريع جداً الآن)
    user, subscription, created = await get_user_and_subscription(
        tg_user=message.from_user,
        bot_token=bot.token  
    )
    is_system_admin = message.from_user.id in ADMIN_IDS
    
    if not subscription:
        return # أو إرسال رسالة تخبره أن البوت غير مسجل
    
    # 🔥 التعديل الأهم: فرض لغة الاشتراك على السياق الحالي
    await i18n.set_locale(subscription.language)

    # اختيار النص بناءً على حالة الاشتراك
    key = "welcome-new" if created else "welcome-back"
    text = _(key, full_name=user.full_name)
    
    # استخدام الواجهة المتجددة (حذف الرسالة القديمة وتثبيت الجديدة)
    await update_main_interface(
        bot=bot,
        chat_id=message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=get_main_keyboard(
            i18n,
            is_admin=is_system_admin,
            is_partner=user.is_partner
            )
    )


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
            is_admin=(callback.from_user.id in ADMIN_IDS), # أو حسب منطق الـ config
            is_partner=user.is_partner
        )
    )
    await callback.answer()