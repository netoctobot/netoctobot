from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram_i18n import I18nContext

def get_cancel_keyboard(i18n: I18nContext):
    """زر إلغاء العملية أثناء إدخال التوكن"""
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    # نستخدم callback_data مميز للإلغاء
    builder.button(
        text=f"❌ {_('btn-cancel')}", 
        callback_data="cancel_operation"
    )
    return builder.as_markup()

def get_manage_bot_keyboard(i18n: I18nContext):
    """أزرار بعد إضافة البوت بنجاح أو العودة"""
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    builder.button(text=f"🔙 {_('btn-back-main')}", callback_data="back_to_main")
    return builder.as_markup()