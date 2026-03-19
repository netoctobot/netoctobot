import asyncio
from aiogram.filters import CommandStart
from aiogram_i18n import I18nContext
from .loader import dp, bot
from .db_operations import get_or_create_user
from .handlers import router as main_router
from aiogram import types
# استيراد الأزرار للقائمة الرئيسية
from .keyboards.main_menu import get_main_keyboard 

dp.include_router(main_router)

@dp.message(CommandStart())
async def cmd_start(message: types.Message, i18n: I18nContext):
    user, created = await get_or_create_user(message.from_user)
    
    # اختيار النص بناءً على هل هو جديد أم لا
    key = "welcome-new" if created else "welcome-back"
    text = i18n.get(key, full_name=user.full_name)
    
    await message.answer(
        text=text,
        reply_markup=get_main_keyboard(i18n, user.is_partner)
    )

async def main():
    await dp.start_polling(bot)

if __name__ == '__main__':
    asyncio.run(main())