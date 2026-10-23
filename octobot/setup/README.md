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

## مختبر CPM

تحديث التطبيق لا يطبّق مهاجرات المختبر. جداول المختبر في `backend/prisma-lab`. `lab:generate` و`lab:migrate` يقرآن `backend/.env` من مسار حزمة backend، لا من مجلد العمل الحالي. القيمة الموجودة في البيئة تغلب الملف ولو كانت فارغة، ثم تُمرَّر القيمتان المدموجتان صراحة إلى Prisma مع مسار مطلق لمخطط المختبر. الملف لا يُعدَّل ولا يُطبع.

`LAB_DATABASE_URL` إلزامي ولا يُنسخ من `DATABASE_URL`. `lab:migrate` يرفض التشغيل إذا غابت `DATABASE_URL` أو كانت فارغة أو غير قابلة للتحليل، ولا يبدأ Prisma قبل نجاح المقارنة. `lab:generate` يعمل من دون `DATABASE_URL`، ويطبّق المقارنة إذا كانت موجودة. المقارنة تشمل المضيف والمنفذ واسم القاعدة بعد التطبيع، وترفض قاعدة التطبيق نفسها ولو اختلف المستخدم أو كلمة المرور أو query أو schema. الفحص المحلي لا يكشف أسماء المضيف المختلفة التي قد تشير إلى السيرفر نفسه. لا يُشغَّل `lab:migrate` ضمن `setup4.sh` أو `update.sh`.

### تشغيل المختبر على السيرفر (A2)

كل أوامر المختبر عبر `setup/lab.sh`. الأوامر لا تطبع القيم السرية ولا روابط الاتصال. `update.sh` لا يبني صورة `cpm-lab` ولا يلمس `lab-postgres`، ونسخة `pg_dump` في التحديث تشمل قاعدة التطبيق فقط.

الملفات:

- `backend/.env.lab`: أسرار المختبر وإعداداته. انسخه من `backend/.env.lab.example`، واملأه في محرّر على السيرفر، ثم `chmod 600 backend/.env.lab`. الملف مستثنى من Git ومن سياق بناء Docker. لا تُرسل قيمه في المحادثة.
- Compose يمرر لكل خدمة مفاتيحها فقط عبر `environment:` صريح. `lab-postgres` يتلقى `POSTGRES_USER` و`POSTGRES_PASSWORD` و`POSTGRES_DB` فقط، بلا أسرار Telegram ولا مفتاح الجلسة. `cpm-lab` يتلقى مفاتيح `LAB_*` و`DATABASE_URL` بلا بيانات دخول. `backend` لا يتلقى أي `LAB_*`، و`lab.sh` يرفض العمل إذا وُجد `LAB_*` في `backend/.env`.
- `LAB_SESSION_ENCRYPTION_KEY` يجب أن يختلف عن `ENCRYPTION_KEY`. `lab.sh` يقارنهما على السيرفر بلا طباعة، لأن حاوية المختبر لا تتلقى مفتاح التطبيق.

الترتيب:

```bash
cd octobot
setup/lab.sh build        # backend/Dockerfile.lab يولّد عميل المختبر ويبني dist
setup/lab.sh db-up        # lab-postgres بحجم lab_postgres_data، بلا منفذ منشور
setup/lab.sh migrate      # مهاجرات backend/prisma-lab على LAB_DATABASE_URL فقط
setup/lab.sh test-db      # قاعدة اختبار مستقلة + schema مؤقت يُحذف وحده
setup/lab.sh login-bot    # جلسة البوت مشفّرة، ثم يمكن حذف LAB_BOT_TOKEN من الملف
setup/lab.sh login-user   # في طرفية تفاعلية: الهاتف، ثم الرمز وكلمة 2FA بإدخال مخفي
setup/lab.sh preflight    # حل القناة وقراءة واحدة لكل قارئ، تشغيل PREFLIGHT
setup/lab.sh run --confirm-live
setup/lab.sh logs
setup/lab.sh report > cpm-lab-report.json
```

`test-db` ينشئ قاعدة `LAB_TEST_DATABASE_URL` على `lab-postgres` إن لم توجد، ثم يطبّق مهاجرات المختبر داخل schema مؤقت `cpm_lab_test_<hex>`، ويفحص القيود والقفل، ثم يحذف ذلك الـ schema وحده. قاعدة الاختبار يجب أن تختلف عن `LAB_DATABASE_URL` و`DATABASE_URL`. للتطوير المحلي: `LAB_TEST_DATABASE_URL=... pnpm --filter backend exec tsx --test src/cpm-lab/lab-postgres.test.ts`.

القفل: `login-bot` و`login-user` و`preflight` و`run` و`clear-stop` تأخذ قفل PostgreSQL الاستشاري على `LAB_DATABASE_URL` قبل أي اتصال بـ Telegram، وتحتفظ به حتى تنتهي. لذلك لا يعمل `--replace` أثناء استخدام الجلسة في تجربة. القفل يمنع عاملين على قاعدة المختبر نفسها فقط، ولا يمنع استخدام الجلسة من مكان آخر.

السياسة الثابتة: طلب واحد في الوقت نفسه، و3 ثوانٍ على الأقل بين أي طلبين، وسقف 200 طلب للتشغيل الواحد. `TIMEOUT` و`NETWORK` و`INTERNAL` تُعاد مرة واحدة بعد 30 ثانية كطلب جديد مرتبط بالأصل. `FLOOD_WAIT` لا يُعاد: يُحفظ الحدث و`nextAllowedAt` في القاعدة. انتظار أطول من 3600 ثانية، أو ثالث انتظار خلال آخر 24 ساعة لنفس القارئ، يوقف القارئ. الجولة التي فات وقتها تُتخطى وتُسجَّل، بلا تراكم. أي مفتاح طلب موجود، بأي حالة، لا يُرسل مرة أخرى.

الإيقاف وإعادة التشغيل:

- `setup/lab.sh stop` يرسل `SIGTERM` ويمهل 60 ثانية. العامل لا يبدأ طلباً جديداً، ويكمل الطلب الجاري حتى مهلته، ثم يغلق Telegram وPrisma ثم اتصال القفل.
- كل `run` أو `preflight` جديد ينشئ `runId` جديداً. بعد أخذ القفل تتحول صفوف `STARTED` القديمة إلى `ABANDONED`، لأنها ربما وصلت إلى Telegram. حدود الانتظار والإيقاف المحفوظة تبقى سارية.
- القارئ الموقوف لا تُفتح جلسته. بعد المراجعة: `setup/lab.sh clear-stop --reader bot` أو `--reader user`. هذا لا يمسح `nextAllowedAt`.
- للإيقاف الطارئ للحساب: أنهِ جلسة المختبر من Telegram في الإعدادات ثم الأجهزة.

حدث المشاهدة اليدوي اختياري: افتح المنشور من أي حساب آخر تملكه، ثم سجّل الوقت بـ `setup/lab.sh mark-view --at 2026-10-24T09:30:00+03:00`. لا حاجة لحساب ثالث جديد. بلا هذا الحدث يقول التقرير إن تجدد العداد بقي غير محسوم.

التقرير يفصل قراءات التجربة الأساسية (12 جولة × قارئين = 24) عن preflight، وإعادات المحاولة، وحل القناة، وحركة المكتبة. حركة المكتبة تُعدّ عند `invoke`، أما ping حلقة التحديثات وإعداد الاتصال فيوصفان بأنهما غير مقيسين بالكامل. `commercialCpmEnabled` يبقى `false`.
