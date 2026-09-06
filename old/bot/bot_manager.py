import asyncio

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.utils.backoff import BackoffConfig

from bot.utils.collection import active_bots_instances, all_bots, seen_tokens

from .db.db_operations import delete_sub_bot, toggle_sub_bot_status
from .loader import dp

# قاموس لتخزين مهام polling للبوتات المضافة أثناء التشغيل: {token: Task}
active_bot_tasks = {}

_POLLING_BACKOFF = BackoffConfig(
    min_delay=1.0, max_delay=5.0, factor=1.3, jitter=0.1
)


def build_sub_bot_client(token: str) -> Bot:
    """نفس إعدادات البوت الفرعي في main.py (polling متعدد)."""
    return Bot(
        token=token,
        allowed_updates=[
            "message",
            "callback_query",
            "chat_member",
            "my_chat_member",
        ],
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )


async def start_sub_bot(token: str):
    """
    تشغيل بوت فرعي دون إعادة تشغيل التطبيق.

    لا يمكن استدعاء dp.start_polling مرة ثانية (قفل داخلي في aiogram)،
    لذلك نُشغّل حلقة _polling لهذا التوكن فقط كمهمة خلفية.
    """
    if token in active_bot_tasks:
        existing = active_bot_tasks[token]
        if not existing.done():
            return
        del active_bot_tasks[token]

    if token in active_bots_instances:
        return

    sub_bot = build_sub_bot_client(token)

    try:
        await sub_bot.delete_webhook(drop_pending_updates=True)
    except Exception as e:
        print(f"⚠️ delete_webhook: {e}")

    all_bots.append(sub_bot)
    active_bots_instances[token] = sub_bot
    seen_tokens.add(token)

    allowed_updates = dp.resolve_used_update_types()
    workflow_data = {
        "dispatcher": dp,
        "bots": tuple(all_bots),
        **dp.workflow_data,
    }
    workflow_data.pop("bot", None)

    async def _poll_one() -> None:
        await dp._polling(
            bot=sub_bot,
            polling_timeout=10,
            handle_as_tasks=True,
            backoff_config=_POLLING_BACKOFF,
            allowed_updates=allowed_updates,
            tasks_concurrency_limit=None,
            **workflow_data,
        )

    task = asyncio.create_task(_poll_one())
    active_bot_tasks[token] = task
    print(f"🚀 Started bot (runtime): {token[:10]}...")


async def stop_sub_bot(token: str):
    """
    إيقاف polling للبوتات التي أُضيفت أثناء التشغيل (active_bot_tasks).

    البوتات المحمّلة مع الإقلاع تُدار داخل start_polling الرئيسي؛ لا نغلق
    جلستها هنا لأن ذلك لا يوقف مهمة الـ polling الداخلية ويسبب أخطاء.
    """
    task = active_bot_tasks.pop(token, None)
    if not task:
        return

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    instance = active_bots_instances.pop(token, None)
    seen_tokens.discard(token)
    if instance:
        try:
            all_bots.remove(instance)
        except ValueError:
            pass
        try:
            await instance.session.close()
        except Exception as e:
            print(f"⚠️ session close: {e}")

    print(f"🛑 Stopped bot: {token[:10]}...")

async def toggle_sub_bot_full_cycle(bot_id, owner):
    """التحكم الكامل في تشغيل/إيقاف البوت برمجياً"""
    # 1. تغيير الحالة في قاعدة البيانات أولاً
    sub_bot = await toggle_sub_bot_status(bot_id, owner)
    
    if sub_bot and sub_bot.token:
        try:
            if sub_bot.is_active:
                await start_sub_bot(sub_bot.token)
            else:
                await stop_sub_bot(sub_bot.token)
            return sub_bot
        except Exception as e:
            print(f"Error in memory toggle: {e}")
            return None
            
    return None
async def delete_sub_bot_full_cycle(bot_id, owner):
    """حذف البوت من الذاكرة (إيقاف) ومن قاعدة البيانات"""
    try:
        # أولاً: نحذف من القاعدة ونجلب التوكن
        token = await delete_sub_bot(bot_id, owner)
        
        if token:
            await stop_sub_bot(token)
            return True
            
        return False
    except Exception as e:
        print(f"Error deleting bot: {e}")
        return False