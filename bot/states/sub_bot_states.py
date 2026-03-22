from aiogram.fsm.state import StatesGroup, State

class SubBotSettingsSG(StatesGroup):
    waiting_for_welcome_msg = State()  # انتظار نص الرسالة
    waiting_for_parse_mode = State()   # انتظار اختيار التنسيق