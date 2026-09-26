# bot\utils\checks.py 
import asyncio
from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from bot.db.db_operations import get_main_channels_list, get_subbot_channels_list
from bot.loader import bot as main_bot
from bot.keyboards.inline.subscriptions import get_force_sub_keyboard
from bot.utils.interface import update_main_interface

async def check_all_subscriptions(current_bot: Bot, user_id: int):
    """
    يفحص اشتراك المستخدم في القنوات الإجبارية بشكل متوازي.
    يتم تجاهل القنوات التي لا يمكن للمستخدم الاشتراك فيها (مثل المطرودين) لضمان عدم التعليق.
    """
    not_joined = []

    async def validate_membership(bot_instance: Bot, channel_obj, uid: int):
        try:
            member = await bot_instance.get_chat_member(chat_id=channel_obj.channel_id, user_id=uid)
            # إذا كان المستخدم "غادر" فقط، نلزمه بالاشتراك.
            # أما إذا كان "مطروداً" (kicked)، نتجاهله لأنه لن يستطيع العودة مهما فعل.
            if member.status == "left":
                return channel_obj
        except Exception as access_error:
            print(f"[WARN] Cannot check channel {channel_obj.channel_id}: {access_error}")
            return None
        return None

    # 1. القنوات الرئيسية (Main) - فحص متوازي
    main_channels = await get_main_channels_list()
    if main_channels:
        main_tasks = [validate_membership(main_bot, chan, user_id) for chan in main_channels]
        main_results = await asyncio.gather(*main_tasks)
        not_joined.extend([res for res in main_results if res])

    if current_bot.token != main_bot.token:
        sub_bot_channels = await get_subbot_channels_list(current_bot.token)
        if sub_bot_channels:
            sub_tasks = [validate_membership(current_bot, chan, user_id) for chan in sub_bot_channels]
            sub_results = await asyncio.gather(*sub_tasks)
            not_joined.extend([res for res in sub_results if res])

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