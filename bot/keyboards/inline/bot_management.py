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

def get_my_bots_keyboard(i18n: I18nContext, bots_list):
    """
    توليد قائمة أزرار بالبوتات التي يملكها المستخدم
    bots_list: قائمة من كائنات SubBot القادمة من قاعدة البيانات
    """
    _ = i18n.get
    builder = InlineKeyboardBuilder()

    # 1. إنشاء زر لكل بوت موجود لدى المستخدم
    for bot_item in bots_list:
        status_emoji = "✅" if bot_item.is_active else "❌"
        builder.button(
            text=f"{status_emoji} {bot_item.name} (@{bot_item.username if bot_item.username else 'bot'})",
            callback_data=f"manage_bot_{bot_item.id}" # نستخدم ID البوت للتحكم به لاحقاً
        )

    # 2. زر لإضافة بوت جديد دائماً في الأسفل
    builder.button(
        text=f"➕ {_( 'btn-add-another-bot')}", 
        callback_data="add_new_bot"
    )

    # 3. زر العودة للقائمة الرئيسية
    builder.button(
        text=f"🔙 {_( 'btn-back-main')}", 
        callback_data="back_to_main"
    )

    # تنظيم الأزرار: كل بوت في سطر، والأزرار الأخيرة في سطر مستقل
    builder.adjust(1) 
    return builder.as_markup()