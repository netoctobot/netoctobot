# bot\utils\checks.py 
from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from bot.db.db_operations import get_main_channels_list, get_subbot_channels_list
from bot.loader import bot as main_bot
from bot.keyboards.inline.subscriptions import get_force_sub_keyboard
from bot.utils.interface import update_main_interface

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

async def handle_force_subscribe(message, i18n, sub_bot, not_joined, subscription):
    """دالة موحدة لعرض رسالة الاشتراك الإجباري"""
    _ = i18n.get
    force_text = sub_bot.force_msg or _("must-subscribe")
    
    return await update_main_interface(
        bot=message.bot,
        chat_id=message.chat.id,
        subscription=subscription,
        text=force_text,
        reply_markup=await get_force_sub_keyboard(i18n, not_joined, message.bot)
    )

async def force_subscribe(message, bot, i18n, sub_bot):
    not_joined = await check_all_subscriptions(bot, message.from_user.id)
    
    if not_joined:
        from bot.db.db_operations import get_user_and_subscription
        _, subscription, _ = await get_user_and_subscription(message.from_user, bot.token)
        # استدعاء الدالة الموحدة التي أنشأناها
        return await handle_force_subscribe(message, i18n, sub_bot, not_joined, subscription)