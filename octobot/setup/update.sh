#!/usr/bin/env bash
# Publish a fast-forward update of the running Docker Compose stack.
# Deploy branch, project directory, and git repository are printed at start.
# This script does not run git reset --hard, docker compose down -v, or prisma migrate reset.
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_DIR/lib.sh"

DEPLOY_BRANCH="main"
STATE_DIR="$ROOT/.update"
LOG="$STATE_DIR/update.log"
LOCK_FILE="$STATE_DIR/update.lock"
DEPLOYED_FILE="$STATE_DIR/deployed.state"
ROLLBACK_FILE="$STATE_DIR/rollback.txt"
BACKEND_REF="octobot-rollback/backend:previous"
FRONTEND_REF="octobot-rollback/frontend:previous"

db_touched=0
backup_file=""
backend_runtime_name=""
frontend_runtime_name=""
backend_rollback_id=""
frontend_rollback_id=""

redact() {
  sed -u -E \
    -e 's#(postgres(ql)?://[^:/[:space:]]+:)[^@[:space:]]+@#\1[redacted]@#g' \
    -e 's#((DATABASE_URL|REDIS_URL|BOT_TOKEN|OWNER_TELEGRAM_ID|ENCRYPTION_KEY|WEBHOOK_SECRET|POSTGRES_PASSWORD|LOCAL_ADMIN_PASSWORD|LOCAL_ADMIN_USERNAME|LAB_API_ID|LAB_API_HASH|LAB_BOT_TOKEN|LAB_SESSION_ENCRYPTION_KEY|LAB_DATABASE_URL)[[:space:]]*[:=][[:space:]]*")[^"]*"#\1[redacted]"#g' \
    -e 's#((DATABASE_URL|REDIS_URL|BOT_TOKEN|OWNER_TELEGRAM_ID|ENCRYPTION_KEY|WEBHOOK_SECRET|POSTGRES_PASSWORD|LOCAL_ADMIN_PASSWORD|LOCAL_ADMIN_USERNAME|LAB_API_ID|LAB_API_HASH|LAB_BOT_TOKEN|LAB_SESSION_ENCRYPTION_KEY|LAB_DATABASE_URL)[[:space:]]*[:=][[:space:]]*)[^[:space:]'\''"]+#\1[redacted]#g'
}

say() {
  printf '%s\n' "$*" | redact | tee -a "$LOG"
}

run() {
  local status
  set +e
  "$@" 2>&1 | redact | tee -a "$LOG"
  status=${PIPESTATUS[0]}
  set -e
  return "$status"
}

state_get() {
  local key="$1"
  local file="$2"
  local line=""
  if [[ -f "$file" ]]; then
    line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  fi
  printf '%s' "${line#*=}"
}

write_lines() {
  local file="$1"
  shift
  local tmp="${file}.tmp"
  local old_umask
  old_umask="$(umask)"
  mkdir -p "$(dirname "$file")"
  umask 077
  printf '%s\n' "$@" >"$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
  umask "$old_umask"
}

running_container_id() {
  local service="$1"
  local ids
  ids="$(compose ps -q "$service")"
  printf '%s' "${ids%%$'\n'*}"
}

running_image_id() {
  local service="$1"
  local cid
  cid="$(running_container_id "$service")"
  if [[ -z "$cid" ]]; then
    printf '%s' ""
    return 0
  fi
  docker inspect --format '{{.Image}}' "$cid"
}

running_matches_deployed() {
  local backend frontend
  backend="$(running_image_id backend)"
  frontend="$(running_image_id frontend)"
  [[ -n "$backend" && -n "$frontend" \
    && "$backend" == "$(state_get backend_image_id "$DEPLOYED_FILE")" \
    && "$frontend" == "$(state_get frontend_image_id "$DEPLOYED_FILE")" ]]
}

