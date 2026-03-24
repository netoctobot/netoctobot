import html
from aiogram import types
from aiogram.utils.markdown import markdown_decoration as md # استيراد المصحح
from aiogram_i18n import I18nContext
from aiogram.utils.keyboard import InlineKeyboardBuilder
from bot.db.db_operations import get_subbot_active_channels_list

def format_personal_message(raw_text: str, user: types.User, parse_mode: str, i18n: I18nContext, show_signature: bool = True):
    _ = i18n.get
    master_link = "https://t.me/net_octobot"
    signature_text = _("bot-signature")

    # 1. تجهيز البيانات مع "الهروب" الصحيح لكل نوع
    if parse_mode == "HTML":
        full_name = html.escape(user.full_name)
        # التوقيع والمنشن بصيغة HTML
        mention = f'<a href="tg://user?id={user.id}">{full_name}</a>'
        signature_html = f'\n\n<a href="{master_link}">{signature_text}</a>'
        
    elif parse_mode == "MDV2":
        # استخدام md.quote للهروب من كافة رموز MarkdownV2 الخطيرة
        full_name = md.quote(user.full_name)
        # التوقيع والمنشن بصيغة MarkdownV2
        mention = f"[{full_name}](tg://user?id={user.id})"
        # يجب الهروب من النص المترجم أيضاً ومن الرابط إذا احتوى رموزاً
        safe_sig_text = md.quote(signature_text)
        signature_html = f'\n\n[{safe_sig_text}]({master_link})'
        
    else:
        full_name = user.full_name
        mention = full_name
        signature_html = f'\n\n{signature_text} ({master_link})'

    # 2. عملية الاستبدال
    # ملاحظة: raw_text هو ما كتبه المستخدم، إذا اختار MDV2 يجب أن يكون هو قد كتبه بالتنسيق الصحيح
    formatted_text = raw_text.replace("{name}", full_name)\
                             .replace("{username}", f"@{user.username}" if user.username else "لا يوجد")\
                             .replace("{id}", str(user.id))\
                             .replace("{mention}", mention)
    
    if not show_signature:
        return formatted_text
        
    # منطق التوقيع (Signature) هنا
    return formatted_text + signature_html

def build_custom_buttons(builder: InlineKeyboardBuilder, raw_text: str):
    """تحويل نص المالك إلى أزرار وإضافتها للكيبورد"""
    if not raw_text:
        return builder

    lines = raw_text.strip().split('\n')
    for line in lines:
        if '|' in line:
            parts = line.split('|')
            name = parts[0].strip()
            url = parts[1].strip()
            # التأكد من أن الرابط يبدأ بـ http لضمان عدم حدوث خطأ
            if url.startswith('http'):
                builder.row(types.InlineKeyboardButton(text=name, url=url))
    
    return builder

async def generate_list_message(sub_bot, i18n: I18nContext):
    """توليد النص النهائي للستة"""
    _ = i18n.get
    
    # 1. جلب التمبلت (أو استخدام افتراضي إذا لم يوجد)
    try:
        config = sub_bot.list_config
        header = config.header_text or _("template-headr-defult")
        footer = config.footer_text or _("template-footer-defult",usenrame=sub_bot.username)
    except:
        header = _("template-headr-defult")
        footer = _("template-footer-defult",username=sub_bot.username)

    # 2. جلب القنوات النشطة المرتبطة بهذا البوت فقط
    # نستخدم select_related لتقليل ضغط قاعدة البيانات
    bot_channels = get_subbot_active_channels_list(sub_bot)

    if not bot_channels:
        return None

    # 3. بناء جسم الرسالة
    body = ""
    for bc in bot_channels:
        title = bc.channel.title
        # الأولوية لليوزرنيم ثم الرابط
        link = f"https://t.me/{bc.channel.username}" if bc.channel.username else bc.channel.invite_link
        body += f"▫️ <a href='{link}'>{title}</a>\n"

    # 4. دمج الأجزاء
    full_message = f"<b>{header}</b>\n\n{body}\n\n<i>{footer}</i>\n\n{_("template-signature")}"
    
    return full_message