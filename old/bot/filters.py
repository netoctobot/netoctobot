from aiogram.filters import BaseFilter
from aiogram import types, Bot
from apps.bots.models import SubBot
from asgiref.sync import sync_to_async

class BotTypeFilter(BaseFilter):
    def __init__(self, bot_type: str):
        self.bot_type = bot_type

    async def __call__(self, event: types.TelegramObject, bot: Bot) -> bool:
        # جلب البوت من قاعدة البيانات بناءً على التوكن الحالي
        sub_bot = await sync_to_async(SubBot.objects.filter(token=bot.token).first)()
        # التحقق هل نوعه يطابق النوع المطلوب لهذا الراوتر
        return sub_bot and sub_bot.bot_type == self.bot_type