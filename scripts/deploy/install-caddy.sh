#!/usr/bin/env bash
#
# 在 VM 上安裝／更新對外的反向代理（P7.5）。可重複執行。
#
#   ~/dochuki-prod/scripts/deploy/install-caddy.sh
#
# 前置條件（這支腳本不會、也無法代勞）：
#   1. OCI Security List 已放行 TCP 80 與 443（來源 0.0.0.0/0）。
#      Let's Encrypt 的 HTTP-01 驗證要從外部連進 80 埠，沒開就簽不到憑證。
#   2. Caddyfile 裡的主機名必須解析得到這台機器。目前用的是 sslip.io
#      萬用 DNS，主機名裡編了 IP、公開 DNS 直接解析回來，不必自己架 DNS。
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== 1. 安裝 Caddy =="
if command -v caddy >/dev/null 2>&1; then
  echo "已安裝：$(caddy version | head -1)"
else
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y caddy
  echo "已安裝：$(caddy version | head -1)"
fi

echo "== 2. 套用設定 =="
sudo install -o root -g root -m 644 "$SRC/Caddyfile" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null
echo "設定檔通過語法檢查"

echo "== 3. 重新載入 =="
# reload 不中斷既有連線；設定有問題時它會拒絕載入並保留舊設定，
# 所以失敗不會讓站台掛掉
sudo systemctl reload caddy
sudo systemctl enable caddy >/dev/null

# 從 Caddyfile 取出設定的主機名，後面驗證與提示都用它
HOST="$(grep -m1 -oE '^[a-z0-9.-]+\.[a-z]+' /etc/caddy/Caddyfile || true)"
if [ -z "$HOST" ]; then
  echo "!! 無法從 Caddyfile 取出主機名，跳過驗證"
  exit 1
fi

echo "== 4. 驗證 https://$HOST =="
# 直接打站台，而不是去 journal 裡找「certificate obtained」。
# 重複執行時憑證早就有了、不會再簽一次，用「有沒有剛簽發」當判準會誤報失敗
# （2026-09-07 第一版就是這樣寫的，重跑腳本時當場誤報）。
# 這裡刻意**不加 -k**：要驗的正是憑證能不能通過系統信任鏈。
for i in $(seq 1 12); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/login" || true)"
  if [ "$CODE" = "200" ]; then
    echo "站台正常（/login 回 200，憑證通過驗證）"
    break
  fi
  if [ "$i" = 12 ]; then
    echo "!! 60 秒內沒等到正常回應（最後一次 http_code=$CODE）。可能原因："
    echo "   - OCI Security List 沒放行 80／443"
    echo "   - 主機名 $HOST 解析不到這台機器"
    echo "   - 所在網路有 TLS 攔檢（見 docs/CLOUD_SETUP.md 的警告）"
    echo "   查看：sudo journalctl -u caddy -n 50 --no-pager"
    exit 1
  fi
  sleep 5
done

echo
echo "完成。對外網址： https://$HOST"
echo "  查存取紀錄  sudo journalctl -u caddy -f"
echo "  換網域      改 scripts/deploy/Caddyfile 的主機名 → 重跑這支腳本"
