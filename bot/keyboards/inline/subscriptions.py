# bot\keyboards\inline\subscriptions.py
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram import types

def get_force_sub_keyboard(i18n, not_joined_channels):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    for chan in not_joined_channels:
        uname = getattr(chan, "username", None) or ""
        inv = getattr(chan, "invite_link", None)
        url = inv if inv else f"https://t.me/{uname}" if uname else "https://t.me/telegram"
        label = getattr(chan, "title", None) or (f"@{uname}" if uname else str(getattr(chan, "channel_id", "")))
        builder.row(types.InlineKeyboardButton(
            text=label,
            url=url
        ))
    
    builder.row(types.InlineKeyboardButton(
        text=_("subscribed"), 
        callback_data="check_again"
    ))
    return builder.as_markup()