print_recovery() {
  say "استعادة التطبيق من الصور السابقة لا تعكس migrations التي طبّقها prisma migrate deploy."
  say "لا تشغّل git reset --hard ولا docker compose down -v ولا prisma migrate reset."
  say "ملف البيئة backend/.env ومفاتيح التشفير وحجما postgres_data و redis_data و broadcast_media لم يُستبدلا بهذا السكربت."
  if [[ -n "$backup_file" ]]; then
    say "النسخة الاحتياطية لهذه المحاولة: ${backup_file}"
  else
    say "لا توجد نسخة احتياطية مكتوبة في هذه المحاولة."
  fi
  say "وسم الصورة السابقة للخلفية: ${BACKEND_REF}"
  say "وسم الصورة السابقة للواجهة: ${FRONTEND_REF}"
  say "تفاصيل الوسم واسم الصورة التي يشغّلها Compose: ${ROLLBACK_FILE}"
  say "إذا كان المخطط الجديد ما زال متوافقًا مع التطبيق السابق، أعد وسم الصور ثم أعد إنشاء الحاويتين من دون بناء:"
  say "  docker tag ${BACKEND_REF} ${backend_runtime_name:-<backend_runtime_name>}"
  say "  docker tag ${FRONTEND_REF} ${frontend_runtime_name:-<frontend_runtime_name>}"
  say "  docker compose --env-file backend/.env -f ${ROOT}/docker-compose.yml up -d --no-build backend frontend"
  say "إذا كان المخطط الجديد غير متوافق مع التطبيق السابق، أوقف backend و frontend أولًا ثم استعد النسخة إلى قاعدة Postgres الحالية. هذا يستبدل كائنات القاعدة بمحتوى النسخة وتضيع الكتابة التي حدثت بعدها:"
  say "  docker compose --env-file backend/.env -f ${ROOT}/docker-compose.yml stop backend frontend"
  say "  docker compose --env-file backend/.env -f ${ROOT}/docker-compose.yml exec -T postgres sh -c 'pg_restore -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --clean --if-exists --no-owner --exit-on-error' < ${backup_file:-<backup-file>}"
  say "ثم أعد وسم الصور السابقة وأعد إنشاء backend و frontend كما في الأعلى، وتحقق من http://127.0.0.1:3000/health"
  say "خطوات التعافي مكتوبة أيضًا في setup/README.md."
}

fail() {
  say "$1"
  if ((db_touched == 1)); then
    print_recovery
  fi
  exit 1
}

keep_rollback_tag() {
  local service="$1"
  local ref="$2"
  local cid="" image="" runtime="" deployed_id="" tagged=""
  cid="$(running_container_id "$service")"
  if [[ -n "$cid" ]]; then
    image="$(docker inspect --format '{{.Image}}' "$cid")"
    runtime="$(docker inspect --format '{{.Config.Image}}' "$cid")"
  fi
  deployed_id="$(state_get "${service}_image_id" "$DEPLOYED_FILE")"
  if docker image inspect "$ref" >/dev/null 2>&1; then
    if [[ -n "$deployed_id" && -n "$image" && "$image" == "$deployed_id" ]]; then
      if ! docker tag "$image" "$ref"; then
        fail "تعذر تحديث وسم ${ref}. لم يبدأ البناء ولم تُستبدل الحاويات."
      fi
      say "حُدّث وسم ${ref} من الحاوية السليمة الحالية."
    else
      say "أُبقي وسم ${ref} حتى لا تُستبدل صورة الإصدار السابق بحاوية نشر لم يكتمل."
    fi
  elif [[ -n "$image" ]]; then
    if ! docker tag "$image" "$ref"; then
      fail "تعذر حفظ وسم ${ref}. لم يبدأ البناء ولم تُستبدل الحاويات."
    fi
    say "حُفظت صورة ${service} الحالية بالوسم ${ref}."
  else
    say "لا توجد حاوية ${service} قيد التشغيل، ولا وسم سابق لها."
  fi
  if docker image inspect "$ref" >/dev/null 2>&1; then
    tagged="$(docker image inspect --format '{{.Id}}' "$ref")"
  fi
  if [[ "$service" == "backend" ]]; then
    backend_runtime_name="$runtime"
    backend_rollback_id="$tagged"
  else
    frontend_runtime_name="$runtime"
    frontend_rollback_id="$tagged"
  fi
}

