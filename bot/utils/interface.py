from aiogram.exceptions import TelegramBadRequest
from aiogram import types, Bot
from aiogram_i18n import I18nContext
from aiogram.fsm.context import FSMContext
from asgiref.sync import sync_to_async
from apps.accounts.models import TelegramUser
from apps.bots.models import SubBot
from ..config import BOT_TOKEN, ADMIN_IDS
from bot.db_operations import get_user_and_subscription, get_sub_bot_by_id
from bot.keyboards.inline.bot_management import get_bot_settings_keyboard


async def update_main_interface(bot, chat_id, subscription, text, reply_markup,parse_mode="HTML"):
    # محاولة حذف الرسالة السابقة لهذا البوت تحديداً
    if subscription.last_main_message_id:
        try:
            await bot.delete_message(chat_id=chat_id, message_id=subscription.last_main_message_id)
        except TelegramBadRequest:
            pass # الرسالة قديمة جداً أو محذوفة

    # إرسال الرسالة الجديدة
    new_msg = await bot.send_message(
        chat_id=chat_id,
        text=text,
        parse_mode = parse_mode,
        reply_markup=reply_markup
    )


    # تحديث الـ ID في قاعدة البيانات (Async)
    subscription.last_main_message_id = new_msg.message_id
    await sync_to_async(subscription.save)()

async def update_interface(callback: types.CallbackQuery, text: str, reply_markup):
    await callback.message.edit_text(
        text=text,
        reply_markup=reply_markup
    )


async def show_main_menu_edit(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot, state: FSMContext):
    _ = i18n.get
    await state.clear()
    user, subscription, __ = await get_user_and_subscription(callback.from_user, bot.token)
    from bot.keyboards.main_menu import get_main_keyboard
    
    await callback.message.edit_text(
        text=_("welcome-back", full_name=user.full_name),
        reply_markup=get_main_keyboard(
            i18n, 
            is_admin=(callback.from_user.id in ADMIN_IDS), 
            is_partner=user.is_partner
        )
    )

@sync_to_async
def setup_master_bot_sync():
    # جلب الأدمن الأول من الإعدادات
    admin_id = ADMIN_IDS[0] if ADMIN_IDS else 0
    
    admin_user, _ = TelegramUser.objects.get_or_create(
        telegram_id=admin_id,
        defaults={'full_name': 'System Admin'}
    )
    
    # التأكد من وجود البوت الرئيسي
    master_bot, created = SubBot.objects.get_or_create(
        token=BOT_TOKEN,
        defaults={
            'name': 'Main Master Bot',
            'bot_type': 'SUP',
            'owner': admin_user,
            'is_active': True
        }
    )
    return master_bot

async def return_to_bot_settings(callback: types.CallbackQuery, bot_id: str, i18n: I18nContext, bot: Bot):
    _ = i18n.get

    user, subscription, __ = await get_user_and_subscription(callback.from_user, bot.token)
    sub_bot = await get_sub_bot_by_id(bot_id, user)
    
    if not sub_bot:
        return await callback.answer(_("err-bot-not-found"), show_alert=True)

    status_str = _("status-active") if sub_bot.is_active else _("status-stopped")
    text = _(
        "msg-bot-settings-header",
        bot_name=sub_bot.name,
        bot_username=sub_bot.username or "N/A",
        status=status_str,
        created_at=sub_bot.created_at.strftime("%Y-%m-%d")
    )

    await callback.message.edit_text(
        text=text,
        reply_markup=get_bot_settings_keyboard(i18n, sub_bot)
    )