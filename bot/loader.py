import os
import django
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from .config import BOT_TOKEN

# ربط البوت ببيئة Django (مهم جداً للوصول للمحافظ والمستخدمين)
def setup_django():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
    os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
    django.setup()

# تشغيل الربط
setup_django()

# سنستخدم مجلد locales داخل مجلد bot
I18N_DOMAIN = "messages"
LOCALES_DIR = os.path.join(os.path.dirname(__file__), 'locales')

i18n = I18n(path=LOCALES_DIR, default_locale="ar", domain=I18N_DOMAIN)

# دالة مساعدة لاستدعاء الترجمة في الكود
_ = i18n.gettext

#  إنشاء كائن البوت والـ Dispatcher
# نستخدم DefaultBotProperties لجعل كل الرسائل تدعم تنسيق HTML تلقائياً
bot = Bot(
    token=BOT_TOKEN, 
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)

dp = Dispatcher()

# تفعيل الميدل وير الخاص بالترجمة
# هذا سيجعل البوت يكتشف لغة المستخدم تلقائياً
dp.update.outer_middleware(FSMI18nMiddleware(i18n))