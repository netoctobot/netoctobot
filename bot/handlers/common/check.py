from aiogram import Router, F, types, Bot
from aiogram_i18n import I18nContext
from aiogram_i18n import I18nContext
from bot.utils.checks import check_all_subscriptions
from bot.db_operations import  get_sub_bot_by_token
from bot.utils.checks import check_all_subscriptions
from bot.keyboards.inline.subscriptions import get_force_sub_keyboard
from bot.keyboards.main_menu import get_user_main_menu

router = Router()


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
