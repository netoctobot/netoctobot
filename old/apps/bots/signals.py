from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import SubBot, SubBotSubscriptionQuota


@receiver(post_save, sender=SubBot)
def ensure_subscription_quota(sender, instance, created, **kwargs):
    if created:
        SubBotSubscriptionQuota.objects.get_or_create(
            sub_bot=instance, defaults={"max_mandatory_slots": 2}
        )
