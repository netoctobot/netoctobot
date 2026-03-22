from aiogram import Router, F, types, Bot
from aiogram_i18n import I18nContext
from bot.db_operations import get_user_and_subscription, get_user_bots, get_sub_bot_by_id, toggle_sub_bot_status, delete_sub_bot
from bot.keyboards.inline.bot_management import get_my_bots_keyboard, get_bot_settings_keyboard, get_cancel_keyboard, get_parse_mode_keyboard
from bot.utils.interface import update_main_interface, return_to_bot_settings
from bot.utils.formatters import format_personal_message # الدالة التي صنعناها
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.fsm.context import FSMContext
from bot.states.sub_bot_states import SubBotSettingsSG
from apps.bots.models import SubBot
from asgiref.sync import sync_to_async

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
    bot_id = callback.data.split("_")[-1]
    
    # 1. جلب بيانات المستخدم (للتأكد من الصلاحية)
    user, subscription, __ = await get_user_and_subscription(callback.from_user, bot.token)
    
    # 2. تغيير الحالة في قاعدة البيانات
    updated_bot = await toggle_sub_bot_status(bot_id, user)
    
    if not updated_bot:
        return await callback.answer(_("err-bot-not-found"), show_alert=True)

    # 3. استخدام الدالة الموحدة لتحديث الواجهة بالكامل (نفس الرسالة)
    # هذه الدالة ستحل محل الخطوة (3 و 4) القديمة
    await return_to_bot_settings(callback, bot_id, i18n, bot)
    
    # 4. إشعار سريع للمستخدم بنجاح العملية (Toast)
    alert_msg = _("msg-bot-activated") if updated_bot.is_active else _("msg-bot-deactivated")
    await callback.answer(alert_msg)

@router.callback_query(F.data.startswith("confirm_delete_"))
async def ask_confirm_delete(callback: types.CallbackQuery, i18n: I18nContext):
    _ = i18n.get
    bot_id = callback.data.split("_")[-1]
    
    builder = InlineKeyboardBuilder()
    # زر التأكيد النهائي
    builder.button(text=_("btn-yes-delete"), callback_data=f"final_delete_{bot_id}")
    # زر التراجع (يعود لإعدادات البوت نفسه)
    builder.button(text=_("btn-no-cancel"), callback_data=f"manage_bot_{bot_id}")
    
    builder.adjust(2)
    
    await callback.message.edit_text(
        text=_("msg-are-you-sure-delete"),
        reply_markup=builder.as_markup()
    )
    await callback.answer()

@router.callback_query(F.data.startswith("final_delete_"))
async def process_final_delete(callback: types.CallbackQuery, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    bot_id = callback.data.split("_")[-1]
    
    # 1. جلب بيانات المستخدم واشتراكه
    user, subscription, create = await get_user_and_subscription(callback.from_user, bot.token)
    
    # 2. تنفيذ الحذف
    success = await delete_sub_bot(bot_id, user)
    
    if success:
        # جلب القائمة المحدثة بعد الحذف
        from bot.db_operations import get_user_bots
        user_bots = await get_user_bots(user)
        
        await update_main_interface(
            bot=bot,
            chat_id=callback.message.chat.id,
            subscription=subscription,
            text=_("msg-bot-deleted-successfully"),
            reply_markup=get_my_bots_keyboard(i18n, user_bots)
        )
        await callback.answer(_("toast-deleted-success"), show_alert=True)
    else:
        await callback.answer(_("err-delete-failed"), show_alert=True)


# --- 1. بدء عملية التعديل ---
@router.callback_query(F.data.startswith("edit_welcome_"))
async def start_edit_welcome(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    bot_id = callback.data.split("_")[-1]
    
    await state.update_data(target_bot_id=bot_id)
    await state.set_state(SubBotSettingsSG.waiting_for_parse_mode)
    

    await callback.message.edit_text(
        text=_("msg-select-parse-mode"),
        reply_markup=get_parse_mode_keyboard(i18n,bot_id)
    )
    await callback.answer()

# --- 2. حفظ نوع التنسيق وطلب النص ---
@router.callback_query(SubBotSettingsSG.waiting_for_parse_mode, F.data.startswith("set_mode_"))
async def set_parse_mode(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    mode = callback.data.split("_")[-1]
    await state.update_data(chosen_mode=mode)
    
    await state.set_state(SubBotSettingsSG.waiting_for_welcome_msg)
    
    instruction = _("msg-send-your-welcome-text", mode=mode)
    # تذكير المستخدم بالكلمات الدلالية
    instruction += "\n\n<code>{name}</code>, <code>{username}</code>, <code>{mention}</code>, <code>{id}</code>"
    
    await callback.message.edit_text(
        text=instruction,
        reply_markup=get_cancel_keyboard(i18n)
        )
    await callback.answer()

# --- 3. استقبال النص، التحقق، والحفظ ---
@router.message(SubBotSettingsSG.waiting_for_welcome_msg)
async def save_welcome_msg(message: types.Message, state: FSMContext, i18n: I18nContext, bot: Bot):
    _ = i18n.get
    data = await state.get_data()
    bot_id = data['target_bot_id']
    mode = data['chosen_mode']
    
    # التقاط النص مع التنسيق إذا كان HTML
    raw_text = message.html_text if mode == "HTML" else message.text

    # 1. اختبار التنسيق (Validation)
    try:
        # نمرر i18n للدالة لجلب التوقيع المترجم
        test_msg = format_personal_message(raw_text, message.from_user, mode, i18n)
        
        # محاولة إرسال المعاينة
        parse_mode_map = {"HTML": "HTML", "MDV2": "MarkdownV2", "PLAIN": None}
        await message.answer(
            text=f"{_('msg-preview-header')}\n\n{test_msg}",
            parse_mode=parse_mode_map.get(mode),
            disable_web_page_preview=True
        )
    except Exception as e:
        # إذا فشل التنسيق، نطلب منه المحاولة مرة أخرى دون الخروج من الحالة
        await message.reply(_("err-invalid-format", error=str(e)))
        return

    # 2. الحفظ النهائي في قاعدة البيانات
    from bot.db_operations import get_sub_bot_by_id
    from asgiref.sync import sync_to_async
    
    # (تأكد من جلب الكائن وحفظه)
    sub_bot = await get_sub_bot_by_id(bot_id, message.from_user.id) # عدل حسب دوال DB لديك
    if sub_bot:
        sub_bot.welcome_msg = raw_text
        sub_bot.welcome_parse_mode = mode
        await sync_to_async(sub_bot.save)()
        
        await message.answer(_("msg-welcome-saved-success"))
        await state.clear()
        # هنا يمكننا إعادته لواجهة التحكم بالبوت الرئيسي
     # حذف الرسالة فوراً
    try:
        await message.delete()
    except: pass 