# bot/handlers/sub_bots/list_logic.py
import asyncio
from asgiref.sync import sync_to_async
from aiogram import Router, types, Bot, F
from aiogram.filters import CommandStart, ChatMemberUpdatedFilter, IS_ADMIN
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.filters import BotTypeFilter
from bot.db_operations import add_channel_to_sub_bot_logic, get_user_and_subscription, get_sub_bot_by_token,get_sub_bot_channels_list, delete_sub_bot_channel
from bot.utils.formatters import format_personal_message
from bot.keyboards.inline.bot_management import get_LST_owner_control_panel, get_channels_management_keyboard, get_add_bot_as_admin_and_cancel
from apps.bots.models import SubBot, SubBotChannel,Channel
from bot.utils.checks import check_all_subscriptions, handle_force_subscribe
from bot.keyboards.inline.subscriptions import get_force_sub_keyboard
from bot.keyboards.main_menu import get_user_main_menu
from bot.utils.interface import update_main_interface
from bot.states.sub_bot_states import AddChannelSG
from bot.utils.common import get_chat_invite_link
from aiogram.utils.keyboard import InlineKeyboardBuilder

router = Router()
router.message.filter(BotTypeFilter(SubBot.BotType.LIST)) # قفل أمان
router.callback_query.filter(BotTypeFilter(SubBot.BotType.LIST))

@router.message(CommandStart())
async def list_bot_start(message: types.Message, bot: Bot, i18n: I18nContext, state: FSMContext):    
    _ = i18n.get
    await state.clear() # تنظيف أي حالة سابقة
    
    # استخدام الدالة المركزية لجلب بيانات المستخدم واشتراكه في هذا البوت
    # الدالة تقوم بإنشاء TelegramUser و BotSubscription تلقائياً
    user, subscription, created = await get_user_and_subscription(
        tg_user=message.from_user,
        bot_token=bot.token
    )

    # إذا لم يتم العثور على البوت في القاعدة (توكن غير مسجل عندنا)
    if not subscription:
        return

    # ضبط اللغة بناءً على ما هو مخزن في اشتراك المستخدم لهذا البوت
    await i18n.set_locale(subscription.language)
    _ = i18n.get

    sub_bot = subscription.bot
    
    not_joined = await check_all_subscriptions(bot, message.from_user.id)
    
    if not_joined:
        return await handle_force_subscribe(message, i18n, sub_bot, not_joined)
    # --- أ: حالة المالك (Owner) ---
    if message.from_user.id == sub_bot.owner.telegram_id:
        owner_text = _("owner-control-panel")
        return await update_main_interface(
        bot=bot,
        chat_id=message.chat.id,
        subscription=subscription,
        text=owner_text,
         reply_markup=get_LST_owner_control_panel(i18n, "LST")
    )
        
    # تحضير رسالة الترحيب
    raw_welcome = sub_bot.welcome_msg or _("msg-list-default-welcome")
    p_mode = sub_bot.welcome_parse_mode
    
    # تنسيق النص بالبيانات الشخصية (اسم المستخدم، الخ)
    text = format_personal_message(raw_welcome, message.from_user, p_mode, i18n)

    await message.answer(
        text=text,
        parse_mode=p_mode if p_mode != "PLAIN" else None,
        disable_web_page_preview=True
    )