write_rollback() {
  local previous_sha="$1"
  local target_sha="$2"
  write_lines "$ROLLBACK_FILE" \
    "previous_sha=${previous_sha}" \
    "target_sha=${target_sha}" \
    "backend_ref=${BACKEND_REF}" \
    "frontend_ref=${FRONTEND_REF}" \
    "backend_runtime_name=${backend_runtime_name}" \
    "frontend_runtime_name=${frontend_runtime_name}" \
    "backend_image_id=${backend_rollback_id}" \
    "frontend_image_id=${frontend_rollback_id}" \
    "backup_file=${backup_file}"
}

postgres_is_running() {
  local cid state
  cid="$(running_container_id postgres)"
  if [[ -z "$cid" ]]; then
    return 1
  fi
  state="$(docker inspect --format '{{.State.Running}}' "$cid" 2>/dev/null || true)"
  [[ "$state" == "true" ]]
}

ensure_data_services() {
  local volume redis_volume broadcast_volume
  volume="$(postgres_volume_name || true)"
  redis_volume="$(compose_volume_name redis_data || true)"
  broadcast_volume="$(compose_volume_name broadcast_media || true)"
  if [[ -z "$volume" ]] || ! docker volume inspect "$volume" >/dev/null 2>&1; then
    fail "حجم بيانات PostgreSQL غير موجود. لم يُنشأ حجم جديد ولم تُطبَّق migrations."
  fi
  if [[ -z "$redis_volume" ]] || ! docker volume inspect "$redis_volume" >/dev/null 2>&1; then
    fail "حجم بيانات Redis غير موجود. لم يُنشأ حجم جديد."
  fi
  if [[ -z "$broadcast_volume" ]]; then
    fail "تعذر قراءة اسم حجم broadcast_media من docker-compose.yml."
  fi
  if ! docker volume inspect "$broadcast_volume" >/dev/null 2>&1; then
    say "حجم broadcast_media غير موجود. سيُنشأ الآن ولن يُحذف بتحديثات لاحقة (لا تستخدم down -v)."
    if ! docker volume create "$broadcast_volume" >/dev/null 2>&1; then
      fail "تعذر إنشاء حجم broadcast_media."
    fi
  fi
  if [[ "$(service_health postgres)" == "healthy" && "$(service_health redis)" == "healthy" ]]; then
    say "Postgres و Redis جاهزان. لم تُسحب صور جديدة ولم تُحذف أحجام البيانات."
    return 0
  fi
  say "Postgres أو Redis ليسا جاهزين. سيُعاد تشغيلهما من الصور المحلية فقط."
  if ! postgres_is_running; then
    require_postgres_16 "update"
  fi
  if ! run compose up -d postgres redis; then
    fail "تعذر تشغيل Postgres أو Redis. لم تُطبَّق migrations ولم تُستبدل خدمات التطبيق."
  fi
  if ! wait_healthy 120 postgres redis; then
    fail "Postgres أو Redis لم يصبحا جاهزين خلال المهلة. لم تُطبَّق migrations."
  fi
  say "Postgres و Redis جاهزان."
}

