from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram_i18n import I18nContext

def get_main_keyboard(i18n: I18nContext, is_partner: bool):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    # زر اللغة (الوحيد حالياً كما طلبت)
    builder.button(text=_("btn-change-lang"), callback_data="change_lang")
    
    builder.adjust(1)
    return builder.as_markup()