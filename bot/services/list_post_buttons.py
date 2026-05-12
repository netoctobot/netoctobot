"""
كيبورد رسالة اللستة المنشورة: أزرار المالك (نص + سجل) ثم أزرار المنصة.
ترتيب: owner_buttons نصية → SubBotListButton → PlatformListButton
"""
from aiogram.types import InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder

from apps.bots.models import ListButtonType, PlatformListButton, SubBot, SubBotListButton
from bot.utils.formatters import build_custom_buttons


def build_list_keyboard_markup_for_bot(sub_bot: SubBot):
    builder = InlineKeyboardBuilder()
    build_custom_buttons(builder, sub_bot.owner_buttons or "")

    for btn in (
        SubBotListButton.objects.filter(sub_bot=sub_bot, is_active=True)
        .order_by("sort_order", "id")
    ):
        if btn.button_type == ListButtonType.URL and btn.url:
            builder.row(InlineKeyboardButton(text=btn.label, url=btn.url))
        elif btn.button_type == ListButtonType.CALLBACK:
            data = f"ownlst_{btn.pk}"
            if len(data) > 64:
                data = data[:64]
            builder.row(InlineKeyboardButton(text=btn.label, callback_data=data))

    for btn in PlatformListButton.objects.filter(is_active=True).order_by("sort_order", "id"):
        if btn.button_type == ListButtonType.URL and btn.url:
            builder.row(InlineKeyboardButton(text=btn.label, url=btn.url))
        elif btn.button_type == ListButtonType.CALLBACK:
            data = f"pltbtn_{btn.pk}"
            if len(data) > 64:
                data = data[:64]
            builder.row(InlineKeyboardButton(text=btn.label, callback_data=data))

    mk = builder.as_markup()
    if mk.inline_keyboard:
        return mk
    return None
