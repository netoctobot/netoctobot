# التشغيل بعد git clone

السكربتات مخصصة لديبيان وأوبونتو. لا تثبّت حزمًا ولا تعيد تثبيت أداة موجودة. إذا نقص شيء تتوقف وتطبع الأمر المقترح وموضع `sudo`.

```bash
git clone <repo-url>
cd octobot
bash setup/setup1.sh
bash setup/setup2.sh
bash setup/setup3.sh
bash setup/setup4.sh
bash setup/setup5.sh
bash setup/setup6.sh
```

شغّلها من مجلد `octobot`. كل سكربت يتوقف عند أول خطأ ويذكر اسم الخطوة.

## ماذا يثبت كل سكربت عند النجاح

- `setup1.sh`: التوزيعة ديبيان أو أوبونتو، والأدوات `bash` و`git` و`curl` و`docker` و`docker compose` الإصدار 2. إذا كان Docker مثبتًا بلا صلاحية، يطبع `sudo usermod -aG docker` ولا يعيد التثبيت.
- `setup2.sh`: وجود `backend/.env` وصحة مفاتيحه، ويطبع اسم مضيف `DATABASE_URL` فقط. إذا كان الملف غائبًا ولا يوجد حجم `postgres_data`، ينشئ الملف بصلاحية `600` من دون طباعة كلمة المرور أو مفتاح التشفير. إذا كان الحجم موجودًا والملف غائبًا، يتوقف ويطلب استعادة الملف. لا يستبدل ملفًا موجودًا.
- `setup3.sh`: بناء الصور، ثم تشغيل Postgres 16 وRedis 7 حتى تصبح healthcheck ناجحة. يقرأ `PG_VERSION` من الحجم الحالي بتركيب للقراءة فقط، ويرفض التشغيل إذا كان الإصدار الرئيسي غير 16.
- `setup4.sh`: `prisma migrate deploy` داخل شبكة Compose. لا ينفّذ reset ولا يمسح البيانات.
- `setup5.sh`: تشغيل backend وfrontend. عمال النشر وقوائم الدعم يعملون داخل عملية backend.
- `setup6.sh`: `GET /health`، و`pg_isready`، و`redis ping`، وحالة الحاويات، ثم يطبع نفق اللوحة وأوامر السجلات والإيقاف.

## قبل setup3

افتح `backend/.env` واكتب `BOT_TOKEN` و`OWNER_TELEGRAM_ID`. إذا أردت حساب اللوحة في أول تشغيل، اكتب `LOCAL_ADMIN_USERNAME` و`LOCAL_ADMIN_PASSWORD` معًا. لا تضع `NODE_ENV=production` قبل إنشاء هذا الحساب: في وضع الإنتاج يُتجاهل المتغيران، وكلمة مرور موجودة لا تُستبدل لاحقًا.

داخل Compose المضيف هو `postgres` و`redis`. عملية على الجهاز نفسه تستخدم `127.0.0.1`. المنافذ منشورة على `127.0.0.1` فقط.

## اللوحة والويب هوك

اللوحة تُفتح بنفق SSH ثم `http://127.0.0.1:3001`.

`WEBHOOK_REGISTRATION_ENABLED=false` هو الافتراضي، ويستخدم الاستطلاع ويحتاج خروجًا إلى `api.telegram.org`. تفعيل الويب هوك يحتاج `true` و`PUBLIC_BASE_URL` على HTTPS ومنفذًا عامًا.

الإيقاف الآمن هو `docker compose --env-file backend/.env stop`. لا تستخدم `docker compose down -v`. ترقية PostgreSQL إلى إصدار رئيسي آخر خطة منفصلة تحفظ البيانات، وليست جزءًا من هذه السكربتات.
