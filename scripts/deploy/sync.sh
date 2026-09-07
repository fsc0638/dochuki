#!/usr/bin/env bash
#
# 定時把 GitHub 上的 main 同步到這台 VM。由 dochuki-sync.timer 每 2 分鐘叫一次。
#
# 做兩件事，兩件都刻意設計成不會弄丟任何人的工作：
#   1. 正式站：把 github/main 快轉進 bare repo，有前進才觸發部署
#   2. 開發樹 ~/dochuki：只有在「乾淨」且「能快轉」時才動它
#
# 手動執行：~/deploy/sync.sh
set -euo pipefail

BARE="${DOCHUKI_BARE:-$HOME/dochuki.git}"
DEV="${DOCHUKI_DEV:-$HOME/dochuki}"
LOGDIR="${DOCHUKI_LOGDIR:-$HOME/deploy}"
LOG="$LOGDIR/sync.log"

mkdir -p "$LOGDIR"
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

# --- 1. 正式站 -------------------------------------------------------------
git --git-dir="$BARE" fetch --quiet github '+refs/heads/main:refs/remotes/github/main'

LOCAL="$(git --git-dir="$BARE" rev-parse main 2>/dev/null || echo none)"
REMOTE="$(git --git-dir="$BARE" rev-parse refs/remotes/github/main)"

if [ "$LOCAL" = "$REMOTE" ]; then
  : # 沒有變動，安靜結束——這是絕大多數次的結果，不寫 log 免得洗版
elif [ "$LOCAL" != none ] && ! git --git-dir="$BARE" merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  # bare repo 的 main 不是 github/main 的祖先，代表有人直接 push 到這台 VM
  # 而那份還沒推上 GitHub（或 GitHub 那邊被改寫過歷史）。這時候快轉會弄丟
  # 東西，寧可停手叫人來看。
  log "!! bare repo 的 main（${LOCAL:0:7}）無法快轉到 github/main（${REMOTE:0:7}），已跳過"
  log "   多半是有人 git push prod 之後忘了推 GitHub。請自行確認要以哪邊為準。"
else
  log "github/main 前進到 ${REMOTE:0:7}，觸發部署"
  git --git-dir="$BARE" update-ref refs/heads/main "$REMOTE"
  "$LOGDIR/deploy-prod.sh"
fi

# --- 2. 開發樹 -------------------------------------------------------------
# ~/dochuki 是有人真的在裡面改東西的地方（tmux 的 pnpm dev 就跑在這棵樹上），
# 所以絕對不用 reset --hard。只在完全乾淨時做 ff-only merge，有任何未提交的
# 改動就整個跳過，寧可不同步也不弄丟工作。未追蹤檔案不影響 ff-only。
if [ -d "$DEV/.git" ]; then
  if ! git -C "$DEV" diff --quiet || ! git -C "$DEV" diff --cached --quiet; then
    log "開發樹有未提交的改動，跳過同步（正式站不受影響）"
  else
    git -C "$DEV" fetch --quiet origin main
    DEV_LOCAL="$(git -C "$DEV" rev-parse HEAD)"
    DEV_REMOTE="$(git -C "$DEV" rev-parse origin/main)"
    if [ "$DEV_LOCAL" != "$DEV_REMOTE" ]; then
      if git -C "$DEV" merge --ff-only origin/main >/dev/null 2>&1; then
        log "開發樹已快轉到 ${DEV_REMOTE:0:7}"
      else
        log "開發樹無法快轉（本地有未推送的 commit？），跳過"
      fi
    fi
  fi
fi
