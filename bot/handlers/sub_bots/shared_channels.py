# قنوات البوت الفرعي: يعمل لبوت القائمة (LST) وبوت التواصل (CON)
import asyncio
import logging
from asgiref.sync import sync_to_async
from aiogram import Router, types, Bot, F
from aiogram.filters import ChatMemberUpdatedFilter, IS_ADMIN
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.exceptions import TelegramForbiddenError, TelegramBadRequest

from apps.bots.models import SubBot, SubBotChannel, Channel
from bot.db.db_operations import (
    add_channel_to_sub_bot_logic,
    get_sub_bot_by_token,
    get_sub_bot_channels_list,
    process_channel_deletion_logic,
    get_user_and_subscription,
)
from bot.keyboards.inline.bot_management import (
    get_channels_management_keyboard,
    get_LST_owner_control_panel,
    get_add_bot_as_admin_and_cancel,
    get_LST_user_main_keyboard,
    ok,
)
from bot.states.sub_bot_states import AddChannelSG
from bot.utils.common import get_chat_invite_link, delete_message_after
# shared_channels_router
router = Router()

logger = logging.getLogger(__name__)


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
    
    # منطق SaaS: المالك يرى الكل، الشريك يرى قنواته فقط
    is_owner = sub_bot.owner.telegram_id == callback.from_user.id
    target_user_id = None if is_owner else callback.from_user.id

    channels = await get_sub_bot_channels_list(sub_bot, user_id=target_user_id)

    if not channels:
        msg = _("list-channel-management") if is_owner else _("no-channels-added")
        return await callback.message.edit_text(msg, reply_markup=get_channels_management_keyboard(i18n, []))

    await callback.message.edit_text(
        _("list-channel-management"),
        reply_markup=get_channels_management_keyboard(i18n, channels),
    )
    await callback.answer()


@router.callback_query(F.data == "cancel_add_channel")
async def cancel_add_channel_handler(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot):
    await state.clear()
    sub_bot = await get_sub_bot_by_token(bot.token)

    if sub_bot and callback.from_user.id == sub_bot.owner.telegram_id:
        # للمالك: العودة للوحة التحكم عبر تعديل الرسالة
        await callback.message.edit_text(
            i18n.get("owner-control-panel"),
            reply_markup=get_LST_owner_control_panel(i18n, sub_bot.bot_type),
        )
    elif sub_bot:
        # للمستخدم: العودة للقائمة الرئيسية للبوت الفرعي عبر تعديل الرسالة
        from bot.keyboards.main_menu import get_user_main_menu
        from bot.utils.formatters import format_personal_message

        if sub_bot.bot_type == SubBot.BotType.LIST:
            reply_markup = get_LST_user_main_keyboard(i18n)
            welcome_key = "msg-list-default-welcome"
        else:
            reply_markup = get_user_main_menu(i18n, sub_bot.bot_type)
            welcome_key = "msg-defult-welcome"

        raw_welcome = sub_bot.welcome_msg or i18n.get(welcome_key)
        text = format_personal_message(raw_welcome, callback.from_user, sub_bot.welcome_parse_mode, i18n)
        await callback.message.edit_text(text=text, reply_markup=reply_markup)
    
    await callback.answer()