backup_postgres() {
  local short dest magic
  short="$(git -C "$ROOT" rev-parse --short HEAD)"
  dest="$STATE_DIR/backups/postgres-$(date -u +%Y%m%dT%H%M%SZ)-${short}.dump"
  local old_umask
  old_umask="$(umask)"
  mkdir -p "$STATE_DIR/backups"
  chmod 700 "$STATE_DIR" "$STATE_DIR/backups"
  say "أخذ نسخة احتياطية من PostgreSQL قبل migrations."
  say "مسار النسخة: ${dest}"
  umask 077
  if ! compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-password' >"$dest"; then
    umask "$old_umask"
    rm -f "$dest"
    fail "فشل النسخ الاحتياطي. لم تُطبَّق migrations ولم تُستبدل خدمات التطبيق."
  fi
  umask "$old_umask"
  if [[ ! -s "$dest" ]]; then
    rm -f "$dest"
    fail "ملف النسخة الاحتياطية فارغ. لم تُطبَّق migrations."
  fi
  magic="$(head -c 5 "$dest" || true)"
  if [[ "$magic" != "PGDMP" ]]; then
    rm -f "$dest"
    fail "النسخة الاحتياطية ليست تفريغ PostgreSQL بصيغة custom. لم تُطبَّق migrations."
  fi
  chmod 600 "$dest"
  backup_file="$dest"
  say "اكتملت النسخة الاحتياطية."
}

