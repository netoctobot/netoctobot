import os
import django
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram_i18n import I18nMiddleware
from aiogram_i18n.cores import BabelCore
from .config import BOT_TOKEN

# 1. تهيئة بيئة Django
def setup_django():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
    os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
    django.setup()

setup_django()

# 2. إعداد مسار ملفات الترجمة
LOCALES_DIR = os.path.join(os.path.dirname(__file__), 'locales')

# 3. إعداد محرك BabelCore
i18n_core = BabelCore(path=LOCALES_DIR, default_locale="ar", domain="messages")

# 4. إنشاء البوت والـ Dispatcher
bot = Bot(
    token=BOT_TOKEN, 
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)

dp = Dispatcher()

# 5. تسجيل الميدل وير (Middleware)
# هذا الجزء هو المسؤول عن اكتشاف لغة المستخدم وتوفير دالة الترجمة i18n
i18n_middleware = I18nMiddleware(core=i18n_core)
i18n_middleware.setup(dp)