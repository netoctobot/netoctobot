import html
from aiogram import types
from aiogram.utils.markdown import markdown_decoration as md # استيراد المصحح
from aiogram_i18n import I18nContext

def format_personal_message(raw_text: str, user: types.User, parse_mode: str, i18n: I18nContext):
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
    
    return formatted_text + signature_html