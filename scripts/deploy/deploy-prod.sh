#!/usr/bin/env bash
#
# 正式站部署。從 bare repo 取出指定 commit 到工作樹，重建容器，套 migration，
# 最後做健康檢查。被兩個地方呼叫，兩者共用同一支腳本、同一把鎖：
#   - ~/dochuki.git/hooks/post-receive（有人 git push prod main 時立刻部署）
#   - dochuki-sync.service（定時輪詢 GitHub，發現 main 有變動時部署）
#
# 手動執行：~/deploy/deploy-prod.sh
set -euo pipefail

BARE="${DOCHUKI_BARE:-$HOME/dochuki.git}"
WORKTREE="${DOCHUKI_PROD:-$HOME/dochuki-prod}"
DEV_ENV="${DOCHUKI_DEV_ENV:-$HOME/dochuki/.env}"
LOGDIR="${DOCHUKI_LOGDIR:-$HOME/deploy}"
LOG="$LOGDIR/deploy.log"
LOCK="$LOGDIR/deploy.lock"
PROJECT="dochuki-prod"
PORT="${PROD_APP_PORT:-3100}"

mkdir -p "$LOGDIR" "$WORKTREE"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

# 兩個觸發來源可能同時發動（剛好 push 又剛好輪詢到），用 flock 串起來。
# 拿不到鎖就直接退出，不排隊——後來者要做的事跟正在跑的那次一樣。
exec 9>"$LOCK"
if ! flock -n 9; then
  log "另一個部署正在進行中，這次跳過"
  exit 0
fi

TARGET="$(git --git-dir="$BARE" rev-parse main)"
log "=== 開始部署 ${TARGET:0:7} ==="

# --- 1. 取出程式碼 ---------------------------------------------------------
# 工作樹刻意不是 clone，沒有自己的 .git，唯一的權威是 bare repo。
# checkout -f 會蓋掉被改動的追蹤檔案，但不會刪未追蹤檔案，所以 .env 安全。
git --git-dir="$BARE" --work-tree="$WORKTREE" checkout -f main
log "已取出 $(git --git-dir="$BARE" log -1 --format='%h %s' main)"

cd "$WORKTREE"

# --- 2. 環境變數 -----------------------------------------------------------
# .env 沒進版控（.gitignore），第一次部署時從開發那份撈出需要的 key。
# app 的 DATABASE_URL 是 docker-compose.yml 寫死指向 compose 內網的 db:5432，
# 不吃 .env，所以這裡只需要 GEMINI_API_KEY / FX_API_BASE。
if [ ! -f .env ]; then
  log ".env 不存在，從 $DEV_ENV 取出必要的 key"
  {
    echo "# 由 scripts/deploy/deploy-prod.sh 首次部署時自動產生"
    echo "PROD_APP_PORT=$PORT"
    grep -E '^(GEMINI_API_KEY|FX_API_BASE)=' "$DEV_ENV" || true
  } > .env
  chmod 600 .env
fi
grep -q '^PROD_APP_PORT=' .env || echo "PROD_APP_PORT=$PORT" >> .env

COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.prod.yml)

# --- 3. 建置並啟動 ---------------------------------------------------------
log "docker compose up -d --build（首次會久一點，要建 Next.js 與 PaddleOCR 兩個映像）"
"${COMPOSE[@]}" up -d --build 2>&1 | tee -a "$LOG"

# --- 4. Migration ----------------------------------------------------------
# 容器本身刻意不自動 migrate（見 README 部署章節），由部署流程負責。
# migrate deploy 只套用既有 migration、不會產生新的，重複執行是安全的。
log "套用 migration"
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T app prisma migrate deploy 2>&1 | tee -a "$LOG"; then
    break
  fi
  if [ "$i" = 30 ]; then
    log "!! migration 連續失敗，部署中止"
    exit 1
  fi
  log "migration 還沒成功（第 $i 次），app 或 db 可能還在起，5 秒後重試"
  sleep 5
done

# --- 5. 健康檢查 -----------------------------------------------------------
for i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/trips" || true)"
  if [ "$CODE" = "200" ]; then
    log "健康檢查通過（/trips 回 200）"
    echo "$TARGET" > "$LOGDIR/deployed.sha"
    log "=== 部署完成 ${TARGET:0:7} ==="
    exit 0
  fi
  sleep 5
done

log "!! 健康檢查失敗（最後一次 http_code=$CODE），容器可能起來了但服務不正常"
log "   查看紀錄：docker compose -p $PROJECT logs --tail=100 app"
exit 1
