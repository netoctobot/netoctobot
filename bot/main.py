import asyncio
import logging
from aiogram import types, Bot, F
from aiogram.filters import CommandStart
from aiogram_i18n import I18nContext
from .config import ADMIN_IDS
from asgiref.sync import sync_to_async
# الاستيرادات الخاصة بك
from .loader import dp, bot
from .db_operations import get_user_and_subscription
from .keyboards.main_menu import get_main_keyboard
from .utils.interface import setup_master_bot_sync, update_main_interface # الدالة التي تحذف وترسل
from bot.handlers import get_handlers_router
from apps.bots.models import SubBot
from aiogram.client.default import DefaultBotProperties 
from bot.handlers.sub_bots.contact_logic import router as contact_router

# تسجيل الراوتر
dp.include_router(get_handlers_router())
dp.include_router(contact_router)

@dp.message(CommandStart())
async def cmd_start(message: types.Message, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    # جلب بيانات المستخدم والاشتراك (سريع جداً الآن)
    user, subscription, created = await get_user_and_subscription(
        tg_user=message.from_user,
        bot_token=bot.token  
    )
    is_system_admin = message.from_user.id in ADMIN_IDS
    
    if not subscription:
        return # أو إرسال رسالة تخبره أن البوت غير مسجل
    
    # 🔥 التعديل الأهم: فرض لغة الاشتراك على السياق الحالي
    await i18n.set_locale(subscription.language)

    # اختيار النص بناءً على حالة الاشتراك
    key = "welcome-new" if created else "welcome-back"
    text = _(key, full_name=user.full_name)
    
    # استخدام الواجهة المتجددة (حذف الرسالة القديمة وتثبيت الجديدة)
    await update_main_interface(
        bot=bot,
        chat_id=message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=get_main_keyboard(
            i18n,
            is_admin=is_system_admin,
            is_partner=user.is_partner
            )
    )

async def main():
    # 1. تجهيز البوت الرئيسي
    await setup_master_bot_sync()
    
    # 2. جلب البوتات الفرعية النشطة (مع التأكد من عدم تكرار التوكنات في DB)
    # استخدام .values_list('token', flat=True).distinct() يضمن جلب توكنات فريدة فقط
    active_sub_bots = await sync_to_async(list)(
        SubBot.objects.filter(is_active=True).only('token', 'name')
    )

    # 3. استخدام "مجموعة" (Set) لتخزين التوكنات المشغلة فعلياً ومنع التكرار
    seen_tokens = set()
    all_bots = []

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
                default=DefaultBotProperties(parse_mode="HTML") 
            )
            all_bots.append(sub_bot_instance)
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