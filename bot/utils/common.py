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