
from asgiref.sync import sync_to_async
from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram_i18n import I18nContext
from bot.core.states import AddBotSG
from bot.keyboards.inline.bot_management import get_cancel_keyboard, get_manage_bot_keyboard
from bot.keyboards.main_menu import get_main_keyboard # القائمة الرئيسية
from apps.bots.services import validate_and_register_bot

router = Router()

@router.callback_query(F.data == "add_new_bot")
async def start_add_bot(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    await state.clear()
    await callback.message.edit_text(
        text=i18n.get("msg-send-bot-token"),
        reply_markup=get_cancel_keyboard(i18n) # إضافة زر الإلغاء هنا
    )
    await state.set_state(AddBotSG.waiting_for_token)
    await callback.answer()

@router.message(AddBotSG.waiting_for_token)
async def process_token(message: types.Message, state: FSMContext, i18n: I18nContext):
    token = message.text.strip()
    
    # رسالة انتظار للمستخدم
    status_msg = await message.answer(i18n.get("msg-checking-token"))
    
    # استدعاء الخدمة (Logic)
    from apps.accounts.models import TelegramUser
    user = await sync_to_async(TelegramUser.objects.get)(telegram_id=message.from_user.id)
    
    new_bot, status = await validate_and_register_bot(token, user)
    
    if status == "success":
        await status_msg.edit_text(i18n.get("msg-bot-added-success", bot_name=new_bot.name))
        await state.clear()
    elif status == "exists":
        await status_msg.edit_text(i18n.get("err-token-already-registered"))
    else:
        await status_msg.edit_text(i18n.get("err-invalid-token"))


@router.callback_query(F.data == "cancel_operation")
async def cancel_handler(callback: types.CallbackQuery, state: FSMContext, i18n: I18nContext):
    """معالج زر الإلغاء: يمسح الحالة ويعيد المستخدم للقائمة الرئيسية"""
    current_state = await state.get_state()
    if current_state is None:
        return

    await state.clear()
    # العودة للقائمة الرئيسية (نحتاج لجلب بيانات المستخدم للأزرار)
    # ملاحظة: يمكنك استخدام دالة get_user_and_subscription هنا إذا لزم الأمر
    await callback.message.edit_text(
        text=i18n.get("msg-operation-cancelled"),
        reply_markup=get_manage_bot_keyboard(i18n)
    )
    await callback.answer(i18n.get("toast-cancelled"))