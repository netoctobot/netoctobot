import os
from dotenv import load_dotenv

# تحميل المتغيرات من ملف .env إذا كان موجوداً
load_dotenv()

# توكن بوت الدعم (المسؤول عن النظام)
BOT_TOKEN = os.getenv("BOT_TOKEN", "ضع_هنا_توكن_بوتك_مؤقتاً")

# إعدادات إضافية للمستقبل
ADMIN_IDS = [12345678, ]  # ضع معرف التيليجرام الخاص بك هنا كمشرف للنظام