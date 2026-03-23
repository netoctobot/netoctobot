from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram_i18n import I18nContext

def get_main_keyboard(i18n: I18nContext, is_admin: bool = False, is_partner: bool = False):
    _ = i18n.get
    builder = InlineKeyboardBuilder()

    # --- أزرار المستخدم العادي (تظهر للكل) ---
    # 1. الأزرار الأساسية (إضافة بوت وعرض البوتات)
    builder.button(text=f"{_( 'btn-add-my-bot')}", callback_data="add_new_bot")
    builder.button(text=f"{_( 'btn-my-bots')}", callback_data="list_my_bots")
    
    # 2. أزرار المستخدم الشخصية
    builder.button(text=_("btn-my-profile"), callback_data="user_profile")
    builder.button(text=_("btn-support"), callback_data="contact_support")

    # --- أزرار خاصة بالشركاء (Partners) ---
    if is_partner:
        builder.button(text=_("btn-partner-panel"), callback_data="partner_dashboard")

    # --- زر لإدارة البوتات الفرعية (الأخطبوط) ---
    if is_admin:
        builder.button(text=_('btn-manage-octopus'), callback_data="manage_sub_bots")
        builder.button(text=_('btn-system-settings'), callback_data="admin_settings")
    
    # زر تغيير اللغة (يظهر للكل في الأسفل)
    builder.button(text=_('btn-change-lang'), callback_data="change_lang")
    builder.adjust(2,2,2, 1) 
    return builder.as_markup()

def get_user_main_menu(i18n, bot_type):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    if bot_type == "LST":
        builder.button(text=_("show-channel"), callback_data="show_list")
    
    builder.button(text=_("technical-support"), callback_data="support")
    builder.adjust(1)
    return builder.as_markup()