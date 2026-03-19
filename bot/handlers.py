from aiogram import Router, F, types
from aiogram_i18n import I18nContext
from .db_operations import get_or_create_user

# استيراد الأزرار من المجلد الجديد
from .keyboards.main_menu import get_main_keyboard
from .keyboards.settings import get_language_keyboard

router = Router()

@router.callback_query(F.data == "change_lang")
async def show_language_options(callback: types.CallbackQuery, i18n: I18nContext):
    await callback.message.edit_text(
        text=i18n.get("msg-select-language"),
        reply_markup=get_language_keyboard() # من ملف settings
    )
    await callback.answer()

@router.callback_query(F.data.startswith("set_lang_"))
async def set_user_language(callback: types.CallbackQuery, i18n: I18nContext):
    new_lang = callback.data.split("_")[2]
    await i18n.set_locale(new_lang)
    
    user, _ = await get_or_create_user(callback.from_user)
    
    await callback.message.edit_text(
        text=i18n.get("welcome-back", full_name=user.full_name),
        reply_markup=get_main_keyboard(i18n, user.is_partner) # من ملف main_menu
    )
    await callback.answer()

@router.callback_query(F.data == "back_to_main")
async def back_to_main_menu(callback: types.CallbackQuery, i18n: I18nContext):
    user, _ = await get_or_create_user(callback.from_user)
    await callback.message.edit_text(
        text=i18n.get("welcome-back", full_name=user.full_name),
        reply_markup=get_main_keyboard(i18n, user.is_partner)
    )
    await callback.answer()