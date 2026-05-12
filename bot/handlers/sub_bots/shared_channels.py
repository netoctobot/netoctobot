# قنوات البوت الفرعي: يعمل لبوت القائمة (LST) وبوت التواصل (CON)
from asgiref.sync import sync_to_async
from aiogram import Router, types, Bot, F
from aiogram.filters import ChatMemberUpdatedFilter, IS_ADMIN
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from aiogram.utils.keyboard import InlineKeyboardBuilder

from apps.bots.models import SubBot, SubBotChannel, Channel
from bot.db.db_operations import (
    add_channel_to_sub_bot_logic,
    get_sub_bot_by_token,
    get_sub_bot_channels_list,
    delete_sub_bot_channel,
    get_user_and_subscription,
)
from bot.keyboards.inline.bot_management import (
    get_channels_management_keyboard,
    get_LST_owner_control_panel,
    get_add_bot_as_admin_and_cancel,
    ok,
)
from bot.states.sub_bot_states import AddChannelSG
from bot.utils.common import get_chat_invite_link

router = Router()


@router.callback_query(F.data == "back_to_owner_panel")
async def back_to_owner_panel(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    sub_bot = await get_sub_bot_by_token(bot.token)
    await callback.message.edit_text(
        i18n.get("owner-control-panel"),
        reply_markup=get_LST_owner_control_panel(i18n, sub_bot.bot_type),
    )


@router.callback_query(F.data == "manage_channels")
async def manage_channels_list(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get

    sub_bot = await get_sub_bot_by_token(bot.token)
    if sub_bot.owner.telegram_id != callback.from_user.id:
        user, subscription, _ = await get_user_and_subscription(callback.from_user, bot.token)
        if not subscription:
            return await callback.answer()
        await i18n.set_locale(subscription.language)
        default_key = (
            "msg-list-default-welcome"
            if sub_bot.bot_type == SubBot.BotType.LIST
            else "msg-defult-welcome"
        )
        raw_welcome = sub_bot.welcome_msg or _(default_key)
        p_mode = sub_bot.welcome_parse_mode
        from bot.utils.formatters import format_personal_message
        from bot.keyboards.main_menu import get_user_main_menu

        text = format_personal_message(raw_welcome, callback.from_user, p_mode, i18n)
        user_markup = get_user_main_menu(i18n, sub_bot.bot_type)
        return await callback.message.edit_text(text=text, reply_markup=user_markup)

    channels = await get_sub_bot_channels_list(sub_bot)

    if not channels:
        return await callback.message.edit_text(
            _("no-channels-added"),
            reply_markup=get_channels_management_keyboard(i18n, []),
        )

    await callback.message.edit_text(
        _("list-channel-management"),
        reply_markup=get_channels_management_keyboard(i18n, channels),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("delete_chan_"))
async def delete_channel_from_bot(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    chan_id = callback.data.split("_")[-1]

    try:
        deleted_name = await delete_sub_bot_channel(chan_id)

        await callback.answer(_("msg-deleted-from-list", name=deleted_name), show_alert=True)
        await manage_channels_list(callback, bot, i18n)
    except Exception:
        await callback.answer(_("error-occurred-during-deletion"), show_alert=True)


@router.callback_query(F.data == "add_channel")
async def start_add_channel(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)
    if sub_bot.owner.telegram_id != callback.from_user.id:
        return await callback.answer(_("msg-feature-not-ready"), show_alert=True)

    me = await bot.get_me()
    keyboard = get_add_bot_as_admin_and_cancel(i18n, me.username)

    await state.set_state(AddChannelSG.waiting_for_forward)
    await state.update_data(target_bot_id=sub_bot.id)

    await callback.message.edit_text(
        _("how-add-channel"),
        reply_markup=keyboard,
    )
    await callback.answer()


@router.message(AddChannelSG.waiting_for_forward)
async def process_channel_forward(message: types.Message, bot: Bot, i18n: I18nContext, state: FSMContext):
    _ = i18n.get

    me = await bot.get_me()
    if not message.forward_from_chat or message.forward_from_chat.type != "channel":
        return await message.reply(
            _("please-send-msg-from-channel"),
            reply_markup=get_add_bot_as_admin_and_cancel(i18n, me.username),
        )

    chat = message.forward_from_chat

    valid_types = ["channel", "group", "supergroup"]
    if chat.type not in valid_types:
        return await message.reply(_("type-chat-not-supported"))
    try:
        member = await bot.get_chat_member(chat_id=chat.id, user_id=me.id)
        if member.status not in ["administrator", "creator"]:
            return await message.reply(_("bot-not-administrato-make-it"))
    except Exception:
        return await message.reply(_("channel-not-verified"))

    sub_bot = await get_sub_bot_by_token(bot.token)

    invite_link = get_chat_invite_link(chat)

    channel, __ = await sync_to_async(Channel.objects.update_or_create)(
        channel_id=chat.id,
        defaults={
            "owner": sub_bot.owner,
            "title": chat.title,
            "invite_link": invite_link,
        },
    )

    await sync_to_async(SubBotChannel.objects.update_or_create)(
        sub_bot=sub_bot,
        channel=channel,
        defaults={"is_active": True},
    )

    await state.clear()
    await message.reply(
        _("channel-successfully-added", title=chat.title, id=chat.id),
        reply_markup=get_LST_owner_control_panel(i18n, sub_bot.bot_type),
    )


@router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=IS_ADMIN))
async def on_bot_added_as_admin(event: types.ChatMemberUpdated, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    chat = event.chat
    user_id = event.from_user.id

    sub_bot = await get_sub_bot_by_token(bot.token)
    if not sub_bot:
        return

    is_owner = sub_bot.owner.telegram_id == user_id

    if is_owner:
        text = _("owner-msg-successful-added-bot", title=chat.title)
    else:
        text = _("msg-successful-added-bot", title=chat.title)

    builder = InlineKeyboardBuilder()
    builder.button(text=_("send-add-request"), callback_data=f"confirm_auto_add_{chat.id}")

    await bot.send_message(chat_id=user_id, text=text, reply_markup=builder.as_markup())


@router.callback_query(F.data.startswith("confirm_auto_add_"))
async def finalize_auto_add(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    chat_id = int(callback.data.split("_")[-1])

    chat = await bot.get_chat(chat_id)
    sub_bot = await get_sub_bot_by_token(bot.token)
    invite_link_text = await get_chat_invite_link(chat)

    success, status, is_owner = await add_channel_to_sub_bot_logic(
        sub_bot=sub_bot,
        chat_id=chat.id,
        title=chat.title,
        username=chat.username,
        invite_link=invite_link_text,
        telegram_user_id=callback.from_user.id,
    )

    if not success:
        msg = _("channel-already-exists") if status == "exists" else _("err-msg-save")
        return await callback.answer(msg, show_alert=True)

    if is_owner:
        await callback.answer(
            _("channel-successfully-added", title=chat.title, id=chat.id),
            show_alert=True,
        )
        await callback.message.delete()
    else:
        await callback.message.edit_text(_("request-forwarded-owner"))

        await bot.send_message(
            chat_id=sub_bot.owner.telegram_id,
            text=_("new-joining-request", titel=chat.title, full_name=callback.from_user.full_name),
            reply_markup=ok(i18n),
        )


@router.callback_query(F.data.startswith("toggle_chan_"))
async def toggle_channel_status(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    chan_id = callback.data.split("_")[-1]

    @sync_to_async
    def _toggle():
        sc = SubBotChannel.objects.get(id=chan_id)
        sc.is_active = not sc.is_active
        sc.save()
        return sc.is_active, sc.channel.title

    new_state, title = await _toggle()
    state_text = _("active") if new_state else _("desactive")

    await callback.answer(_("change-state", title=title, state_text=state_text), show_alert=True)

    await manage_channels_list(callback, bot, i18n)
