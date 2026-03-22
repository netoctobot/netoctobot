from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from bot.loader import bot as main_bot
from bot.db_operations import get_main_channels_list,get_subbot_channels_list

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from bot.db_operations import get_main_channels_list
from bot.loader import bot as main_bot # استيراد البوت الرئيسي للتحقق من قنواته

async def check_all_subscriptions(current_bot: Bot, user_id: int):
    not_joined = []

    # --- أولاً: القنوات الرئيسية (Main) عبر البوت الماستر ---
    main_channels = await get_main_channels_list()
    for channel in main_channels:
        try:
            member = await main_bot.get_chat_member(chat_id=channel.channel_id, user_id=user_id)
            if member.status in ["left", "kicked"]:
                not_joined.append(channel)
        except Exception:
            continue

    # --- ثانياً: القنوات الفرعية (SubBot) عبر البوت الحالي ---
    # نتحقق فقط إذا كان البوت الحالي ليس هو البوت الرئيسي (لتجنب التكرار)
    if current_bot.token != main_bot.token:
        # ⚠️ استدعاء await هنا ضروري جداً
        sub_bot_channels = await get_subbot_channels_list(current_bot.token)
        
        for channel in sub_bot_channels:
            try:
                member = await current_bot.get_chat_member(chat_id=channel.channel_id, user_id=user_id)
                if member.status in ["left", "kicked"]:
                    not_joined.append(channel)
            except Exception:
                continue

    return not_joined