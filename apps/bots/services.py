from aiogram import Bot
from aiogram.exceptions import TelegramUnauthorizedError
from asgiref.sync import sync_to_async
from .models import SubBot

async def validate_and_register_bot(token: str, owner_user, bot_type: str):
    """
    التحقق من صحة التوكن عبر تيليجرام ثم حفظه في قاعدة البيانات.
    """
    try:
        # 1. اختبار التوكن فعلياً مع تيليجرام
        async with Bot(token=token) as temp_bot:
            bot_info = await temp_bot.get_me()

        # 2. الحفظ في قاعدة البيانات (باستخدام sync_to_async لأن Django ORM متزامن)
        @sync_to_async
        def create_bot_record():
            # التأكد من أن التوكن غير مسجل مسبقاً
            if SubBot.objects.filter(token=token).exists():
                return None, "exists"

            new_bot = SubBot.objects.create(
                owner=owner_user,
                token=token,
                name=bot_info.full_name,
                username=bot_info.username,
                bot_type=bot_type,
                is_active=True,
            )
            return new_bot, "success"

        return await create_bot_record()

    except TelegramUnauthorizedError:
        return None, "invalid"
    except Exception as e:
        return None, str(e)
