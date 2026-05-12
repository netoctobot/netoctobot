from aiogram.fsm.state import StatesGroup, State

class SubBotSettingsSG(StatesGroup):
    waiting_for_welcome_msg = State()  # انتظار نص الرسالة
    waiting_for_parse_mode = State()   # انتظار اختيار التنسيق
    
class AddChannelSG(StatesGroup):
    waiting_for_forward = State()

class MandatoryChannelSG(StatesGroup):
    """إضافة قناة للاشتراك الإجباري فقط (ليست قنوات اللستة)."""
    waiting_for_forward = State()

class ListTemplateSG(StatesGroup):
    waiting_for_header = State()      # انتظار النص العلوي
    waiting_for_footer = State()      # انتظار النص السفلي
    waiting_for_post_interval = State() # انتظار ساعات النشر
    waiting_for_delete_after = State()  # انتظار ساعات الحذف