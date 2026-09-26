from aiogram.utils.keyboard import InlineKeyboardBuilder

def get_language_keyboard():
    builder = InlineKeyboardBuilder()
    builder.button(text="العربية 🇸🇦", callback_data="set_lang_ar")
    builder.button(text="English 🇺🇸", callback_data="set_lang_en")
    builder.button(text="Back / رجوع 🔙", callback_data="back_to_main")
    
    builder.adjust(2, 1)
    return builder.as_markup()