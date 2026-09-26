# Generated manually for interval units

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bots", "0010_listtemplate_publishedlist"),
    ]

    operations = [
        migrations.AddField(
            model_name="listtemplate",
            name="post_interval_unit",
            field=models.CharField(
                choices=[
                    ("sec", "Seconds"),
                    ("min", "Minutes"),
                    ("hour", "Hours"),
                ],
                default="hour",
                max_length=4,
                verbose_name="Post interval unit",
            ),
        ),
        migrations.AddField(
            model_name="listtemplate",
            name="delete_after_unit",
            field=models.CharField(
                choices=[
                    ("sec", "Seconds"),
                    ("min", "Minutes"),
                    ("hour", "Hours"),
                ],
                default="hour",
                max_length=4,
                verbose_name="Delete after unit",
            ),
        ),
        migrations.AlterField(
            model_name="listtemplate",
            name="post_interval",
            field=models.PositiveIntegerField(
                default=24,
                help_text="Numeric part of the auto-post interval (interpreted with post_interval_unit).",
                verbose_name="Post interval value",
            ),
        ),
        migrations.AlterField(
            model_name="listtemplate",
            name="delete_after",
            field=models.PositiveIntegerField(
                default=2,
                help_text="0 disables auto-delete; otherwise delay before deleting posted lists.",
                verbose_name="Delete after value",
            ),
        ),
    ]
