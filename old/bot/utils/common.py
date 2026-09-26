# bot/utils/common.py
import asyncio
from aiogram import types
from aiogram.exceptions import TelegramBadRequest

async def delete_message_after(message: types.Message, sleep_time: int = 30):
    """حذف رسالة محددة بعد وقت معين دون تعطيل البوت"""
    await asyncio.sleep(sleep_time)
    try:
        await message.delete()
    except TelegramBadRequest:
        # الرسالة حُذفت بالفعل أو البوت لا يملك صلاحية
        pass

async def get_chat_invite_link(chat: types.Chat) -> str:
    """
    الحصول على رابط الدعوة للمجموعة/القناة بأفضل طريقة
    """
    # 1. إذا كان للمجموعة/القناة معرف عام (username)
    if chat.username:
        return f"https://t.me/{chat.username}"
    
    # 2. إذا لم يكن لها معرف عام، نحتاج رابط دعوة
    try:
        # نحاول استرجاع الرابط الموجود أولاً
        if chat.invite_link:
            return chat.invite_link
        
        # إذا لم يوجد رابط، نقوم بإنشاء رابط جديد
        invite_link = await chat.export_invite_link()
        return invite_link
        
    except Exception as e:
        # في حالة الخطأ (مثل عدم وجود صلاحيات)
        print(f"لا يمكن إنشاء رابط الدعوة: {e}")
        return None