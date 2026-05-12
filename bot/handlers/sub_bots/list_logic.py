# bot/handlers/sub_bots/list_logic.py
import asyncio
from asgiref.sync import sync_to_async
from aiogram import Router, types, Bot, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext

from apps.bots.models import SubBot, ListTemplate
from bot.db.db_operations import get_user_and_subscription, get_sub_bot_by_token
from bot.filters import BotTypeFilter
from bot.keyboards.inline.bot_management import (
    get_template_management_keyboard,
    get_LST_user_main_keyboard,
    get_LST_owner_control_panel,
    get_interval_unit_keyboard,
)
from bot.keyboards.inline.subscriptions import get_force_sub_keyboard
from bot.keyboards.main_menu import get_user_main_menu
from bot.services.list_interval import (
    describe_interval,
    sync_list_auto_post_job,
)
from bot.services.scheduler import remove_list_post_job
from bot.states.sub_bot_states import ListTemplateSG
from bot.utils.checks import check_all_subscriptions, handle_force_subscribe
from bot.utils.common import delete_message_after
from bot.utils.formatters import format_personal_message, generate_list_message
from bot.utils.interface import update_main_interface

router = Router()
router.message.filter(BotTypeFilter(SubBot.BotType.LIST))
router.callback_query.filter(BotTypeFilter(SubBot.BotType.LIST))

_UNIT_SUFFIX = {"sec": "sec", "min": "min", "hour": "hour"}


def _parse_unit_callback(data: str, prefix: str) -> str | None:
    """مثال: post_int_unit_sec → sec"""
    tail = data.replace(f"{prefix}_unit_", "")
    return tail if tail in _UNIT_SUFFIX else None


@router.message(CommandStart())
async def list_bot_start(message: types.Message, bot: Bot, i18n: I18nContext, state: FSMContext):
    _ = i18n.get
    await state.clear()

    user, subscription, created = await get_user_and_subscription(
        tg_user=message.from_user,
        bot_token=bot.token,
    )

    if not subscription:
        return

    await i18n.set_locale(subscription.language)

    sub_bot = subscription.bot

    not_joined = await check_all_subscriptions(bot, message.from_user.id)

    if not_joined:
        return await handle_force_subscribe(message, i18n, sub_bot, not_joined)

    if message.from_user.id == sub_bot.owner.telegram_id:
        owner_text = _("owner-control-panel")
        return await update_main_interface(
            bot=bot,
            chat_id=message.chat.id,
            subscription=subscription,
            text=owner_text,
            reply_markup=get_LST_owner_control_panel(i18n, "LST"),
        )

    raw_welcome = sub_bot.welcome_msg or _("msg-list-default-welcome")
    p_mode = sub_bot.welcome_parse_mode
    text = format_personal_message(raw_welcome, message.from_user, p_mode, i18n)

    user_markup = get_LST_user_main_keyboard(i18n)

    await update_main_interface(
        bot=bot,
        chat_id=message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=user_markup,
    )


