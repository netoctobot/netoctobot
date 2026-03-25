import asyncio
import logging
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties 
from asgiref.sync import sync_to_async

from bot.utils.collection import active_bots_instances,all_bots,seen_tokens
from .loader import dp, bot
from .utils.interface import setup_master_bot_sync # الدالة التي تحذف وترسل
from bot.handlers import get_handlers_router
from apps.bots.models import SubBot,ListTemplate
from bot.services.scheduler import scheduler, add_bot_to_scheduler

# تسجيل الراوتر
dp.include_router(get_handlers_router())

async def restore_saved_jobs():
    """إعادة تشغيل المهام المجدولة للبوتات المفعلة مسبقاً"""
    configs = await sync_to_async(list)(
        ListTemplate.objects.filter(is_enabled=True).select_related('sub_bot')
    )
    for cfg in configs:
        add_bot_to_scheduler(cfg.sub_bot.id, cfg.post_interval)
    
    # إضافة مهمة الحذف الدوري (تعمل كل 5 دقائق لتنظيف الرسائل المنتهية)
    scheduler.add_job(auto_delete_expired_messages, "interval", minutes=5, id="global_cleaner")
    print(f"♻️ تم استعادة {len(configs)} مهمة نشر مجدولة.")

async def main():
    
    if not scheduler.running:
        scheduler.start()
        print("🚀 محرك الجدولة يعمل الآن...")
    # 1. تجهيز البوت الرئيسي
    await setup_master_bot_sync()
    
    # 2. جلب البوتات الفرعية النشطة (مع التأكد من عدم تكرار التوكنات في DB)
    # استخدام .values_list('token', flat=True).distinct() يضمن جلب توكنات فريدة فقط
    active_sub_bots = await sync_to_async(list)(
        SubBot.objects.filter(is_active=True).only('token', 'name')
    )

    # أضف البوت الرئيسي أولاً
    all_bots.append(bot)
    seen_tokens.add(bot.token)

    for bot_data in active_sub_bots:
        # إذا كان التوكن موجوداً مسبقاً (مثلاً الماستر أو بوت مكرر)، تخطاه
        if bot_data.token in seen_tokens:
            print(f"⚠️ تخطي {bot_data.name}: التوكن يعمل بالفعل.")
            continue

        try:
            sub_bot_instance = Bot(
                token=bot_data.token, 
                allowed_updates=["message", "callback_query", "chat_member", "my_chat_member"],
                default=DefaultBotProperties(parse_mode="HTML") 
            )
            all_bots.append(sub_bot_instance)
            active_bots_instances[bot_data.token] = sub_bot_instance
            seen_tokens.add(bot_data.token) # تسجيل التوكن كـ "مشغول"
            print(f"✅ تم تشغيل: {bot_data.name}")
        except Exception as e:
            print(f"❌ فشل تشغيل {bot_data.name}: {e}")

    # 4. تنظيف الـ Webhooks قبل البدء (حل جذري لمشكلة الـ Conflict)
    # أحياناً تليجرام يعلق إذا كان هناك Webhook قديم
    for b in all_bots:
        try:
            await b.delete_webhook(drop_pending_updates=True)
        except:
            pass

    # 5. بدء التشغيل الجماعي
    print(f"🚀 يتم الآن تشغيل {len(all_bots)} بوت في وقت واحد...")
    await dp.start_polling(*all_bots)

if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING)
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("👋 Bot stopped!")