@router.callback_query(F.data.startswith("delete_chan_"))
async def delete_channel_from_bot(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    bot_chan_id = callback.data.split("_")[-1]

    try:
        # 1. التحقق من صلاحيات البوت في القناة قبل اتخاذ قرار الحذف
        @sync_to_async
        def _get_cid(): return SubBotChannel.objects.get(id=bot_chan_id).channel.channel_id
        
        target_cid = await _get_cid()
        is_admin = False
        try:
            member = await bot.get_chat_member(chat_id=target_cid, user_id=bot.id)
            is_admin = member.status in ["administrator", "creator"]
        except:
            pass

        # 2. تنفيذ منطق الحذف أو التجميد
        name, status = await process_channel_deletion_logic(bot_chan_id, is_admin)

        if status == "frozen":
            await callback.answer(_("msg-channel-frozen", name=name), show_alert=True)
        else:
            await callback.answer(_("msg-deleted-from-list", name=name), show_alert=True)
            
        await manage_channels_list(callback, bot, i18n)
    except Exception:
        await callback.answer(_("error-occurred-during-deletion"), show_alert=True)


@router.callback_query(F.data == "add_channel")
async def start_add_channel(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    sub_bot = await get_sub_bot_by_token(bot.token)
    if not sub_bot:
        return

    # استخدام اليوزرنيم المخزن في قاعدة البيانات لتوفير طلب الشبكة
    keyboard = get_add_bot_as_admin_and_cancel(i18n, sub_bot.username, "cancel_add_channel")

    await state.clear()
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
    
    # الحماية من الأوامر أثناء انتظار التوجيه
    if message.text.startswith("/"):
        await state.clear()
        reply = await message.reply(_("repeat-command"))
        asyncio.create_task(delete_message_after(reply))
        asyncio.create_task(delete_message_after(message))
        return

    sub_bot = await get_sub_bot_by_token(bot.token)
    if not sub_bot: return

    # التأكد من وجود رسالة موجهة ومن أنها قناة أو مجموعة
    if not message.forward_from_chat or message.forward_from_chat.type != "channel":
        # استثناء المجموعات إذا كانت مدعومة في valid_types أدناه
        if not message.forward_from_chat or message.forward_from_chat.type not in ["group", "supergroup"]:
            reply = await message.reply(
                _("please-send-msg-from-channel"),
                reply_markup=get_add_bot_as_admin_and_cancel(i18n, sub_bot.username, "cancel_add_channel"),
            )
            asyncio.create_task(delete_message_after(reply))
            asyncio.create_task(delete_message_after(message))
            return

    chat = message.forward_from_chat

    valid_types = ["channel", "group", "supergroup"]
    if chat.type not in valid_types:
        reply = await message.reply(_("type-chat-not-supported"))
        asyncio.create_task(delete_message_after(reply))
        asyncio.create_task(delete_message_after(message))
        return
    try:
        # bot.id متاح برمجياً دون الحاجة لـ get_me()
        member = await bot.get_chat_member(chat_id=chat.id, user_id=bot.id)
        if member.status not in ["administrator", "creator"]:
            reply = await message.reply(_("bot-not-administrato-make-it"))
            asyncio.create_task(delete_message_after(reply))
            asyncio.create_task(delete_message_after(message))
            return
    except Exception:
        reply = await message.reply(_("channel-not-verified"))
        asyncio.create_task(delete_message_after(reply))
        asyncio.create_task(delete_message_after(message))
        return

    # التأكد من جلب رابط صالح (غير Coroutine)
    invite_link_raw = await get_chat_invite_link(chat)
    invite_link = invite_link_raw if isinstance(invite_link_raw, str) else None

    success, sub_chan_id, is_owner = await add_channel_to_sub_bot_logic(
        sub_bot=sub_bot,
        chat_id=chat.id,
        title=chat.title or "No Title",
        username=chat.username,
        invite_link=invite_link,
        telegram_user_id=message.from_user.id,
    )

    if not success:
        reply = await message.reply(_("channel-already-exists"))
        asyncio.create_task(delete_message_after(reply))
        asyncio.create_task(delete_message_after(message))
        return

    await state.clear()

    if is_owner:
        reply = await message.reply(
            _("channel-successfully-added", title=chat.title, id=chat.id),
            reply_markup=get_LST_owner_control_panel(i18n, sub_bot.bot_type),
        )
        asyncio.create_task(delete_message_after(reply))
        asyncio.create_task(delete_message_after(message))
    else:
        # إبلاغ المستخدم بالانتظار
        await message.reply(
            _("request-forwarded-owner"),
            reply_markup=ok(i18n),
            )

        # إخطار المالك مع زر تفعيل مباشر
        builder = InlineKeyboardBuilder()
        builder.button(text=_("btn-activate-now"), callback_data=f"toggle_chan_{sub_chan_id}")
        builder.button(text=_("ok"), callback_data="ok_and_remove")
        builder.adjust(1)

        try:
            await bot.send_message(
                chat_id=sub_bot.owner.telegram_id,
                text=_("new-joining-request", titel=chat.title, full_name=message.from_user.full_name),
                reply_markup=builder.as_markup(),
            )
        except (TelegramForbiddenError, TelegramBadRequest) as e:
            # حماية SaaS: المالك حظر البوت، نسجل ذلك في اللوج ونستمر في تفعيل القناة
            logger.warning(f"Failed to notify owner {sub_bot.owner.telegram_id}: {e}")


@router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=IS_ADMIN))
async def on_bot_added_as_admin(event: types.ChatMemberUpdated, bot: Bot, i18n: I18nContext, state: FSMContext):
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

    await state.clear()
    await bot.send_message(chat_id=user_id, text=text, reply_markup=builder.as_markup())


@router.callback_query(F.data.startswith("confirm_auto_add_"))
async def finalize_auto_add(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    chat_id = int(callback.data.split("_")[-1])

    chat = await bot.get_chat(chat_id)
    sub_bot = await get_sub_bot_by_token(bot.token)
    invite_link_text = await get_chat_invite_link(chat)

    success, sub_chan_id, is_owner = await add_channel_to_sub_bot_logic(
        sub_bot=sub_bot,
        chat_id=chat.id,
        title=chat.title,
        username=chat.username,
        invite_link=invite_link_text,
        telegram_user_id=callback.from_user.id,
    )

    if not success:
        return await callback.answer(_("channel-already-exists"), show_alert=True)

    if is_owner:
        await callback.answer(
            _("channel-successfully-added", title=chat.title, id=chat.id),
            show_alert=True,
        )
        await callback.message.delete()
    else:
        reply = await callback.message.edit_text(_("request-forwarded-owner"))
        asyncio.create_task(delete_message_after(reply))

        # إخطار المالك مع خيار التفعيل
        builder = InlineKeyboardBuilder()
        builder.button(text=_("btn-activate-now"), callback_data=f"toggle_chan_{sub_chan_id}")
        builder.button(text=_("ok"), callback_data="ok_and_remove")
        builder.adjust(1)

        try:
            await bot.send_message(
                chat_id=sub_bot.owner.telegram_id,
                text=_("new-joining-request", titel=chat.title, full_name=callback.from_user.full_name),
                reply_markup=builder.as_markup(),
            )
        except (TelegramForbiddenError, TelegramBadRequest) as e:
            # المالك حظر البوت، لكن العملية تمت بنجاح في قاعدة البيانات
            logger.warning(f"Failed to notify owner {sub_bot.owner.telegram_id} via callback: {e}")


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
