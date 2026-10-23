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
- `setup4.sh`: `prisma migrate deploy` لمخطط التطبيق فقط داخل شبكة Compose. لا ينفّذ reset ولا يمسح البيانات، ولا يطبّق مهاجرات المختبر في `backend/prisma-lab`.
- `setup5.sh`: تشغيل backend وfrontend. عمال النشر وقوائم الدعم يعملون داخل عملية backend.
- `setup6.sh`: `GET /health`، و`pg_isready`، و`redis ping`، وحالة الحاويات، ثم يطبع نفق اللوحة وأوامر السجلات والإيقاف.

## قبل setup3

افتح `backend/.env` واكتب `BOT_TOKEN` و`OWNER_TELEGRAM_ID`. إذا أردت حساب اللوحة في أول تشغيل، اكتب `LOCAL_ADMIN_USERNAME` و`LOCAL_ADMIN_PASSWORD` معًا. لا تضع `NODE_ENV=production` قبل إنشاء هذا الحساب: في وضع الإنتاج يُتجاهل المتغيران، وكلمة مرور موجودة لا تُستبدل لاحقًا.

داخل Compose المضيف هو `postgres` و`redis`. عملية على الجهاز نفسه تستخدم `127.0.0.1`. المنافذ منشورة على `127.0.0.1` فقط.

## اللوحة والويب هوك

اللوحة تُفتح بنفق SSH ثم `http://127.0.0.1:3001`.

`WEBHOOK_REGISTRATION_ENABLED=false` هو الافتراضي، ويستخدم الاستطلاع ويحتاج خروجًا إلى `api.telegram.org`. تفعيل الويب هوك يحتاج `true` و`PUBLIC_BASE_URL` على HTTPS ومنفذًا عامًا.

الإيقاف الآمن هو `docker compose --env-file backend/.env stop`. لا تستخدم `docker compose down -v` (يحذف `postgres_data` و`redis_data` و`broadcast_media`). ترقية PostgreSQL إلى إصدار رئيسي آخر خطة منفصلة تحفظ البيانات، وليست جزءًا من هذه السكربتات. `setup/update.sh` يتحقق من أحجام البيانات الثلاثة وينشئ `broadcast_media` عند الترقية إن لم يكن موجودًا.

## التحديث بعد دفع التعديلات

من مجلد `octobot` على السيرفر، بعد دفع التعديلات إلى GitHub:

```bash
bash setup/update.sh
```

فرع التشغيل المعتمد هو `main`. السكربت يرفض أي فرع غيره، ويرفض التعديلات المحلية من دون مسحها، ثم يجلب بـ `git pull --ff-only`. إذا تفرع الفرع أو ظهر تعارض يتوقف. لا يشغّل `git reset --hard` ولا `docker compose down -v` ولا `prisma migrate reset`.

لا تشغّل تحديثين معًا. القفل يوقف التشغيل الثاني فورًا.

إذا لم يوجد التزام جديد، وكان سجل نشر سابق مطابقًا لـ HEAD، يخرج السكربت ولا يعيد تشغيل الخدمات. أول تشغيل بلا سجل نشر سابق ينشر HEAD الحالي مرة واحدة حتى لو كان الجلب بلا التزامات جديدة، لكي يُحفظ مرجع الإصدار الذي يعمل فعلًا.

ترتيب النشر:

1. بناء صور backend و frontend. إذا فشل البناء تبقى الحاويات الحالية تعمل.
2. التأكد من حجمَي PostgreSQL و Redis من دون سحب صورة جديدة ومن دون حذف البيانات.
3. نسخة احتياطية بصيغة `pg_dump -Fc` داخل `.update/backups/`. إذا فشلت يتوقف قبل migrations.
4. `setup4.sh` أي `prisma migrate deploy` لمهاجرات التطبيق فقط.
5. `setup5.sh` لإعادة إنشاء backend و frontend فقط.
6. انتظار `/health` ثم `setup6.sh`.