wait_app() {
  local deadline=$((SECONDS + 180))
  local fid state
  while ((SECONDS < deadline)); do
    if curl --fail --silent --output /dev/null --max-time 5 http://127.0.0.1:3000/health; then
      fid="$(running_container_id frontend)"
      state=""
      if [[ -n "$fid" ]]; then
        state="$(docker inspect --format '{{.State.Status}}' "$fid" 2>/dev/null || true)"
      fi
      if [[ "$state" == "running" ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

record_deployed() {
  local sha backend frontend
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  backend="$(running_image_id backend)"
  frontend="$(running_image_id frontend)"
  if [[ -z "$backend" || -z "$frontend" ]]; then
    fail "تعذر قراءة صور الحاويات بعد النشر. لم يُسجَّل النشر كنجاح."
  fi
  write_lines "$DEPLOYED_FILE" \
    "sha=${sha}" \
    "backend_image_id=${backend}" \
    "frontend_image_id=${frontend}"
}

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
touch "$LOG"
chmod 600 "$LOG"

if ! command -v flock >/dev/null 2>&1; then
  echo "الأمر flock غير موجود. ثبّته ثم أعد التشغيل: sudo apt-get install -y util-linux" >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "تحديث آخر قيد التشغيل. توقف هذا التشغيل ولم يغيّر شيئًا." >&2
  exit 1
fi

cd "$ROOT"
say "مجلد المشروع: ${ROOT}"
say "ملف التشغيل: ${ROOT}/docker-compose.yml"
say "فرع التشغيل المعتمد: ${DEPLOY_BRANCH}"
say "ملف البيئة المحفوظ: ${ENV_FILE}"
say "سجل التحديث: ${LOG}"

if ! run bash "$SETUP_DIR/setup1.sh"; then
  fail "فشل فحص النظام في setup1.sh. لم يُجلب شيء ولم تُعد تشغيل الخدمات."
fi

if [[ ! -f "$ENV_FILE" ]]; then
  fail "ملف backend/.env غير موجود. التحديث لا ينشئ ملف بيئة ولا مفاتيح تشفير جديدة. استعد الملف ثم أعد التشغيل."
fi
if ! run bash "$SETUP_DIR/setup2.sh"; then
  fail "فحص backend/.env فشل. الملف لم يُستبدل ولم تُعد تشغيل الخدمات."
fi

repo_root="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  fail "مجلد المشروع ليس داخل مستودع Git."
fi
say "مستودع Git: ${repo_root}"

if ! git -C "$ROOT" remote get-url origin >/dev/null 2>&1; then
  fail "الريموت origin غير موجود. لم يُجلب شيء."
fi

current_branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$DEPLOY_BRANCH" ]]; then
  fail "هذا المجلد على الفرع ${current_branch}. التشغيل المعتمد هو ${DEPLOY_BRANCH} فقط. لم يُغيّر شيء."
fi

dirty="$(git -C "$ROOT" status --porcelain)"
if [[ -n "$dirty" ]]; then
  say "توجد تعديلات محلية. لم تُمسح ولم يُكتب فوقها، وتوقف التحديث قبل الجلب."
  printf '%s\n' "$dirty" | redact | tee -a "$LOG"
  exit 1
fi

before="$(git -C "$ROOT" rev-parse HEAD)"
say "HEAD قبل الجلب: ${before}"
if ! run git -C "$ROOT" -c pull.rebase=false pull --ff-only origin "$DEPLOY_BRANCH"; then
  fail "فشل git pull --ff-only. الفرع تفرع أو فيه تعارض، أو تعذر الوصول إلى origin. لم يُستخدم reset ولم تُمسح الملفات المحلية."
fi

after="$(git -C "$ROOT" rev-parse HEAD)"
deployed="$(state_get sha "$DEPLOYED_FILE")"
if [[ "$after" == "$before" && -n "$deployed" && "$deployed" == "$after" ]]; then
  say "لا يوجد إصدار جديد على ${DEPLOY_BRANCH} (${after}). لم تُعد تشغيل الخدمات."
  if ! running_matches_deployed; then
    say "الحاويات الحالية لا تطابق آخر نشر ناجح مسجّل. لم يُفرض الرجوع ولا إعادة النشر."
    say "إذا كان اختلاف الصور رجوعًا يدويًا، فاتركه. الرجوع إلى الصور لا يعكس migrations."
  fi
  exit 0
fi
if [[ "$after" == "$before" && -z "$deployed" ]]; then
  say "لا يوجد التزام جديد على ${DEPLOY_BRANCH}. لا يوجد سجل نشر سابق، لذلك سيُنشر HEAD الحالي ${after} مرة واحدة لإنشاء مرجع الإصدار."
elif [[ "$after" == "$before" ]]; then
  say "لا توجد التزامات جديدة، لكن آخر نشر ناجح ${deployed} يختلف عن HEAD ${after}. سيُستكمل النشر."
else
  say "وصل إصدار جديد: ${before} -> ${after}"
fi

keep_rollback_tag backend "$BACKEND_REF"
keep_rollback_tag frontend "$FRONTEND_REF"
write_rollback "$before" "$after"

say "بناء صور الإصدار الجديد قبل استبدال الحاويات."
if ! run compose build; then
  fail "فشل بناء الصور. الحاويات الحالية ما زالت تعمل ولم تُستبدل."
fi

ensure_data_services
backup_postgres
write_rollback "$before" "$after"

db_touched=1
say "تطبيق migrations التطبيق فقط من الإصدار الجديد عبر setup4.sh. مهاجرات المختبر لا تُطبَّق هنا."
if ! run bash "$SETUP_DIR/setup4.sh"; then
  fail "فشل prisma migrate deploy. قد تكون بعض migrations قد طُبقت. خدمات التطبيق لم تُستبدل إذا توقف الأمر قبل setup5.sh."
fi

say "استبدال backend و frontend عبر setup5.sh. Postgres و Redis يبقيان على أحجامهما."
if ! run bash "$SETUP_DIR/setup5.sh"; then
  fail "فشل تشغيل backend أو frontend بعد تطبيق migrations."
fi

say "انتظار /health على http://127.0.0.1:3000/health لمدة تصل إلى 180 ثانية."
if ! wait_app; then
  fail "الخدمة لم تصبح جاهزة خلال المهلة بعد تغيير القاعدة."
fi
if ! run bash "$SETUP_DIR/setup6.sh"; then
  fail "فحص setup6.sh فشل بعد تشغيل الإصدار الجديد."
fi

record_deployed
say "اكتمل التحديث."
say "الإصدار المنشور: $(git -C "$ROOT" rev-parse HEAD)"
say "وصف الإصدار: $(git -C "$ROOT" log -1 --format=%s)"
say "النسخة الاحتياطية: ${backup_file}"
say "صور الإصدار السابق: ${BACKEND_REF} و ${FRONTEND_REF}"
say "الرجوع إلى هذه الصور لا يعكس migrations. إذا فشل التطبيق مع المخطط الجديد فاتبع التعافي في setup/README.md."
if ! run compose ps; then
  say "تعذر عرض حالة الحاويات. الفحص الصحي نجح والإصدار المنشور سُجّل."
fi
