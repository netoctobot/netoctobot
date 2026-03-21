import asyncio
import logging
from aiogram import types, Bot
from aiogram.filters import CommandStart
from aiogram_i18n import I18nContext
# الاستيرادات الخاصة بك
from .loader import dp, bot
from .db_operations import get_user_and_subscription
from .handlers import router as main_router
from .keyboards.main_menu import get_main_keyboard
from .utils import setup_master_bot_sync, update_main_interface # الدالة التي تحذف وترسل

# تسجيل الراوتر
dp.include_router(main_router)

@dp.message(CommandStart())
async def cmd_start(message: types.Message, i18n: I18nContext, bot: Bot):
    # جلب بيانات المستخدم والاشتراك (سريع جداً الآن)
    user, subscription, created = await get_user_and_subscription(
        tg_user_id=message.from_user.id, 
        full_name=message.from_user.full_name,
        bot_token=bot.token  
    )
    
    if not subscription:
        return # أو إرسال رسالة تخبره أن البوت غير مسجل

    # اختيار النص بناءً على حالة الاشتراك
    key = "welcome-new" if created else "welcome-back"
    text = i18n.get(key, full_name=user.full_name)
    
    # استخدام الواجهة المتجددة (حذف الرسالة القديمة وتثبيت الجديدة)
    await update_main_interface(
        bot=bot,
        chat_id=message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=get_main_keyboard(i18n, user.is_partner)
    )

async def main():
    # 1. تجهيز البوت الرئيسي في قاعدة البيانات (مرة واحدة فقط عند التشغيل)
    print("🛠️ Checking Master Bot in Database...")
    await setup_master_bot_sync()
    
    # 2. بدء استلام الرسائل
    print("🚀 Bot is running...")
    await dp.start_polling(bot)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO) # لإظهار أي أخطاء في الـ Terminal
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("👋 Bot stopped!")