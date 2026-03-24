from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram_i18n import I18nContext
from aiogram import types

def get_cancel_keyboard(i18n: I18nContext):
    """زر إلغاء عملية أثناء الإدخال"""
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    # نستخدم callback_data مميز للإلغاء
    builder.button(
        text=_('btn-cancel'), 
        callback_data="cancel_operation"
    )
    return builder.as_markup()


def get_add_bot_as_admin_and_cancel(i18n: I18nContext, bot_username: str):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    
    builder.row(types.InlineKeyboardButton(
        text=_('btn-add-bot-to-channel'),
        url=f"https://t.me/{bot_username}?startchannel&admin="
            f"post_messages+edit_messages+delete_messages+edit_messages+invite_users"
    ),types.InlineKeyboardButton(
        text=_('btn-add-bot-to-group'),
        url=f"https://t.me/{bot_username}?startgroup&admin=post_messages+edit_messages+delete_messages+invite_users"
    )
                )
    
    builder.row(types.InlineKeyboardButton(
        text=_('btn-cancel'),
        callback_data="manage_channels"
    ))
    
    return builder.as_markup()

def get_manage_bot_keyboard(i18n: I18nContext):
    """أزرار بعد إضافة البوت بنجاح أو العودة"""
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    builder.button(text=f"{_('btn-back-main')}", callback_data="back_to_main")
    return builder.as_markup()

def get_my_bots_keyboard(i18n: I18nContext, channels):
    """
    توليد قائمة أزرار بالبوتات التي يملكها المستخدم
    bots_list: قائمة من كائنات SubBot القادمة من قاعدة البيانات
    """
    _ = i18n.get
    builder = InlineKeyboardBuilder()

    # إنشاء زر لكل بوت موجود لدى المستخدم
    for bot_chan in channels:
        status_emoji = "✅" if bot_chan.is_active else "⏳"
        
        # الصف الأول: اسم القناة مع حالتها
        builder.row(types.InlineKeyboardButton(
            text=f"{status_emoji} {bot_chan.channel.title}",
            callback_data=f"toggle_chan_{bot_chan.id}" # تبديل الحالة
        ))
        
        # الصف الثاني: أزرار التحكم (عرض وحذف)
        builder.row(
            types.InlineKeyboardButton(text="show-channel", url=f"https://t.me/{bot_chan.channel.username}" if bot_chan.channel.username else bot_chan.channel.invite_link),
            types.InlineKeyboardButton(text="delete-channel", callback_data=f"delete_chan_{bot_chan.id}"),
            width=2
        )

    # أزرار التحكم الثابتة (كل واحد في صف مستقل)
    builder.row(types.InlineKeyboardButton(text=_("add-new-channel"), callback_data="add_channel"))
    builder.row(types.InlineKeyboardButton(text=_("btn-back"), callback_data="back_to_owner_panel"))
 
    return builder.as_markup()

def get_bot_settings_keyboard(i18n: I18nContext, sub_bot):
    _ = i18n.get
    builder = InlineKeyboardBuilder()

    # زر حالة البوت (إيقاف أو تشغيل)
    toggle_text = _("btn-stop-bot") if sub_bot.is_active else _("btn-start-bot")
    toggle_data = f"toggle_bot_{sub_bot.id}"
    builder.button(text=toggle_text, callback_data=toggle_data)

    # زر حذف البوت
    builder.button(text=_("btn-delete-bot"), callback_data=f"confirm_delete_{sub_bot.id}")

    # زر تعديل الرسالة الترحيبية
    builder.button(text=_("btn-edit-welcome-bot"), callback_data=f"welcome_options_{sub_bot.id}")

    # زر العودة لقائمة "بوتاتي"
    builder.button(text=_("btn-back-to-list"), callback_data="list_my_bots")

    builder.adjust(2)
    return builder.as_markup()

def get_parse_mode_keyboard(i18n: I18nContext, bot_id):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    builder.button(text=_("HTML-recommanded"), callback_data="set_mode_HTML")
    builder.button(text="Markdown V2", callback_data="set_mode_MDV2")
    builder.button(text=_("btn-plain-text"), callback_data="set_mode_PLAIN")
    builder.button(text=_("btn-back"), callback_data=f"manage_bot_{bot_id}") # العودة لإعدادات البوت
    builder.adjust(2, 1)
    return builder.as_markup()


def get_LST_owner_control_panel(i18n, bot_type):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    if bot_type == "LST":
        builder.button(text=_("add-channel"), callback_data="add_channel")
        builder.button(text=_("channel-management"), callback_data="manage_channels")
        builder.button(text=_("publish-list"), callback_data="broadcast_list")
    else: # CON
        builder.button(text=_("incoming-messages"), callback_data="view_messages")
    
    builder.button(text=_("bot-settings"), callback_data="bot_settings")
    builder.adjust(2)
    return builder.as_markup()

def get_channels_management_keyboard(i18n, channels):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    for bot_chan in channels:
        # زر لحذف القناة
        builder.button(
            text=f"❌ {bot_chan.channel.title}", 
            callback_data=f"delete_chan_{bot_chan.id}"
        )
    
    builder.button(text=_("add-new-channel"), callback_data="add_channel")
    builder.button(text=_("btn-back"), callback_data="back_to_owner_panel")
    
    builder.adjust(1) # جعل كل قناة في سطر
    return builder.as_markup()