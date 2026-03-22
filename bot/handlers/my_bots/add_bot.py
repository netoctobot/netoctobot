import asyncio
from asgiref.sync import sync_to_async
from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.states.main_states import AddBotSG
from bot.keyboards.inline.bot_management import get_cancel_keyboard, get_manage_bot_keyboard, get_my_bots_keyboard
from bot.keyboards.main_menu import get_main_keyboard # القائمة الرئيسية
from apps.bots.services import validate_and_register_bot
from bot.db_operations import get_user_and_subscription, activate_partner_wallet, get_user_bots
from aiogram.utils.keyboard import InlineKeyboardBuilder

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
    
    # 1. جلب بيانات المستخدم والاشتراك أولاً (لكي نعرف أي رسالة سنعدل)
    user, subscription, create = await get_user_and_subscription(message.from_user, bot.token)

    # 2. حذف رسالة التوكن فوراً
    try:
        await message.delete()
    except: pass 

    # 3. إظهار رسالة "جاري التحقق" (الآن subscription متاح ولن يحدث خطأ)
    await bot.edit_message_text(
        chat_id=message.chat.id,
        message_id=subscription.last_main_message_id,
        text=_("msg-checking-token"),
        reply_markup=get_cancel_keyboard(i18n)
        )

    # 4. جلب نوع البوت من الحالة
    data = await state.get_data()
    bot_type = data.get("chosen_type", "CON")

    # 5. استدعاء خدمة التحقق والتسجيل
    new_bot, status = await validate_and_register_bot(token, user, bot_type)

    if status == "success":
        await activate_partner_wallet(user)
        await state.clear()
        
        # 🚀 تشغيل البوت الجديد فوراً في الخلفية
        from bot.main import dp # استيراد الـ Dispatcher الأساسي
        # نقوم بتشغيل مهمة (Task) جديدة لهذا البوت دون انتظارها لكي لا يتوقف البوت الرئيسي
        asyncio.create_task(dp.start_polling(new_bot.get_bot_instance()))
        
        # جلب قائمة البوتات المحدثة
        user_bots = await get_user_bots(user)
        
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=subscription.last_main_message_id,
            text=_("msg-bot-added-success", bot_name=new_bot.name),
            reply_markup=get_my_bots_keyboard(i18n, user_bots) 
            )

    elif status == "exists":
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=subscription.last_main_message_id,
            text=_("err-token-already-registered"),
            reply_markup=get_cancel_keyboard(i18n)
        )

    # ملاحظة: تأكد أن الحالة في الخدمة تعيد "invalid" وليس "err-invalid-token" 
    # لكي تتطابق مع الشرط أدناه أو اجعلهما متطابقين
    elif status == "invalid" or status == "err-invalid-token":
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=subscription.last_main_message_id,
            text=_("err-token-invalid"),
            reply_markup=get_cancel_keyboard(i18n)
        )

    else:
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=subscription.last_main_message_id,
            text=_("err-system-error", error_detail=status),
            reply_markup=get_cancel_keyboard(i18n)
        )
