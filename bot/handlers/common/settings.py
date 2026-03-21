from aiogram import Router, F, types, Bot
from aiogram_i18n import I18nContext
from ...db_operations import get_user_and_subscription
from asgiref.sync import sync_to_async
# استيراد الأزرار من المجلد الجديد
from ...keyboards.main_menu import get_main_keyboard
from ...keyboards.settings import get_language_keyboard

router = Router()

@router.callback_query(F.data == "change_lang")
async def show_language_options(callback: types.CallbackQuery, i18n: I18nContext):
    await callback.message.edit_text(
        text=i18n.get("msg-select-language"),
        reply_markup=get_language_keyboard(i18n)
    )
    await callback.answer()

@router.callback_query(F.data.startswith("set_lang_"))
async def set_user_language(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    new_lang = callback.data.split("_")[2]
    
    user, subscription, _ = await get_user_and_subscription(
        tg_user=callback.from_user,
        bot_token=bot.token
    )
    
    if subscription:
        subscription.language = new_lang
        await sync_to_async(subscription.save)()
        await i18n.set_locale(new_lang)
    
    await callback.message.edit_text(
        text=i18n.get("welcome-back", full_name=user.full_name),
        reply_markup=get_main_keyboard(
            i18n, 
            is_admin=(callback.from_user.id in [6788475988]), # مثال
            is_partner=user.is_partner
        )
    )
    await callback.answer()