@router.callback_query(F.data == "check_again")
async def check_again_callback(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    not_joined = await check_all_subscriptions(bot, callback.from_user.id)

    if not_joined:
        await callback.message.edit_text(
            text=_("still-not-subscribed"),
            reply_markup=get_force_sub_keyboard(i18n, not_joined),
        )
    else:
        sub_bot = await get_sub_bot_by_token(bot.token)
        await callback.message.edit_text(
            text=sub_bot.welcome_msg or _("thank-you-for-subscribing"),
            reply_markup=get_user_main_menu(i18n, sub_bot.bot_type),
        )


@router.callback_query(F.data == "manage_template")
async def show_template_settings(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)

    config, created = await sync_to_async(ListTemplate.objects.get_or_create)(sub_bot=sub_bot)

    interval_label = describe_interval(
        config.post_interval, config.post_interval_unit, _
    )
    if config.delete_after <= 0:
        delete_label = _("auto-delete-disabled")
    else:
        delete_label = describe_interval(
            config.delete_after, config.delete_after_unit, _
        )

    text = _("template-settings-view").format(
        header=config.header_text or _("not-set"),
        footer=config.footer_text or _("not-set"),
        interval=interval_label,
        delete=delete_label,
    )

    await callback.message.edit_text(
        text=text,
        reply_markup=get_template_management_keyboard(i18n, config.is_enabled),
    )


@router.callback_query(F.data == "edit_header")
async def ask_for_header(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    message = await callback.message.answer(_("please-send-header-text"))
    await state.set_state(ListTemplateSG.waiting_for_header)
    await state.update_data(msg_id=message.message_id)


@router.message(ListTemplateSG.waiting_for_header)
async def process_header(message: types.Message, state: FSMContext, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)

    await sync_to_async(ListTemplate.objects.filter(sub_bot=sub_bot).update)(
        header_text=message.html_text
    )

    msg = await message.answer(_("header-updated-successfully"))
    data = await state.get_data()
    old_msg_id = data.get("msg_id")

    if old_msg_id:
        try:
            await bot.delete_message(chat_id=message.chat.id, message_id=old_msg_id)
        except Exception as e:
            print(f"فشل حذف الرسالة القديمة: {e}")

    asyncio.create_task(delete_message_after(msg, 4))
    asyncio.create_task(delete_message_after(message, 1))
    await state.clear()


@router.callback_query(F.data == "edit_footer")
async def ask_for_footer(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    message = await callback.message.answer(_("please-send-footer-text"))
    await state.set_state(ListTemplateSG.waiting_for_footer)
    await state.update_data(msg_id=message.message_id)


@router.message(ListTemplateSG.waiting_for_footer)
async def process_footer(message: types.Message, state: FSMContext, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)

    await sync_to_async(ListTemplate.objects.filter(sub_bot=sub_bot).update)(
        footer_text=message.html_text
    )

    msg = await message.answer(_("footer-updated-successfully"))
    data = await state.get_data()
    old_msg_id = data.get("msg_id")

    if old_msg_id:
        try:
            await bot.delete_message(chat_id=message.chat.id, message_id=old_msg_id)
        except Exception as e:
            print(f"فشل حذف الرسالة القديمة: {e}")

    asyncio.create_task(delete_message_after(msg, 4))
    await message.delete()
    await state.clear()


@router.callback_query(F.data == "preview_template")
async def preview_list_template(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)

    preview_text = await generate_list_message(sub_bot, i18n)

    if not preview_text:
        return await callback.answer(_("error-no-channels-to-preview"), show_alert=True)

    try:
        await callback.message.edit_text(
            text=f"{preview_text}",
            parse_mode="HTML",
            reply_markup=callback.message.reply_markup,
            disable_web_page_preview=True,
        )
        await callback.answer()
    except Exception:
        await callback.message.edit_text(
            _("error-in-html-format"),
            reply_markup=callback.message.reply_markup,
        )


@router.callback_query(F.data == "edit_interval")
async def ask_for_interval(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    sent_msg = await callback.message.answer(
        _("pick-interval-unit"),
        reply_markup=get_interval_unit_keyboard(i18n, "post_int"),
    )
    await state.update_data(msg_id=sent_msg.message_id)
    await callback.answer()


@router.callback_query(F.data.startswith("post_int_unit_"))
async def pick_post_interval_unit(
    callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot
):
    _ = i18n.get
    unit = _parse_unit_callback(callback.data, "post_int")
    if not unit:
        return await callback.answer()

    await state.update_data(post_interval_unit=unit)
    await state.set_state(ListTemplateSG.waiting_for_post_interval)

    chat_id = callback.message.chat.id
    try:
        await callback.message.delete()
    except Exception:
        pass

    prompt = _("please-send-interval-number")
    sent = await bot.send_message(chat_id=chat_id, text=prompt)
    await state.update_data(msg_id=sent.message_id)
    await callback.answer()


@router.message(ListTemplateSG.waiting_for_post_interval)
async def process_interval(message: types.Message, state: FSMContext, bot: Bot, i18n: I18nContext):
    _ = i18n.get

    if not message.text or not message.text.isdigit():
        asyncio.create_task(delete_message_after(message))
        return asyncio.create_task(
            delete_message_after(await message.answer(_("error-invalid-interval")))
        )

    interval_time = int(message.text)
    if interval_time < 1:
        interval_time = 1

    data = await state.get_data()
    unit = data.get("post_interval_unit") or "hour"

    sub_bot = await get_sub_bot_by_token(bot.token)

    await sync_to_async(ListTemplate.objects.filter(sub_bot=sub_bot).update)(
        post_interval=interval_time,
        post_interval_unit=unit,
    )

    if data.get("msg_id"):
        try:
            await bot.delete_message(message.chat.id, data["msg_id"])
        except Exception:
            pass

    try:
        await message.delete()
    except Exception:
        pass

    label = describe_interval(interval_time, unit, _)
    msg = await message.answer(_("interval-updated-successfully", label=label))
    asyncio.create_task(delete_message_after(msg, 4))
    await state.clear()

    await sync_to_async(sync_list_auto_post_job)(sub_bot.id)


@router.callback_query(F.data == "edit_delete_time")
async def ask_for_delete_time(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    sent_msg = await callback.message.answer(
        _("pick-delete-unit"),
        reply_markup=get_interval_unit_keyboard(i18n, "del_af"),
    )
    await state.update_data(msg_id=sent_msg.message_id)
    await callback.answer()


@router.callback_query(F.data.startswith("del_af_unit_"))
async def pick_delete_after_unit(
    callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot
):
    _ = i18n.get
    unit = _parse_unit_callback(callback.data, "del_af")
    if not unit:
        return await callback.answer()

    await state.update_data(delete_after_unit=unit)
    await state.set_state(ListTemplateSG.waiting_for_delete_after)

    chat_id = callback.message.chat.id
    try:
        await callback.message.delete()
    except Exception:
        pass

    sent = await bot.send_message(chat_id=chat_id, text=_("please-send-delete-after-number"))
    await state.update_data(msg_id=sent.message_id)
    await callback.answer()


@router.message(ListTemplateSG.waiting_for_delete_after)
async def process_delete_after(message: types.Message, state: FSMContext, bot: Bot, i18n: I18nContext):
    _ = i18n.get

    if not message.text or not message.text.isdigit():
        asyncio.create_task(delete_message_after(message))
        return asyncio.create_task(
            delete_message_after(await message.answer(_("error-invalid-interval")))
        )

    delete_time = int(message.text)
    data = await state.get_data()
    unit = data.get("delete_after_unit") or "hour"

    sub_bot = await get_sub_bot_by_token(bot.token)

    if delete_time <= 0:
        await sync_to_async(ListTemplate.objects.filter(sub_bot=sub_bot).update)(
            delete_after=0,
            delete_after_unit="hour",
        )
        success_text = _("auto-delete-disabled")
    else:
        if delete_time < 1:
            delete_time = 1
        await sync_to_async(ListTemplate.objects.filter(sub_bot=sub_bot).update)(
            delete_after=delete_time,
            delete_after_unit=unit,
        )
        success_text = _("delete-time-updated-successfully", label=describe_interval(delete_time, unit, _))

    old_msg_id = data.get("msg_id")
    if old_msg_id:
        try:
            await bot.delete_message(chat_id=message.chat.id, message_id=old_msg_id)
        except Exception:
            pass

    try:
        await message.delete()
    except Exception:
        pass

    confirm_msg = await message.answer(success_text)
    await state.clear()
    asyncio.create_task(delete_message_after(confirm_msg, 4))


@router.callback_query(F.data == "toggle_auto_post")
async def toggle_auto_post_status(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)

    config, created = await sync_to_async(ListTemplate.objects.get_or_create)(sub_bot=sub_bot)

    new_status = not config.is_enabled
    config.is_enabled = new_status
    await sync_to_async(config.save)()

    if new_status:
        await sync_to_async(sync_list_auto_post_job)(sub_bot.id)
        message_text = _("publishing-enabled-success")
    else:
        await sync_to_async(remove_list_post_job)(sub_bot.id)
        message_text = _("publishing-disabled-success")

    await callback.message.edit_reply_markup(
        reply_markup=get_template_management_keyboard(i18n, new_status)
    )

    await callback.answer(message_text, show_alert=True)
