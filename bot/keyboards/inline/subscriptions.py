# bot\keyboards\inline\subscriptions.py
import asyncio

from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram import types
from bot.utils.common import get_chat_invite_link

async def get_force_sub_keyboard(i18n, not_joined_channels, bot):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    print(f"\n--- DEBUG START: Generating Force Sub Keyboard ---")
    
    for chan in not_joined_channels:
        uname = getattr(chan, "username", None) or ""
        chan_id = getattr(chan, "channel_id", "Unknown")
        inv = getattr(chan, "invite_link", None)

        # التحقق إذا كان الرابط المخزن هو Coroutine object (بسبب خطأ سابق في الحفظ)
        if asyncio.iscoroutine(inv):
            inv = await inv
        # التحقق إذا كان الرابط عبارة عن نص يحتوي على كلمة coroutine (تم تحويله لـ string بالخطأ)
        elif isinstance(inv, str) and "coroutine" in inv:
            inv = None

        print(f"DEBUG: Processing Channel -> ID: {chan_id}, Username: {uname}, DB_Invite: {inv}")
        
        # 1. إذا كان هناك يوزرنيم، هو الأسهل والأضمن
        if uname:
            url = f"https://t.me/{uname}"
        # 2. إذا لم يوجد يوزرنيم، نستخدم الرابط المحفوظ في قاعدة البيانات
        # نتأكد أن الرابط نصي ولا يحتوي على مخلفات الـ Coroutine
        elif inv and isinstance(inv, str) and "coroutine" not in inv:
            url = inv
        # 3. إذا كانت القناة خاصة وليس لدينا رابط، نقوم بإنشائه الآن
        else:
            try:
                # نجلب معلومات الشات من التليجرام أولاً
                print(f"DEBUG: No link found for {chan_id}. Fetching from Telegram API...")
                chat = await bot.get_chat(chan.channel_id)
                # نستخدم الدالة المساعدة التي await-ed الآن بشكل صحيح
                url = await get_chat_invite_link(chat)
                print(f"DEBUG: Link generated via API: {url}")
            except Exception as e:
                print(f"DEBUG: API Error for {chan_id}: {e}")
                url = "https://t.me/telegram" # حل أخير في حال فشل كل شيء

        # التحقق النهائي من نوع الرابط قبل إضافته للكيبورد
        if asyncio.iscoroutine(url):
            print(f"CRITICAL ERROR: URL for {chan_id} is still a COROUTINE object! Check await.")
            url = "https://t.me/telegram"
        
        print(f"DEBUG: Final URL for {chan_id}: {url} (Type: {type(url)})")


        label = getattr(chan, "title", None) or (f"@{uname}" if uname else str(getattr(chan, "channel_id", "")))
        builder.row(types.InlineKeyboardButton(
            text=label,
            url=url
        ))
    print(f"--- DEBUG END ---\n")
    
    builder.row(types.InlineKeyboardButton(
        text=_("subscribed"), 
        callback_data="check_again"
    ))
    return builder.as_markup()