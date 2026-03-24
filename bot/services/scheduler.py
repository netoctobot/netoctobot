from asgiref.sync import sync_to_async
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from django.utils import timezone
from datetime import timedelta
from apps.bots.models import SubBot, ListTemplate, SubBotChannel, PublishedList
from bot.utils.formatters import generate_list_message
from datetime import timedelta
from django.utils import timezone
import asyncio

scheduler = AsyncIOScheduler()

async def start_auto_post_cycle(sub_bot_id):
    """الدالة التي تنفذ عملية النشر الفعلي في كل القنوات"""
    # 1. جلب بيانات البوت والتمبلت
    # 2. تنسيق الرسالة (بواسطة formatter.py)
    # 3. إرسالها لكل قناة في SubBotChannel
    # 4. حفظ IDs الرسائل في موديل PublishedList للحذف لاحقاً
    print(f"جاري بدء عملية النشر للبوت رقم: {sub_bot_id}")

async def setup_all_schedulers():
    """هذه الدالة تعمل عند تشغيل السيرفر لبرمجة كل البوتات المفعلة"""
    # سنجلب كل ListTemplate حيث is_enabled=True ونضيفها للمجدول
    pass


async def run_auto_post_for_bot(sub_bot_id: int):
    """
    هذه الدالة يتم استدعاؤها بواسطة المجدول لكل بوت مفعل.
    """
    try:
        # 1. جلب بيانات البوت والتمبلت
        sub_bot = await sync_to_async(SubBot.objects.select_related('list_config').get)(id=sub_bot_id)
        config = sub_bot.list_config
        
        # 2. توليد نص اللستة
        # نمرر None للـ i18n مؤقتاً أو نستخدم لغة المالك الافتراضية
        message_text = await generate_list_message(sub_bot, None) 
        if not message_text:
            return

        # 3. جلب كل القنوات التي يجب النشر فيها (النشطة فقط)
        active_channels = await sync_to_async(list)(
            SubBotChannel.objects.filter(sub_bot=sub_bot, is_active=True).select_related('channel')
        )

        # 4. إنشاء نسخة بوت مؤقتة للنشر (أو استخدام التوكن)
        async with sub_bot.get_bot_instance() as bot_client:
            for bot_chan in active_channels:
                try:
                    # أ. إرسال الرسالة للقناة
                    sent_msg = await bot_client.send_message(
                        chat_id=bot_chan.channel.channel_id,
                        text=message_text,
                        disable_web_page_preview=True
                    )
                    
                    # ب. تسجيل الرسالة في جدول 'PublishedList' للحذف لاحقاً
                    if config.delete_after > 0:
                        delete_time = timezone.now() + timedelta(hours=config.delete_after)
                        await sync_to_async(PublishedList.objects.create)(
                            sub_bot=sub_bot,
                            channel_id=bot_chan.channel.channel_id,
                            message_id=sent_msg.message_id,
                            delete_at=delete_time
                        )
                except Exception as e:
                    print(f"❌ فشل النشر في القناة {bot_chan.channel.title}: {e}")

        # 5. تحديث وقت آخر نشر في قاعدة البيانات
        config.last_run = timezone.now()
        await sync_to_async(config.save)()

    except Exception as e:
        print(f"🚨 خطأ فادح في مهمة النشر للبوت {sub_bot_id}: {e}")