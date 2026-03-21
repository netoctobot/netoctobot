from aiogram import Router, F, types, Bot
from aiogram_i18n import I18nContext
from bot.db_operations import get_user_and_subscription, get_user_bots
from bot.keyboards.inline.bot_management import get_my_bots_keyboard
from bot.utils.interface import update_main_interface

router = Router()

@router.callback_query(F.data == "list_my_bots")
async def show_bots_list(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    
    # 1. جلب بيانات المستخدم واشتراكه
    user, subscription, _ = await get_user_and_subscription(
        tg_user=callback.from_user,
        bot_token=bot.token
    )
    
    # 2. جلب قائمة البوتات المملوكة للمستخدم
    user_bots = await get_user_bots(user)
    
    # 3. تحديد النص بناءً على وجود بوتات من عدمه
    if not user_bots:
        text = _("msg-no-bots-found")
    else:
        text = _("msg-select-bot-to-manage", count=len(user_bots))
    
    # 4. تحديث الواجهة (تعديل الرسالة نفسها)
    await update_main_interface(
        bot=bot,
        chat_id=callback.message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=get_my_bots_keyboard(i18n, user_bots)
    )
    await callback.answer()