@router.callback_query(F.data == "check_again")
async def check_again_callback(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    not_joined = await check_all_subscriptions(bot, callback.from_user.id)
    
    if not_joined:
        await callback.message.edit_text(
            text=_("still-not-subscribed"),
            reply_markup=get_force_sub_keyboard(i18n, not_joined)
            )
    else:
        # إعادة إرسال رسالة الترحيب الأصلية
        sub_bot = await get_sub_bot_by_token(bot.token)
        await callback.message.edit_text(
            text=sub_bot.welcome_msg or _("thank-you-for-subscribing"),
            reply_markup=get_user_main_menu(i18n, sub_bot.bot_type)
        )


@router.callback_query(F.data == "manage_channels")
async def manage_channels_list(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    
    # await state.clear()
    
    # جلب القنوات المرتبطة بهذا البوت تحديداً
    sub_bot = await get_sub_bot_by_token(bot.token)
    channels = await get_sub_bot_channels_list(sub_bot)
    
    if not channels:
        return await callback.message.edit_text(
            _("no-channels-added"),
            reply_markup=get_channels_management_keyboard(i18n, [])
        )

    await callback.message.edit_text(
        _("list-channel-management"),
        reply_markup=get_channels_management_keyboard(i18n, channels)
    )
    await callback.answer()
    
@router.callback_query(F.data.startswith("delete_chan_"))
async def delete_channel_from_bot(callback: types.CallbackQuery, i18n: I18nContext):
    _ = i18n.get
    # استخراج الـ ID من callback_data
    chan_id = callback.data.split("_")[-1]
    
    # حذف الارتباط من قاعدة البيانات
    try:
        deleted_name = await delete_sub_bot_channel(chan_id)
        
        await callback.answer(_("msg-deleted-from-list",name=deleted_name),show_alert=True)  
        # تحديث القائمة بعد الحذف
        await manage_channels_list(callback, callback.bot, i18n)
    except Exception:
        await callback.answer(_("error-occurred-during-deletion"), show_alert=True)
        
@router.callback_query(F.data == "back_to_owner_panel")
async def back_to_owner(callback: types.CallbackQuery, i18n: I18nContext):
    await callback.message.edit_text(
        i18n.get("owner-control-panel"),
        reply_markup=get_LST_owner_control_panel(i18n, "LST")
    )


@router.callback_query(F.data == "add_channel")
async def start_add_channel(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    # await state.set_state(AddChannelSG.waiting_for_forward)
    # نأتي باليوزرنيم هنا (مرة واحدة)
    me = await bot.get_me() 
    
    # نمرر اليوزرنيم للدالة العادية
    keyboard = get_add_bot_as_admin_and_cancel(i18n, me.username)
    
    await callback.message.edit_text(
        _("how-add-channel"),
        reply_markup=keyboard
    )

@router.message(AddChannelSG.waiting_for_forward)
async def process_channel_forward(message: types.Message, bot: Bot, i18n: I18nContext, state: FSMContext):
    _ = i18n.get
    
    me = await bot.get_me()
    # التأكد أن الرسالة موجهة من قناة
    if not message.forward_from_chat or message.forward_from_chat.type != "channel":
        return await message.edit_text(
            _("please-send-msg-from-channel"),
            reply_markup=get_add_bot_as_admin_and_cancel(i18n,me.username)
            )

    chat = message.forward_from_chat

    # التحقق من صلاحيات البوت في تلك القناة
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
    
    # 1. حفظ/تحديث القناة في الجدول العام (Channel)
    invite_link = get_chat_invite_link(chat)
    
    channel, __ = await sync_to_async(Channel.objects.update_or_create)(
        channel_id=chat.id,
        defaults={
            'owner': sub_bot.owner,
            'title': chat.title,
            'invite_link': invite_link
        }
    )

    # 2. ربط القناة بهذا البوت تحديداً (SubBotChannel)
    await sync_to_async(SubBotChannel.objects.update_or_create)(
        sub_bot=sub_bot,
        channel=channel,
        defaults={'is_active': True}
    )

    await state.clear()
    await message.reply(
        _("channel-successfully-added",title=chat.title, id=chat.id),
        reply_markup=get_LST_owner_control_panel(i18n, "LST")
    )

@router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=IS_ADMIN))
async def on_bot_added_as_admin(event: types.ChatMemberUpdated, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    print("entering aldsk fakdsf klasf d")
    chat = event.chat
    user_id = event.from_user.id
    
    # جلب بيانات البوت الفرعي
    sub_bot = await get_sub_bot_by_token(bot.token)
    if not sub_bot: return

    # التمييز في الرسالة بين المالك والغريب
    is_owner = (sub_bot.owner.telegram_id == user_id)
    
    if is_owner:
        text = _("owner-msg-successful-added-bot",title=chat.title)
    else:
        text = _("msg-successful-added-bot",title=chat.title)

    builder = InlineKeyboardBuilder()
    builder.button(text=_("send-add-request"), callback_data=f"confirm_auto_add_{chat.id}")
    
    # نرسل الرسالة للشخص الذي قام بالإضافة (سواء كان المالك أو الشريك)
    await bot.send_message(chat_id=user_id, text=text, reply_markup=builder.as_markup())
    
@router.callback_query(F.data.startswith("confirm_auto_add_"))
async def finalize_auto_add(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    chat_id = int(callback.data.split("_")[-1])
    
    # جلب بيانات الشات والتوكن
    chat = await bot.get_chat(chat_id)
    sub_bot = await get_sub_bot_by_token(bot.token)
    invite_link_text = await get_chat_invite_link(chat)
    
    # استدعاء المنطق الشامل من db_operations
    success, status, is_owner = await add_channel_to_sub_bot_logic(
        sub_bot=sub_bot,
        chat_id=chat.id,
        title=chat.title,
        username=chat.username,
        invite_link=invite_link_text,
        telegram_user_id=callback.from_user.id
    )

    if not success:
        msg = _("channel-already-exists") if status == "exists" else _("err-msg-save")
        return await callback.answer(msg, show_alert=True)

    if is_owner:
        # المالك أضاف قناته الخاصة
        await callback.answer(
            _("channel-successfully-added",title=chat.title,id=chat.id), show_alert=True
            )
        await callback.message.delete()
    else:
        # شريك أضاف قناة (بانتظار موافقة المالك)
        await callback.message.edit_text(_("request-forwarded-owner"))
        
        # إشعار للمالك فوراً
        await bot.send_message(
            chat_id=sub_bot.owner.telegram_id,
            text=_("new-joining-request",titel=chat.title, full_name=callback.from_user.full_name),
            reply_markup=get_LST_owner_control_panel(i18n, "LST")
        )

@router.callback_query(F.data.startswith("toggle_chan_"))
async def toggle_channel_status(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    chan_id = callback.data.split("_")[-1]
    
    @sync_to_async
    def _toggle():
        sc = SubBotChannel.objects.get(id=chan_id)
        sc.is_active = not sc.is_active # عكس الحالة
        sc.save()
        return sc.is_active, sc.channel.title

    new_state, title = await _toggle()
    state_text = _("active") if new_state else _("desactive")
    
    await callback.answer(_("change-state",title=title,state_text=state_text),show_alert=True)
    
    # تحديث الكيبورد فوراً ليرى المالك التغيير
    await manage_channels_list(callback, bot, i18n)