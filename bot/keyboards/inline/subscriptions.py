# bot\keyboards\inline\subscriptions.py
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram import types

def get_force_sub_keyboard(i18n, not_joined_channels):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    
    for chan in not_joined_channels:
        url = chan.invite_link if chan.invite_link else f"https://t.me/{chan.username}"
        builder.row(types.InlineKeyboardButton(
            text=chan.title, 
            url=url
        ))
    
    builder.row(types.InlineKeyboardButton(
        text=_("subscribed"), 
        callback_data="check_again"
    ))
    return builder.as_markup()