from asgiref.sync import sync_to_async
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from django.utils import timezone
from apps.bots.models import SubBot, ListTemplate, SubBotChannel, PublishedList
from bot.utils.formatters import generate_list_message
from django.utils import timezone
from datetime import datetime, timedelta
from .tasks import run_auto_post_for_bot, delete_post_for_bot

import asyncio

scheduler = AsyncIOScheduler()


def add_bot_to_scheduler(sub_bot_id, interval_seconds):
    """
    إضافة أو تحديث مهمة النشر التلقائي لبوت معين.
    """
    job_id = f"post_task_{sub_bot_id}"

    if interval_seconds < 1:
        interval_seconds = 1

    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"🔄 تم تحديث جدولة البوت {sub_bot_id}")

    scheduler.add_job(
        run_auto_post_for_bot,
        "interval",
        seconds=interval_seconds,
        args=[sub_bot_id],
        id=job_id,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=120,
    )
    print(f"⏰ تم جدولة البوت {sub_bot_id} كل {interval_seconds} ثانية.")


def remove_list_post_job(sub_bot_id: int) -> None:
    """إيقاف مهمة النشر التلقائي لهذا البوت الفرعي."""
    job_id = f"post_task_{sub_bot_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"🗑️ أُلغيت جدولة النشر للبوت {sub_bot_id}")


def add_delete_bot_to_scheduler(sub_bot_id, chat_id, message_id, interval_seconds):
    """
    إضافة مهمة لحذف البوت بعد وقت محدد (تنفيذ لمرة واحدة).
    """
    # معرف فريد للمهمة بناءً على ID البوت في قاعدة البيانات
    job_id = f"delete_{sub_bot_id}_{message_id}"

    # حذف المهمة إذا كانت موجودة مسبقاً لتجنب التكرار
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        print(f"🔄 تم تحديث مهمة الحذف للبوت {sub_bot_id}")

    if interval_seconds <= 0:
        interval_seconds = 1

    # حساب وقت التنفيذ = الوقت الحالي + المدة المطلوبة (بالثواني)
    run_date = datetime.now() + timedelta(seconds=interval_seconds)

    # إضافة المهمة الجديدة (تنفيذ لمرة واحدة)
    scheduler.add_job(
        delete_post_for_bot,  # الدالة التي ستنفذ الحذف
        "date",  # نوع الجدولة: تنفيذ لمرة واحدة
        run_date=run_date,  # التاريخ والوقت المحدد للتنفيذ
        args=[sub_bot_id, chat_id, message_id],  # الوسائط
        id=job_id,  # معرف المهمة
        replace_existing=True,  # استبدال إذا وُجدت بنفس الـ ID
    )

    print(
        f"✅ تم جدولة حذف البوت {sub_bot_id} بعد {interval_seconds} ثانية (الساعة {run_date})"
    )


async def restore_all_scheduled_tasks():
    """
    تُستدعى عند تشغيل البوت لجلب كل ما يجب جدولته من قاعدة البيانات.
    """
    # from apps.bots.models import ListTemplate, PublishedList
    # from django.utils import timezone

    from bot.services.list_interval import list_template_post_interval_seconds

    # أ. إعادة جدولة مهام النشر التلقائي (Interval) بالثواني الصحيحة
    configs = await sync_to_async(list)(
        ListTemplate.objects.filter(is_enabled=True).select_related("sub_bot")
    )
    for config in configs:
        interval_seconds = list_template_post_interval_seconds(config)
        add_bot_to_scheduler(config.sub_bot.id, interval_seconds)
        print(f"🔄 استعادة جدولة النشر للبوت: {config.sub_bot.name}")

    # ب. إعادة جدولة مهام الحذف التي لم يحن وقتها بعد (Date)
    now = timezone.now()
    pending_deletions = await sync_to_async(list)(
        PublishedList.objects.filter(delete_at__gt=now, is_deleted=False)
    )
    for item in pending_deletions:
        # حساب كم بقي من الوقت بالثواني
        delay_seconds = (item.delete_at - now).total_seconds()
        add_delete_bot_to_scheduler(
            item.sub_bot_id, item.channel_id, item.message_id, delay_seconds
        )
        print(
            f"🧹 استعادة مهمة حذف الرسالة {item.message_id} بعد {int(delay_seconds)} ثانية"
        )
