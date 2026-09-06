# -*- coding: utf-8 -*-

import uuid

import django.db.models.deletion
from django.db import migrations, models


def migrate_force_channels_to_mandatory(apps, schema_editor):
    SubBot = apps.get_model("bots", "SubBot")
    SubBotMandatoryChannel = apps.get_model("bots", "SubBotMandatoryChannel")
    SubBotSubscriptionQuota = apps.get_model("bots", "SubBotSubscriptionQuota")

    for sb in SubBot.objects.all().iterator():
        SubBotSubscriptionQuota.objects.get_or_create(
            sub_bot=sb, defaults={"max_mandatory_slots": 2}
        )
        order = 0
        for ch in sb.force_channels.all():
            SubBotMandatoryChannel.objects.get_or_create(
                sub_bot=sb,
                channel=ch,
                defaults={"sort_order": order, "is_active": True},
            )
            order += 1


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("bots", "0011_listtemplate_interval_units"),
    ]

    operations = [
        migrations.AddField(
            model_name="adminchannel",
            name="title",
            field=models.CharField(
                blank=True,
                default="",
                max_length=255,
                verbose_name="Display title",
            ),
        ),
        migrations.CreateModel(
            name="PlatformListButton",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="Created At"),
                ),
                (
                    "updated_at",
                    models.DateTimeField(auto_now=True, verbose_name="Updated At"),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created",
                        to="accounts.telegramuser",
                        verbose_name="Created By",
                    ),
                ),
                ("label", models.CharField(max_length=64, verbose_name="Button text")),
                ("sort_order", models.PositiveIntegerField(default=0, verbose_name="Sort order")),
                ("is_active", models.BooleanField(default=True, verbose_name="Active")),
                (
                    "button_type",
                    models.CharField(
                        choices=[("url", "URL (opens link)"), ("cb", "Callback (in-bot action)")],
                        default="url",
                        max_length=8,
                        verbose_name="Button type",
                    ),
                ),
                ("url", models.URLField(blank=True, null=True, verbose_name="URL")),
                (
                    "callback_hint",
                    models.CharField(
                        blank=True,
                        default="",
                        max_length=180,
                        verbose_name="Callback note",
                    ),
                ),
            ],
            options={
                "verbose_name": "Platform list button",
                "verbose_name_plural": "Platform list buttons",
                "ordering": ["sort_order", "id"],
            },
        ),
        migrations.CreateModel(
            name="SubBotListButton",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="Created At"),
                ),
                (
                    "updated_at",
                    models.DateTimeField(auto_now=True, verbose_name="Updated At"),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created",
                        to="accounts.telegramuser",
                        verbose_name="Created By",
                    ),
                ),
                ("label", models.CharField(max_length=64, verbose_name="Button text")),
                ("sort_order", models.PositiveIntegerField(default=0, verbose_name="Sort order")),
                ("is_active", models.BooleanField(default=True, verbose_name="Active")),
                (
                    "button_type",
                    models.CharField(
                        choices=[("url", "URL (opens link)"), ("cb", "Callback (in-bot action)")],
                        default="url",
                        max_length=8,
                        verbose_name="Button type",
                    ),
                ),
                ("url", models.URLField(blank=True, null=True, verbose_name="URL")),
                (
                    "callback_hint",
                    models.CharField(
                        blank=True,
                        default="",
                        max_length=180,
                        verbose_name="Callback note",
                    ),
                ),
                (
                    "sub_bot",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="list_buttons",
                        to="bots.subbot",
                    ),
                ),
            ],
            options={
                "verbose_name": "Sub-bot list button",
                "verbose_name_plural": "Sub-bot list buttons",
                "ordering": ["sort_order", "id"],
            },
        ),
        migrations.CreateModel(
            name="SubBotMandatoryChannel",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="Created At"),
                ),
                (
                    "updated_at",
                    models.DateTimeField(auto_now=True, verbose_name="Updated At"),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created",
                        to="accounts.telegramuser",
                        verbose_name="Created By",
                    ),
                ),
                ("sort_order", models.PositiveIntegerField(default=0, verbose_name="Sort order")),
                ("is_active", models.BooleanField(default=True, verbose_name="Active")),
                (
                    "channel",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mandatory_for_sub_bots",
                        to="bots.channel",
                    ),
                ),
                (
                    "sub_bot",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mandatory_channels",
                        to="bots.subbot",
                    ),
                ),
            ],
            options={
                "verbose_name": "Mandatory channel (per sub-bot)",
                "verbose_name_plural": "Mandatory channels (per sub-bot)",
                "ordering": ["sort_order", "id"],
                "unique_together": {("sub_bot", "channel")},
            },
        ),
        migrations.CreateModel(
            name="SubBotSubscriptionQuota",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="Created At"),
                ),
                (
                    "updated_at",
                    models.DateTimeField(auto_now=True, verbose_name="Updated At"),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created",
                        to="accounts.telegramuser",
                        verbose_name="Created By",
                    ),
                ),
                (
                    "max_mandatory_slots",
                    models.PositiveIntegerField(
                        default=2,
                        help_text="Owner cannot add more active mandatory channels than this.",
                        verbose_name="Max mandatory channels",
                    ),
                ),
                (
                    "sub_bot",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subscription_quota",
                        to="bots.subbot",
                    ),
                ),
            ],
            options={
                "verbose_name": "Sub-bot subscription quota",
                "verbose_name_plural": "Sub-bot subscription quotas",
            },
        ),
        migrations.RunPython(migrate_force_channels_to_mandatory, noop_reverse),
    ]
