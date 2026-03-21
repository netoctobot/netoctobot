
from asgiref.sync import sync_to_async
from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.core.states import AddBotSG
from bot.keyboards.inline.bot_management import get_cancel_keyboard, get_manage_bot_keyboard, get_my_bots_keyboard
from bot.keyboards.main_menu import get_main_keyboard # القائمة الرئيسية
from apps.bots.services import validate_and_register_bot
from bot.db_operations import activate_partner_wallet, get_user_and_subscription, get_user_bots
from aiogram.utils.keyboard import InlineKeyboardBuilder
from bot.utils.interface import update_main_interface

router = Router()

# اختيار نوع البوت
@router.callback_query(F.data == "add_new_bot")
async def choose_bot_type(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    builder = InlineKeyboardBuilder()
    builder.button(text=_("type-list"), callback_data="type_LST")
    builder.button(text=_("type-contact"), callback_data="type_CON")
    builder.adjust(1)
    
    await callback.message.edit_text(
        text=_("msg-select-bot-type"),
        reply_markup=builder.as_markup()
    )
    await state.set_state(AddBotSG.waiting_for_type)

# استلام النوع وطلب التوكن
@router.callback_query(AddBotSG.waiting_for_type, F.data.startswith("type_"))
async def ask_for_token(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    _ = i18n.get
    bot_type = callback.data.split("_")[1]
    await state.update_data(chosen_type=bot_type) # حفظ النوع في الذاكرة
    
    await callback.message.edit_text(
        text=_("msg-send-token-now"),
        reply_markup=get_cancel_keyboard(i18n)
    )
    await state.set_state(AddBotSG.waiting_for_token)

# معالجة التوكن والتنظيف الشامل
@router.message(AddBotSG.waiting_for_token)
async def process_token_cleanly(message: types.Message, state: FSMContext, i18n: I18nContext, bot: Bot):
    token = message.text.strip()
    _ = i18n.get
    
    # 1. حذف رسالة التوكن فوراً (أمان ونظافة)
    try:
        await message.delete()
    except: pass 

    # 2. جلب بيانات الجلسة (النوع المختار)
    data = await state.get_data()
    bot_type = data.get("chosen_type", "CON")

    # 3. جلب بيانات الاشتراك لتعديل الرسالة الأساسية
    user, subscription, created = await get_user_and_subscription(message.from_user, bot.token)

    # 4. استدعاء خدمة التحقق والتسجيل
    new_bot, status = await validate_and_register_bot(token, user, bot_type)

    if status == "success":
        # حالة النجاح: تفعيل المحفظة، تنظيف الحالة، الانتقال لـ "بوتاتي"
        await activate_partner_wallet(user)
        await state.clear()
        
        await update_main_interface(
            bot=bot,
            chat_id=message.chat.id,
            subscription=subscription,
            text=_("msg-bot-added-success", bot_name=new_bot.name),
            reply_markup=get_my_bots_keyboard(i18n, get_user_bots(user)) 
        )

    elif status == "exists":
        # حالة التوكن مسجل مسبقاً: نعدل الرسالة ونبقى في نفس الحالة (State)
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=subscription.last_main_message_id,
            text=_("err-token-already-registered"),
            reply_markup=get_cancel_keyboard(i18n)
        )

    elif status == "err-invalid-token":
        # حالة التوكن غير صحيح برمجياً: نعدل الرسالة ونبقى في نفس الحالة
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=subscription.last_main_message_id,
            text=_("err-token-invalid"),
            reply_markup=get_cancel_keyboard(i18n)
        )

    else:
        # حالة خطأ تقني غير متوقع (Exception): إبلاغ المستخدم ومحاولة تبسيط الخطأ
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=subscription.last_main_message_id,
            text=_("err-system-error", error_detail=status), # تمرير نص الخطأ للترجمة إذا أردت
            reply_markup=get_cancel_keyboard(i18n)
        )

@router.callback_query(F.data == "cancel_operation")
async def cancel_handler(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    """معالج زر الإلغاء: يمسح الحالة ويعيد المستخدم للقائمة الرئيسية"""
    _ = i18n.get
    current_state = await state.get_state()
    if current_state is None:
        return

    await state.clear()
    # العودة للقائمة الرئيسية (نحتاج لجلب بيانات المستخدم للأزرار)
    # ملاحظة: يمكنك استخدام دالة get_user_and_subscription هنا إذا لزم الأمر
    await callback.message.edit_text(
        text=_("msg-operation-cancelled"),
        reply_markup=get_manage_bot_keyboard(i18n)
    )
    await callback.answer(_("toast-cancelled"))