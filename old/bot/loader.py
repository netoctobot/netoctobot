import os
import django
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram_i18n import I18nMiddleware
from aiogram_i18n.cores import GNUTextCore
from .config import BOT_TOKEN

# 1. تهيئة Django
def setup_django():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
    os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
    django.setup()

setup_django()

# 2. إنشاء البوت والديسباتشر
bot = Bot(
    token=BOT_TOKEN, 
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)
dp = Dispatcher()

# 3. المسار الصحيح للمجلد
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCALES_PATH = os.path.join(BASE_DIR, "locales")

# 4. التحقق من وجود ملفات الترجمة
print("🔍 Checking translation files:")
for lang in ['ar', 'en']:
    mo_path = os.path.join(LOCALES_PATH, lang, 'LC_MESSAGES', 'messages.mo')
    po_path = os.path.join(LOCALES_PATH, lang, 'LC_MESSAGES', 'messages.po')
    
    print(f"  {lang}:")
    print(f"    MO exists: {os.path.exists(mo_path)} - {mo_path}")
    print(f"    PO exists: {os.path.exists(po_path)} - {po_path}")
    
    # إذا وجد PO ولكن لا يوجد MO، انسخ PO كـ MO
    if os.path.exists(po_path) and not os.path.exists(mo_path):
        print(f"    ⚠️  Copying PO to MO for {lang}...")
        import shutil
        shutil.copy2(po_path, mo_path)
        print(f"    ✅ Created {mo_path}")

# 5. ✅ التصحيح: إزالة domain لأنه غير مدعوم
i18n_core = GNUTextCore(
    path=LOCALES_PATH,  # المسار للمجلد
    default_locale="ar",  # اللغة الافتراضية
    # locale="ar",  # بعض الإصدارات تستخدم locale بدلاً من default_locale
)

# 6. إعداد الميدل وير
i18n_middleware = I18nMiddleware(
    core=i18n_core,
    default_locale="ar"
)
i18n_middleware.setup(dp)

print(f"✅ i18n configured with path: {LOCALES_PATH}")

print(f"✅ initialize master bot")