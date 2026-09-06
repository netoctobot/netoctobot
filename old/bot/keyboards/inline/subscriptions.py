# bot\keyboards\inline\subscriptions.py
import asyncio
from asgiref.sync import sync_to_async

from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram import types
from apps.bots.models import Channel

async def get_force_sub_keyboard(i18n, not_joined_channels, bot):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    for chan in not_joined_channels:
        username = getattr(chan, "username", None)
        channel_id = getattr(chan, "channel_id", None)
        url = None

        if not channel_id:
            continue

        # 1. القنوات العامة: الرابط يعتمد على اليوزرنيم
        if username:
            url = f"https://t.me/{username.replace('@', '')}"
        else:
            # 2. القنوات الخاصة: التحقق من الوصول وتجديد الرابط برمجياً
            try:
                chat = await bot.get_chat(channel_id)
                url = chat.invite_link

                # إذا لم يوجد رابط أو كان تالفاً (None)، نقوم بتصدير واحد جديد
                print(url)
                if not url:
                    url = await bot.export_chat_invite_link(channel_id)
                    print(url)
                    # تحديث قاعدة البيانات بالرابط الجديد لمنع حلقة التوليد المستمر
                    await sync_to_async(Channel.objects.filter(channel_id=channel_id).update)(invite_link=url)
                    
            except Exception as chat_access_error:
                print(chat_access_error)
                # إذا فشل البوت في الوصول للقناة (تم طرده أو القناة حُذفت)
                # نتجاهل القناة تماماً لكي لا يعلق المستخدم
                continue

         # إذا لم نتمكن من الحصول على رابط صالح، نتخطى القناة
        if not url:
            continue
        title = getattr(chan, "title", None)
        label = title if title else (f"@{username}" if username else _("btn-join-channel"))
        builder.row(types.InlineKeyboardButton(
            text=label,
            url=url
        ))
    
    builder.row(types.InlineKeyboardButton(
        text=_("subscribed"), 
        callback_data="check_again"
    ))
    return builder.as_markup()