#!/usr/bin/env bash
#
# 在 Oracle VM 上安裝／更新部署機制。可重複執行，每次都會把腳本與 systemd
# 單元覆寫成目前 checkout 的版本。
#
# 首次安裝（VM 上）：
#   git clone https://github.com/fsc0638/dochuki.git /tmp/dochuki-bootstrap
#   /tmp/dochuki-bootstrap/scripts/deploy/install-on-vm.sh
#
# 之後改了這個目錄底下的腳本，push 上 GitHub 等它自動部署後，執行：
#   ~/dochuki-prod/scripts/deploy/install-on-vm.sh
set -euo pipefail

BARE="$HOME/dochuki.git"
WORKTREE="$HOME/dochuki-prod"
LOGDIR="$HOME/deploy"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="https://github.com/fsc0638/dochuki.git"

echo "== 1. bare repo =="
if [ ! -d "$BARE" ]; then
  git init --bare "$BARE"
  echo "已建立 $BARE"
else
  echo "$BARE 已存在，沿用"
fi
# github remote：sync.sh 靠它輪詢；用 https 走 gh credential helper，
# 不必在 VM 上另外放一把 deploy key
git --git-dir="$BARE" remote remove github 2>/dev/null || true
git --git-dir="$BARE" remote add github "$REPO_URL"
git --git-dir="$BARE" fetch --quiet github '+refs/heads/main:refs/remotes/github/main'
git --git-dir="$BARE" rev-parse main >/dev/null 2>&1 \
  || git --git-dir="$BARE" update-ref refs/heads/main refs/remotes/github/main
echo "github remote 就緒，main = $(git --git-dir="$BARE" rev-parse --short main)"

echo "== 2. 部署腳本 =="
mkdir -p "$LOGDIR"
install -m 755 "$SRC/deploy-prod.sh" "$LOGDIR/deploy-prod.sh"
install -m 755 "$SRC/sync.sh"        "$LOGDIR/sync.sh"
echo "已安裝到 $LOGDIR"

echo "== 3. post-receive hook =="
cat > "$BARE/hooks/post-receive" <<'HOOK'
#!/usr/bin/env bash
# 有人 git push prod main 時立刻部署。只認 main，其他分支收下但不動正式站。
set -euo pipefail
while read -r _old _new ref; do
  if [ "$ref" = "refs/heads/main" ]; then
    echo "--> main 已更新，開始部署正式站"
    "$HOME/deploy/deploy-prod.sh"
  else
    echo "--> $ref 收下了，但只有 main 會觸發部署"
  fi
done
HOOK
chmod +x "$BARE/hooks/post-receive"
echo "已安裝 $BARE/hooks/post-receive"

echo "== 4. systemd 定時同步 =="
sudo tee /etc/systemd/system/dochuki-sync.service >/dev/null <<UNIT
[Unit]
Description=dochuki: 從 GitHub 同步 main 並在有變動時部署正式站
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/home/ubuntu/deploy/sync.sh
# 首次建置要拉 Next.js 與 PaddleOCR 兩個映像，給足時間
TimeoutStartSec=3600
UNIT

sudo tee /etc/systemd/system/dochuki-sync.timer >/dev/null <<'UNIT'
[Unit]
Description=每 2 分鐘檢查一次 GitHub 上的 main

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
# 開機後補跑錯過的那次
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now dochuki-sync.timer
echo "已啟用 dochuki-sync.timer"

echo
echo "完成。"
echo "  手動部署    ~/deploy/deploy-prod.sh"
echo "  手動同步    ~/deploy/sync.sh"
echo "  看排程      systemctl list-timers dochuki-sync.timer"
echo "  看紀錄      journalctl -u dochuki-sync.service -n 50"
echo "              tail -f ~/deploy/deploy.log"
