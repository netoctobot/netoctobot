import asyncio
from aiogram import types
from aiogram.filters import CommandStart
from .loader import dp, bot, _  # استيراد _ من اللودر
from .db_operations import get_or_create_user

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    user, created = await get_or_create_user(message.from_user)
    
    if created:
        text = _("Welcome {full_name}! You have been registered in the Octopus system.")
    else:
        text = _("Welcome back {full_name}! How can I help you today?")
    
    await message.answer(text.format(full_name=user.full_name))

async def main():
    print("--- Octopus Bot Started with i18n ---")
    await dp.start_polling(bot)

if __name__ == '__main__':
    asyncio.run(main())