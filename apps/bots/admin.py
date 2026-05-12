from django.contrib import admin
from django.db.models import Count
from django.utils.translation import gettext_lazy as _

from .models import (
    AdminChannel,
    BotSubscription,
    Channel,
    ListTemplate,
    PlatformListButton,
    PublishedList,
    SubBot,
    SubBotChannel,
    SubBotListButton,
    SubBotMandatoryChannel,
    SubBotSubscriptionQuota,
)


class SubBotChannelInline(admin.TabularInline):
    model = SubBotChannel
    extra = 0
    autocomplete_fields = ("channel",)


class SubBotMandatoryChannelInline(admin.TabularInline):
    model = SubBotMandatoryChannel
    extra = 0
    autocomplete_fields = ("channel",)


class SubBotListButtonInline(admin.TabularInline):
    model = SubBotListButton
    extra = 0


class SubBotSubscriptionQuotaInline(admin.StackedInline):
    model = SubBotSubscriptionQuota
    max_num = 1
    can_delete = False


@admin.register(SubBot)
class SubBotAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "owner",
        "bot_type",
        "is_active",
        "created_at",
        "get_subscribers_count",
        "get_list_channels_count",
        "get_mandatory_channels_count",
    )
    list_filter = ("bot_type", "is_active", "created_at")
    search_fields = ("name", "token", "owner__full_name", "owner__telegram_id")
    inlines = (
        SubBotSubscriptionQuotaInline,
        SubBotMandatoryChannelInline,
        SubBotChannelInline,
        SubBotListButtonInline,
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.annotate(
            _subs=Count("subscribers", distinct=True),
            _list_ch=Count("bot_channels", distinct=True),
            _mand=Count("mandatory_channels", distinct=True),
        )

    def get_subscribers_count(self, obj):
        return getattr(obj, "_subs", obj.subscribers.count())

    get_subscribers_count.short_description = _("Subscribers")
    get_subscribers_count.admin_order_field = "_subs"

    def get_list_channels_count(self, obj):
        return getattr(obj, "_list_ch", obj.bot_channels.count())

    get_list_channels_count.short_description = _("List / publish channels")
    get_list_channels_count.admin_order_field = "_list_ch"

    def get_mandatory_channels_count(self, obj):
        return getattr(obj, "_mand", obj.mandatory_channels.count())

    get_mandatory_channels_count.short_description = _("Mandatory channels")
    get_mandatory_channels_count.admin_order_field = "_mand"


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "channel_id", "member_count", "status", "last_sync")
    list_filter = ("status", "last_sync")
    search_fields = ("title", "channel_id", "owner__full_name")


@admin.register(BotSubscription)
class BotSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "bot", "joined_at")
    list_filter = ("bot", "joined_at")
    search_fields = ("user__full_name", "user__telegram_id", "bot__name")
    readonly_fields = ("joined_at",)


@admin.register(AdminChannel)
class AdminChannelAdmin(admin.ModelAdmin):
    list_display = ("title", "channel_id", "username", "created_at")
    search_fields = ("title", "username", "channel_id")


@admin.register(PlatformListButton)
class PlatformListButtonAdmin(admin.ModelAdmin):
    list_display = ("label", "button_type", "sort_order", "is_active", "url")
    list_filter = ("is_active", "button_type")
    list_editable = ("sort_order", "is_active")
    ordering = ("sort_order", "id")


@admin.register(SubBotListButton)
class SubBotListButtonAdmin(admin.ModelAdmin):
    list_display = ("sub_bot", "label", "button_type", "sort_order", "is_active")
    list_filter = ("is_active", "button_type", "sub_bot")
    search_fields = ("label", "sub_bot__name")
    autocomplete_fields = ("sub_bot",)


@admin.register(SubBotMandatoryChannel)
class SubBotMandatoryChannelAdmin(admin.ModelAdmin):
    list_display = ("sub_bot", "channel", "sort_order", "is_active")
    list_filter = ("is_active", "sub_bot")
    autocomplete_fields = ("sub_bot", "channel")


@admin.register(SubBotSubscriptionQuota)
class SubBotSubscriptionQuotaAdmin(admin.ModelAdmin):
    list_display = ("sub_bot", "max_mandatory_slots")
    search_fields = ("sub_bot__name",)
    autocomplete_fields = ("sub_bot",)


@admin.register(ListTemplate)
class ListTemplateAdmin(admin.ModelAdmin):
    list_display = ("sub_bot", "is_enabled", "post_interval", "post_interval_unit", "last_run")
    list_filter = ("is_enabled",)
    search_fields = ("sub_bot__name",)
    autocomplete_fields = ("sub_bot",)


@admin.register(PublishedList)
class PublishedListAdmin(admin.ModelAdmin):
    list_display = ("sub_bot", "channel_id", "message_id", "delete_at", "is_deleted")
    list_filter = ("is_deleted",)
    search_fields = ("sub_bot__name", "channel_id")
