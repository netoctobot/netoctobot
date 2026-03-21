from aiogram.exceptions import TelegramBadRequest
from asgiref.sync import sync_to_async
from apps.accounts.models import TelegramUser
from apps.bots.models import SubBot
from ..config import BOT_TOKEN, ADMIN_IDS

async def update_main_interface(bot, chat_id, subscription, text, reply_markup):
    # محاولة حذف الرسالة السابقة لهذا البوت تحديداً
    if subscription.last_main_message_id:
        try:
            await bot.delete_message(chat_id=chat_id, message_id=subscription.last_main_message_id)
        except TelegramBadRequest:
            pass # الرسالة قديمة جداً أو محذوفة

    # إرسال الرسالة الجديدة
    new_msg = await bot.send_message(
        chat_id=chat_id,
        text=text,
        reply_markup=reply_markup
    )


    # تحديث الـ ID في قاعدة البيانات (Async)
    subscription.last_main_message_id = new_msg.message_id
    await sync_to_async(subscription.save)()

@sync_to_async
def setup_master_bot_sync():
    # جلب الأدمن الأول من الإعدادات
    admin_id = ADMIN_IDS[0] if ADMIN_IDS else 0
    
    admin_user, _ = TelegramUser.objects.get_or_create(
        telegram_id=admin_id,
        defaults={'full_name': 'System Admin'}
    )
    
    # التأكد من وجود البوت الرئيسي
    master_bot, created = SubBot.objects.get_or_create(
        token=BOT_TOKEN,
        defaults={
            'name': 'Main Master Bot',
            'bot_type': 'SUP',
            'owner': admin_user,
            'is_active': True
        }
    )
    return master_bot