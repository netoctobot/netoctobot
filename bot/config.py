import os
from dotenv import load_dotenv

# تحميل المتغيرات من ملف .env إذا كان موجوداً
load_dotenv()

# توكن بوت الدعم (المسؤول عن النظام)
BOT_TOKEN = os.getenv("BOT_TOKEN", "8160051076:AAGFJX3lENSWR7GdGNJvu_TzilII_trBtSQ")

# إعدادات إضافية للمستقبل
ADMIN_IDS = [6459379370, 6788475988]  # ضع معرف التيليجرام الخاص بك هنا كمشرف للنظام