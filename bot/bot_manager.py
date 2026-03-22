from .db_operations import toggle_sub_bot_status, delete_sub_bot
from .loader import dp
import asyncio
from aiogram import Bot
# قاموس لتخزين المهام النشطة: {bot_token: asyncio.Task}
active_bot_tasks = {}

async def start_sub_bot(token: str):
    """تشغيل البوت وإضافته للمهام النشطة"""
    if token in active_bot_tasks:
        return  # البوت يعمل بالفعل
    
    bot = Bot(token=token)
    # إنشاء مهمة جديدة للـ Polling
    task = asyncio.create_task(dp.start_polling(bot))
    active_bot_tasks[token] = task
    print(f"🚀 Started bot: {token[:10]}...")

async def stop_sub_bot(token: str):
    """إيقاف البوت وإلغاء مهمته"""
    task = active_bot_tasks.get(token)
    if task:
        task.cancel() # إلغاء مهمة الـ Polling
        try:
            await task # انتظار انتهاء الإغلاق
        except asyncio.CancelledError:
            pass
        del active_bot_tasks[token]
        print(f"🛑 Stopped bot: {token[:10]}...")

async def toggle_sub_bot_full_cycle(bot_id, owner):
    """التحكم الكامل في تشغيل/إيقاف البوت برمجياً"""
    # 1. تغيير الحالة في قاعدة البيانات أولاً
    sub_bot = await toggle_sub_bot_status(bot_id, owner)
    
    if sub_bot and sub_bot.token:
        from bot.bot_manager import stop_sub_bot, start_sub_bot
        try:
            if sub_bot.is_active:
                # تشغيل البوت في الذاكرة
                await start_sub_bot(sub_bot.token)
            else:
                # إيقاف البوت من الذاكرة
                await stop_sub_bot(sub_bot.token)
            return sub_bot
        except Exception as e:
            print(f"Error in memory toggle: {e}")
            return None
            
    return None
async def delete_sub_bot_full_cycle(bot_id, owner):
    """حذف البوت من الذاكرة (إيقاف) ومن قاعدة البيانات"""
    try:
        # أولاً: نحذف من القاعدة ونجلب التوكن
        token = await delete_sub_bot(bot_id, owner)
        
        if token:
            # ثانياً: نوقف البوت برمجياً من الذاكرة (المدير الذي صممناه)
            from bot.bot_manager import stop_sub_bot
            await stop_sub_bot(token)
            return True
            
        return False
    except Exception as e:
        print(f"Error deleting bot: {e}")
        return False