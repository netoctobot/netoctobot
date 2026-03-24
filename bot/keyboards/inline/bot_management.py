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

def get_my_bots_keyboard(i18n: I18nContext, bots_list):
    """
    توليد قائمة أزرار بالبوتات التي يملكها المستخدم
    bots_list: قائمة من كائنات SubBot القادمة من قاعدة البيانات
    """
    _ = i18n.get
    builder = InlineKeyboardBuilder()

    # إنشاء زر لكل بوت موجود لدى المستخدم
    for bot_item in bots_list:
        status_emoji = "✅" if bot_item.is_active else "❌"
        builder.button(
            text=f"{status_emoji} (@{bot_item.username if bot_item.username else 'bot'})",
            callback_data=f"manage_bot_{bot_item.id}" # نستخدم ID البوت للتحكم به لاحقاً
        )

    # حساب عدد الصفوف المطلوبة للبوتات (كل 2 في صف)
    num_bots = len(bots_list)
    rows = [2] * (num_bots // 2) # صفوف تحتوي على زرين
    if num_bots % 2 != 0:
        rows.append(1) # إذا كان العدد فردياً، البوت الأخير يأخذ صفاً وحده

    # أزرار التحكم الثابتة (كل واحد في صف مستقل)

    builder.button(text=f"{_( 'btn-add-another-bot')}", callback_data="add_new_bot")
    builder.button(text=f"{_( 'btn-back-main')}", callback_data="back_to_main")

    # إضافة صفين للأزرار الأخيرة (كل صف فيه زر واحد)
    rows.extend([1, 1])

    # تطبيق التوزيع
    builder.adjust(*rows)

    # تنظيم الأزرار: كل بوت في سطر، والأزرار الأخيرة في سطر مستقل
    builder.adjust(1)  
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


def get_LST_user_main_keyboard(i18n: I18nContext):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    # الزر الرئيسي للمستخدم: إضافة قناته للستة
    builder.row(types.InlineKeyboardButton(
        text=_("add-my-channel"), 
        callback_data="add_channel" 
    ))
    
    # زر المحفظة (بما أنه أصبح شريكاً)
    builder.row(types.InlineKeyboardButton(
        text=_("my-wallet"), 
        callback_data="user_wallet"
    ))
    
    builder.row(types.InlineKeyboardButton(
        text=_("list-info"), 
        callback_data="list_info"
    ))
    
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

def ok(i18n):
    _ = i18n.get
    builder = InlineKeyboardBuilder()

    builder.button(text=_("ok"), callback_data="ok_and_remove")
    
    return builder.as_markup()

def get_channels_management_keyboard(i18n, channels):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    for bot_chan in channels:
        status_emoji = "✅" if bot_chan.is_active else "⏳"
        
        # الصف الأول: اسم القناة مع حالتها
        builder.row(types.InlineKeyboardButton(
            text=f"{status_emoji} {bot_chan.channel.title}",
            callback_data=f"toggle_chan_{bot_chan.id}" # تبديل الحالة
        ))
       
        # تأكد أننا نتعامل مع نص برابط حقيقي
        username = getattr(bot_chan.channel, 'username', None)
        invite_link = bot_chan.channel.invite_link

        # فحص إضافي للتأكد أن invite_link ليس دالة أو كائن غريب
        if not isinstance(invite_link, str):
            # إذا كان كائناً غير متوقع، نستخدم يوزرنيم أو رابطاً احتياطياً
            channel_url = f"https://t.me/{username}" if username else "https://t.me/telegram"
        else:
            channel_url = f"https://t.me/{username}" if username else invite_link
        
        # الآن نمرر الرابط بأمان
        builder.row(
            types.InlineKeyboardButton(text=_("show-channel"), url=str(channel_url)),
            types.InlineKeyboardButton(text=_("btn-delete"), callback_data=f"delete_chan_{bot_chan.id}")
        )

    # أزرار التحكم الثابتة (كل واحد في صف مستقل)
    builder.row(types.InlineKeyboardButton(text=_("add-new-channel"), callback_data="add_channel"))
    builder.row(types.InlineKeyboardButton(text=_("btn-back"), callback_data="back_to_owner_panel"))
 
    return builder.as_markup()

def get_template_management_keyboard(i18n: I18nContext, is_enabled: bool):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    builder.row(types.InlineKeyboardButton(text=_("preview-template"), callback_data="preview_template"))
    builder.row(
        types.InlineKeyboardButton(text=_("edit-header"), callback_data="edit_header"),
        types.InlineKeyboardButton(text=_("edit-footer"), callback_data="edit_footer")
    )
    builder.row(
        types.InlineKeyboardButton(text=_("edit-interval"), callback_data="edit_interval"),
        types.InlineKeyboardButton(text=_("edite-delete-time"), callback_data="edit_delete_time")
    )
    
    # زر تشغيل/إيقاف النشر التلقائي
    status_text = _("publishing-enabled") if is_enabled else _("publishing-paused")
    builder.row(types.InlineKeyboardButton(text=status_text, callback_data="toggle_auto_post"))
    
    builder.row(types.InlineKeyboardButton(text=_("btn-back"), callback_data="manage_channels"))
    
    return builder.as_markup()