بناء الصور يحدث والخدمة ما زالت تعمل. الانقطاع يبدأ عند إعادة إنشاء backend و frontend، ويستمر حتى ينجح `/health`. المدة المتوقعة لهذا الانقطاع غالبًا بين نصف دقيقة وبضع دقائق، وتطول إذا كان `prisma migrate deploy` ثقيلًا أو تأخر إقلاع البوت. أثناء migration غير المتوافقة قد يضطرب التطبيق القديم قبل لحظة الاستبدال. هذا ليس تحديثًا بلا انقطاع.

يُحفظ مرجع صور الإصدار السابق بالوسمين `octobot-rollback/backend:previous` و `octobot-rollback/frontend:previous`، ومعه المسارات في `.update/rollback.txt`. السجل في `.update/update.log`. هذه المسارات مستثناة من Git. السكربت لا يطبع كلمات المرور ولا مفاتيح التشفير، ولا يستبدل `backend/.env`.

الرجوع إلى صور التطبيق لا يعكس migrations. `prisma migrate deploy` لا يُلغى تلقائيًا عند تشغيل الصورة السابقة.

## مختبر CPM

تحديث التطبيق لا يطبّق مهاجرات المختبر. جداول المختبر في `backend/prisma-lab`. `lab:generate` و`lab:migrate` يقرآن `backend/.env` من مسار حزمة backend، لا من مجلد العمل الحالي. القيمة الموجودة في البيئة تغلب الملف ولو كانت فارغة، ثم تُمرَّر القيمتان المدموجتان صراحة إلى Prisma مع مسار مطلق لمخطط المختبر. الملف لا يُعدَّل ولا يُطبع.

`LAB_DATABASE_URL` إلزامي ولا يُنسخ من `DATABASE_URL`. `lab:migrate` يرفض التشغيل إذا غابت `DATABASE_URL` أو كانت فارغة أو غير قابلة للتحليل، ولا يبدأ Prisma قبل نجاح المقارنة. `lab:generate` يعمل من دون `DATABASE_URL`، ويطبّق المقارنة إذا كانت موجودة. المقارنة تشمل المضيف والمنفذ واسم القاعدة بعد التطبيع، وترفض قاعدة التطبيق نفسها ولو اختلف المستخدم أو كلمة المرور أو query أو schema. الفحص المحلي لا يكشف أسماء المضيف المختلفة التي قد تشير إلى السيرفر نفسه. لا يُشغَّل `lab:migrate` ضمن `setup4.sh` أو `update.sh`.

### إذا فشل التحديث بعد تغيير القاعدة

لا تحذف الأحجام ولا تعِد ضبط migrations. اختر واحدًا من المسارين:

- المخطط الجديد ما زال يعمل مع التطبيق السابق: أعد وسم الصور السابقة فقط، ثم شغّل الحاويات من دون بناء:

```bash
cd octobot
docker tag octobot-rollback/backend:previous octobot-backend
docker tag octobot-rollback/frontend:previous octobot-frontend
docker compose --env-file backend/.env up -d --no-build backend frontend
```

أسماء الصور الفعلية محفوظة في `.update/rollback.txt` تحت `backend_runtime_name` و `frontend_runtime_name`. إذا اختلفت عن `octobot-backend` و `octobot-frontend` فاستخدم الأسماء المحفوظة.

- المخطط الجديد لا يعمل مع التطبيق السابق: أوقف الكتابة، استعد النسخة الاحتياطية إلى قاعدة Postgres الحالية، ثم أعد الصور السابقة. الاستعادة تستبدل كائنات القاعدة بما كان قبل هذه المحاولة، وتضيع الكتابة التي حصلت بعد النسخة:

```bash
cd octobot
docker compose --env-file backend/.env stop backend frontend
docker compose --env-file backend/.env exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' \
  < .update/backups/<backup-file>
docker tag octobot-rollback/backend:previous octobot-backend
docker tag octobot-rollback/frontend:previous octobot-frontend
docker compose --env-file backend/.env up -d --no-build backend frontend
curl --fail --silent --show-error http://127.0.0.1:3000/health
```

اسم ملف النسخة مكتوب في `.update/rollback.txt`. Postgres نفسه يبقى يعمل لأن الاستعادة تتم داخل الحاوية الحالية وعلى الحجم نفسه.
