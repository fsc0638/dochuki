#!/usr/bin/env bash
#
# 安裝「收據原圖 24 小時後自動刪除」的定時工作（P9）。可重複執行。
#
#   ~/dochuki-prod/scripts/deploy/install-receipt-purge.sh
#
# 為什麼要在**容器內**執行：正式站的原圖存在 docker volume
# （`dochuki-prod_dochuki-receipts` 掛在 `/data/receipts`），主機上看不到那個
# 路徑；資料庫也只在 compose 內部網路才連得到。所以定時工作是
# `docker compose exec` 進 app 容器跑。
#
# ⚠️ 但 runtime 映像**沒有 tsx**（為了瘦身只帶正式依賴，見 Dockerfile），
# 所以不能直接跑 `pnpm receipts:purge`。改用開發樹的 tsx，並把 DATABASE_URL
# 與 RECEIPT_STORAGE_DIR 指向正式站——跟 CLOUD_SETUP.md 記載的
# 「正式站 bootstrap」是同一套手法。
set -euo pipefail

DEV_TREE="${DOCHUKI_DEV:-$HOME/dochuki}"

echo "== 安裝 systemd 定時工作 =="

sudo tee /etc/systemd/system/dochuki-receipt-purge.service >/dev/null <<UNIT
[Unit]
Description=dochuki: 刪除超過 24 小時的收據原圖
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=${DEV_TREE}
# 從開發樹跑（那裡有 tsx），但資料庫與圖檔路徑指向正式站。
# 正式站的 DB 沒有對主機開 port，用容器 IP 連（重啟會變，所以當場查）。
# 圖檔則直接讀 volume 在主機上的掛載點。
ExecStart=/bin/bash -lc 'export NVM_DIR="\$HOME/.nvm"; . "\$NVM_DIR/nvm.sh"; \
  DB_IP=\$(docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" dochuki-prod-db); \
  VOL=\$(docker volume inspect dochuki-prod_dochuki-receipts --format "{{.Mountpoint}}"); \
  DATABASE_URL="postgresql://dochuki:dochuki@\${DB_IP}:5432/dochuki" \
  RECEIPT_STORAGE_DIR="\$VOL" \
  sudo -E env "PATH=\$PATH" pnpm -s receipts:purge'
UNIT

sudo tee /etc/systemd/system/dochuki-receipt-purge.timer >/dev/null <<'UNIT'
[Unit]
Description=每小時檢查一次是否有超過 24 小時的收據原圖

[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
# 開機後補跑錯過的那次
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now dochuki-receipt-purge.timer

echo
echo "完成。"
echo "  立刻跑一次  sudo systemctl start dochuki-receipt-purge.service"
echo "  看排程      systemctl list-timers dochuki-receipt-purge.timer"
echo "  看紀錄      journalctl -u dochuki-receipt-purge.service -n 30"
