from aiogram import Router, F, types, Bot
from aiogram_i18n import I18nContext
from bot.db_operations import get_user_and_subscription, get_user_bots, get_sub_bot_by_id, toggle_sub_bot_status
from bot.keyboards.inline.bot_management import get_my_bots_keyboard, get_bot_settings_keyboard
from bot.utils.interface import update_main_interface

router = Router()

@router.callback_query(F.data == "list_my_bots")
async def show_bots_list(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    
    # 1. جلب بيانات المستخدم واشتراكه
    user, subscription, created = await get_user_and_subscription(
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

@router.callback_query(F.data.startswith("manage_bot_"))
async def manage_single_bot(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    bot_id = callback.data.split("_")[-1]
    
    # 1. جلب بيانات المستخدم واشتراكه
    user, subscription, cerate = await get_user_and_subscription(callback.from_user, bot.token)
    
    # 2. جلب بيانات البوت المختار
    sub_bot = await get_sub_bot_by_id(bot_id, user)
    
    if not sub_bot:
        await callback.answer(_("err-bot-not-found"), show_alert=True)
        return

    # 3. صياغة نص الإعدادات (يمكنك إضافة إحصائيات هنا لاحقاً)
    status_str = _("status-active") if sub_bot.is_active else _("status-stopped")
    
    text = _(
        "msg-bot-settings-header",
        bot_name=sub_bot.name,
        bot_username=sub_bot.username or "N/A",
        status=status_str,
        created_at=sub_bot.created_at.strftime("%Y-%m-%d")
    )

    # 4. تحديث الواجهة
    await update_main_interface(
        bot=bot,
        chat_id=callback.message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=get_bot_settings_keyboard(i18n, sub_bot)
    )
    await callback.answer()

@router.callback_query(F.data.startswith("toggle_bot_"))
async def toggle_bot_handler(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    # جلب الـ UUID كنص (String)
    bot_id = callback.data.split("_")[-1]
    
    # 1. جلب بيانات المستخدم والاشتراك
    user, subscription, create = await get_user_and_subscription(callback.from_user, bot.token)
    
    # 2. تغيير الحالة في قاعدة البيانات
    updated_bot = await toggle_sub_bot_status(bot_id, user)
    
    if not updated_bot:
        await callback.answer(_("err-bot-not-found"), show_alert=True)
        return

    # 3. تجهيز النصوص الجديدة بناءً على الحالة المحدثة
    status_str = _("status-active") if updated_bot.is_active else _("status-stopped")
    
    text = _(
        "msg-bot-settings-header",
        bot_name=updated_bot.name,
        bot_username=updated_bot.username or "N/A",
        status=status_str,
        created_at=updated_bot.created_at.strftime("%Y-%m-%d")
    )

    # 4. تحديث الواجهة فوراً باستخدام الكيبورد المحدث
    await update_main_interface(
        bot=bot,
        chat_id=callback.message.chat.id,
        subscription=subscription,
        text=text,
        reply_markup=get_bot_settings_keyboard(i18n, updated_bot)
    )
    
    # إشعار سريع للمستخدم بنجاح العملية
    alert_msg = _("msg-bot-activated") if updated_bot.is_active else _("msg-bot-deactivated")
    await callback.answer(alert_msg)