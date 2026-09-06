from aiogram.fsm.state import StatesGroup, State

class AddBotSG(StatesGroup):
    waiting_for_type = State()  # اختيار النوع
    waiting_for_token = State() # إرسال التوكن 