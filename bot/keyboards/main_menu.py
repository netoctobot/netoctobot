from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram_i18n import I18nContext

def get_main_keyboard(i18n: I18nContext, is_admin: bool = False, is_partner: bool = False):
    _ = i18n.get
    builder = InlineKeyboardBuilder()

    # --- أزرار المستخدم العادي (تظهر للكل) ---
    # زر إضافة بوت جديد (متاح للجميع)
    builder.button(text=f"➕ {i18n.get('btn-add-my-bot')}", callback_data="add_new_bot")
    
    # زر عرض بوتاتي (لمتابعة البوتات التي أضافها المستخدم سابقاً)
    builder.button(text=f"🤖 {i18n.get('btn-my-bots')}", callback_data="list_my_bots")
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
    builder.adjust(1)
    return builder.as_markup()