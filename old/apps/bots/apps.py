from django.apps import AppConfig


class BotsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.bots"
    label = "bots"

    def ready(self):
        import apps.bots.signals  # noqa: F401
