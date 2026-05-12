# إدارة قنوات الاشتراك الإجباري (منفصلة عن قنوات نشر اللستة)
from aiogram import Router, types, Bot, F
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext

from asgiref.sync import sync_to_async

from apps.bots.models import Channel
from bot.db.db_operations import (
    add_mandatory_channel_binding,
    count_active_mandatory_channels,
    delete_mandatory_binding,
    get_mandatory_bindings_for_sub_bot,
    get_or_create_subscription_quota,
    get_sub_bot_by_token,
)
from bot.keyboards.inline.bot_management import (
    get_add_bot_as_admin_and_cancel,
    get_mandatory_channels_management_keyboard,
)
from bot.states.sub_bot_states import MandatoryChannelSG
from bot.utils.common import get_chat_invite_link

router = Router()


async def _refresh_mandatory_view(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)
    quota = await get_or_create_subscription_quota(sub_bot)
    bindings = await get_mandatory_bindings_for_sub_bot(sub_bot)
    active = await count_active_mandatory_channels(sub_bot)
    text = _("mandatory-manage-intro", current=active, max_slots=quota.max_mandatory_slots)
    kb = get_mandatory_channels_management_keyboard(
        i18n, bindings, quota.max_mandatory_slots, active
    )
    await callback.message.edit_text(text, reply_markup=kb)


@router.callback_query(F.data == "manage_mandatory_sub")
async def show_mandatory_manage(
    callback: types.CallbackQuery, bot: Bot, i18n: I18nContext, state: FSMContext
):
    sub_bot = await get_sub_bot_by_token(bot.token)
    if sub_bot.owner.telegram_id != callback.from_user.id:
        return await callback.answer()

    await state.clear()
    await _refresh_mandatory_view(callback, bot, i18n)
    await callback.answer()


@router.callback_query(F.data == "mandatory_slots_full")
async def mandatory_slots_full_info(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    sub_bot = await get_sub_bot_by_token(bot.token)
    quota = await get_or_create_subscription_quota(sub_bot)
    await callback.answer(
        _("mandatory-slots-full", max=quota.max_mandatory_slots),
        show_alert=True,
    )


@router.callback_query(F.data == "mandatory_add_ch")
async def start_add_mandatory(
    callback: types.CallbackQuery,
    state: FSMContext,
    i18n: I18nContext,
    bot: Bot,
):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)
    if sub_bot.owner.telegram_id != callback.from_user.id:
        return await callback.answer()

    quota = await get_or_create_subscription_quota(sub_bot)
    active = await count_active_mandatory_channels(sub_bot)
    if active >= quota.max_mandatory_slots:
        return await callback.answer(
            _("mandatory-slots-full", max=quota.max_mandatory_slots),
            show_alert=True,
        )

    me = await bot.get_me()
    await state.set_state(MandatoryChannelSG.waiting_for_forward)
    await callback.message.edit_text(
        _("how-add-mandatory-channel"),
        reply_markup=get_add_bot_as_admin_and_cancel(
            i18n, me.username, cancel_callback="manage_mandatory_sub"
        ),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("mand_del_"))
async def delete_mandatory_row(
    callback: types.CallbackQuery, bot: Bot, i18n: I18nContext, state: FSMContext
):
    binding_id = callback.data.replace("mand_del_", "")
    ok, status = await delete_mandatory_binding(binding_id, callback.from_user.id)
    if not ok:
        return await callback.answer(_("error-occurred-during-deletion"), show_alert=True)

    await callback.answer(_("mandatory-deleted"), show_alert=True)
    await _refresh_mandatory_view(callback, bot, i18n)


@router.message(MandatoryChannelSG.waiting_for_forward)
async def process_mandatory_forward(
    message: types.Message, bot: Bot, i18n: I18nContext, state: FSMContext
):
    _ = i18n.get
    me = await bot.get_me()

    if not message.forward_from_chat or message.forward_from_chat.type != "channel":
        return await message.reply(
            _("please-send-msg-from-channel"),
            reply_markup=get_add_bot_as_admin_and_cancel(
                i18n, me.username, cancel_callback="manage_mandatory_sub"
            ),
        )

    chat = message.forward_from_chat
    try:
        member = await bot.get_chat_member(chat_id=chat.id, user_id=me.id)
        if member.status not in ["administrator", "creator"]:
            return await message.reply(_("bot-not-administrato-make-it"))
    except Exception:
        return await message.reply(_("channel-not-verified"))

    sub_bot = await get_sub_bot_by_token(bot.token)
    if message.from_user.id != sub_bot.owner.telegram_id:
        await state.clear()
        return

    quota = await get_or_create_subscription_quota(sub_bot)
    active = await count_active_mandatory_channels(sub_bot)
    if active >= quota.max_mandatory_slots:
        await state.clear()
        return await message.reply(
            _("mandatory-slots-full", max=quota.max_mandatory_slots)
        )

    invite_link = get_chat_invite_link(chat)
    channel, __ = await sync_to_async(Channel.objects.update_or_create)(
        channel_id=chat.id,
        defaults={
            "owner": sub_bot.owner,
            "title": chat.title or "",
            "invite_link": invite_link,
        },
    )

    added = await add_mandatory_channel_binding(sub_bot, channel)
    await state.clear()

    if not added:
        return await message.reply(_("mandatory-already-bound"))

    bindings = await get_mandatory_bindings_for_sub_bot(sub_bot)
    active = await count_active_mandatory_channels(sub_bot)
    kb = get_mandatory_channels_management_keyboard(
        i18n, bindings, quota.max_mandatory_slots, active
    )
    await message.reply(_("mandatory-added", title=chat.title), reply_markup=kb)
