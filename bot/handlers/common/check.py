from aiogram import Router, F, types, Bot
from aiogram_i18n import I18nContext
from bot.utils.checks import check_all_subscriptions
from bot.db.db_operations import get_sub_bot_by_token
from bot.utils.checks import check_all_subscriptions
from bot.keyboards.inline.subscriptions import get_force_sub_keyboard
from bot.keyboards.inline.bot_management import get_list_bot_user_keyboard
from bot.keyboards.main_menu import get_user_main_menu
from bot.utils.formatters import format_personal_message

router = Router()


@router.callback_query(F.data == "check_again")
async def check_again_callback(callback: types.CallbackQuery, bot: Bot, i18n: I18nContext):
    _ = i18n.get
    not_joined = await check_all_subscriptions(bot, callback.from_user.id)
    
    if not_joined:
        await callback.message.edit_text(
            text=_("still-not-subscribed"),
            reply_markup=await get_force_sub_keyboard(i18n, not_joined, bot)
            )
    else:
        # إعادة إرسال رسالة الترحيب الأصلية
        sub_bot = await get_sub_bot_by_token(bot.token)
        default_key = "msg-list-default-welcome" if sub_bot.bot_type == "LST" else "msg-defult-welcome"
        raw_welcome = sub_bot.welcome_msg or _(default_key)
        p_mode = sub_bot.welcome_parse_mode
        text = format_personal_message(raw_welcome, callback.from_user, p_mode, i18n)

        if sub_bot.bot_type == "LST":
            reply_markup = get_list_bot_user_keyboard(i18n)
        else:
            reply_markup = get_user_main_menu(i18n, sub_bot.bot_type)

        await callback.message.edit_text(
            text=text,
            reply_markup=reply_markup,
            parse_mode=p_mode if p_mode != "PLAIN" else None,
        )
