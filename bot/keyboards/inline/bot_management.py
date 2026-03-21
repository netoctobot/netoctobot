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

    # زر العودة لقائمة "بوتاتي"
    builder.button(text=_("btn-back-to-list"), callback_data="list_my_bots")

    builder.adjust(1)
    return builder.as_markup()