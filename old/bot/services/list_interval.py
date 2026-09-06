"""
منطق موحّد لفترات النشر التلقائي وحذف القوائم:
- تخزين في القاعدة: رقم + وحدة (ثوانٍ / دقائق / ساعات)
- الجدولة و APScheduler: دائماً بالثواني بعد clamp آمن لتليجرام والسيرفر
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from apps.bots.models import ListTemplate

# حدود معقولة لتقليل الضغط على API تليجرام والسيرفر
MIN_POST_INTERVAL_SECONDS = 30
MAX_POST_INTERVAL_SECONDS = 7 * 24 * 3600  # أسبوع

MIN_DELETE_DELAY_SECONDS = 30
MAX_DELETE_DELAY_SECONDS = 30 * 24 * 3600  # 30 يوم

_UNIT_MULTIPLIER = {"sec": 1, "min": 60, "hour": 3600}


def interval_to_seconds(value: int, unit: str) -> int:
    """تحويل (قيمة + وحدة) إلى ثوانٍ."""
    if value < 0:
        value = 0
    mult = _UNIT_MULTIPLIER.get(unit, 3600)
    return value * mult


def clamp_post_interval_seconds(seconds: int) -> int:
    return max(MIN_POST_INTERVAL_SECONDS, min(MAX_POST_INTERVAL_SECONDS, seconds))


def clamp_delete_delay_seconds(seconds: int) -> int:
    return max(MIN_DELETE_DELAY_SECONDS, min(MAX_DELETE_DELAY_SECONDS, seconds))


def list_template_post_interval_seconds(config: ListTemplate) -> int:
    raw = interval_to_seconds(config.post_interval, config.post_interval_unit)
    return clamp_post_interval_seconds(raw)


def list_template_delete_after_seconds(config: ListTemplate) -> int:
    if config.delete_after <= 0:
        return 0
    raw = interval_to_seconds(config.delete_after, config.delete_after_unit)
    return clamp_delete_delay_seconds(raw)


def describe_interval(value: int, unit: str, tr: Callable[..., str]) -> str:
    """نص قصير للعرض في الواجهة."""
    labels = {
        "sec": tr("unit-seconds-short"),
        "min": tr("unit-minutes-short"),
        "hour": tr("unit-hours-short"),
    }
    return f"{value} {labels.get(unit, labels['hour'])}"


def sync_list_auto_post_job(sub_bot_id: int) -> None:
    """
    يزامن مهمة APScheduler مع حالة ListTemplate الحالية (دالة متزامنة).
    من معالجات aiogram استخدم: await sync_to_async(sync_list_auto_post_job)(sub_bot_id)
    """
    from apps.bots.models import ListTemplate
    from bot.services.scheduler import add_bot_to_scheduler, remove_list_post_job

    try:
        cfg = ListTemplate.objects.get(sub_bot_id=sub_bot_id)
    except ListTemplate.DoesNotExist:
        remove_list_post_job(sub_bot_id)
        return
    if not cfg.is_enabled:
        remove_list_post_job(sub_bot_id)
        return
    seconds = list_template_post_interval_seconds(cfg)
    add_bot_to_scheduler(sub_bot_id, seconds)
