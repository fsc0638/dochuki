# 雲端開發機建置計畫（Oracle Cloud Free Tier）

> 目的：把開發環境搬到雲端 Linux VM，用 SSH 連進去開發，不用再煩惱多台裝置各自
> DB 不同步、也繞開 Windows 中文路徑下 pnpm 必崩潰的問題（見 CLAUDE.md 進度日誌
> 2026-08-24）。**這是遠端開發機，不是正式對外上線**——不開放任何 port 給公網，
> 只用 SSH tunnel 存取，見下方「兩種東西」的區分。
>
> 本文件只是計畫／checklist，尚未執行任何步驟。帳號註冊、金流驗證等步驟必須由
> 使用者本人操作，我不會也不能代為輸入信用卡或帳密。

## 前置需求（使用者自己做，我做不了）

- Oracle Cloud 帳號（[cloud.oracle.com](https://cloud.oracle.com) 註冊 Always Free）
  - 需要手機號碼＋一張信用卡做身分驗證。**Always Free 資源本身不收費**，但卡片
    驗證是 Oracle 官方流程，必須本人輸入，不能透過我或任何第三方代辦。
  - 註冊後可能要求選 Home Region，選離自己最近、且日後不會想換的（**region 選定
    後無法免費搬遷 Always Free 資源**）。
- 本機一組 SSH 金鑰，指定檔名避免蓋掉預設的 `id_ed25519`：
  ```bash
  ssh-keygen -t ed25519 -C "oracle devbot tokyo" -f ~/.ssh/oracle_devbot
  ```

## 兩種東西，別混在一起（沿用先前對話的結論）

這次要建的是「遠端**開發機**」：SSH 連進去改程式、confirm，本機瀏覽器透過 SSH
tunnel 看畫面。**不對外開 port**，因為 P2 明確決定「暫不做帳號系統」——沒有登入
機制就公開，等於誰有網址誰就能看/改行程資料。真的要讓手機在旅途中直接連（PWA
的本意），是之後 P5「PWA 與收尾」的另一個任務，需要網域＋HTTPS＋至少一層存取
保護，屆時另外規劃。

## 建置步驟

### Phase A — Oracle 主機建立（使用者操作，約 20–30 分鐘）

1. 登入 OCI Console → Compute → Instances → **Create Instance**
2. Name 填泛用名稱（例如 `dev-box`）——這台不專屬 dochuki，見前面對話的裁示
3. Image 選 **Canonical Ubuntu 24.04**（Always Free 支援）
4. Shape 選 **VM.Standard.A1.Flex**（Ampere ARM，Always Free 額度是全帳號共用
   4 OCPU／24GB RAM，先分配 **2 OCPU／12GB** 給這台，留一半額度給以後）
5. Boot volume 用預設（Always Free 總額度 200GB，一台用 50GB 綽綽有餘）
6. 貼上本機 SSH 公鑰（`~/.ssh/oracle_devbot.pub` 的內容）
7. 網路用預設 VCN／Subnet，**不要額外開放 port**（預設 Security List 只開 22，
   剛好符合「只走 SSH tunnel」的需求）
8. 建立完成後記下 **Public IP**

**已知地雷**：Ampere A1 在熱門 region 常常建立時報 `Out of host capacity`。
遇到就換一個 Availability Domain 重試，或稍後再試，這是 Oracle 端容量問題，
不是設定錯誤。

**保命備援**：萬一之後 SSH 怎麼連都連不上（例如防火牆設定改壞），OCI Console
→ Instance 頁面有內建的 **Instance console connection**（瀏覽器裡的終端機，不
走 SSH），可以直接登進去修設定，不用重建整台機器。

### Phase B — VM 基礎工具安裝（約 20 分鐘）

```bash
ssh -i ~/.ssh/oracle_devbot ubuntu@<PUBLIC_IP>
```

1. 更新套件：`sudo apt update && sudo apt upgrade -y`
2. 裝基礎工具（同事的指南這份清單很實用，一次裝齊）：
   ```bash
   sudo apt install git curl wget unzip python3-pip tmux ufw -y
   ```
   - `tmux`：遠端開發機的重點——SSH 斷線／筆電睡眠不會中斷 VM 上跑的
     `pnpm dev`，`tmux attach` 接回去就好
   - `ufw`：VM 內部防火牆，跟 OCI 的 Security List 是**兩層獨立防火牆**，見
     下方「雙層防火牆」提醒
3. 校正時區（避免 log／timestamp 跟自己對不上）：
   ```bash
   sudo timedatectl set-timezone Asia/Taipei
   ```
4. 裝 Docker：跟官方 `get.docker.com` 腳本走，裝完把 `ubuntu` 使用者加進
   `docker` 群組（`sudo usermod -aG docker ubuntu`，重新登入生效）
5. 裝 Node（建議用 nvm，版本對齊本機 `package.json` 的 engines 需求）
6. `corepack enable` 啟用 pnpm（跟本機一致，不用 `npm install -g pnpm`）

**雙層防火牆提醒**：Oracle 的 Ubuntu image 除了 OCI 的 Security List／NSG，
VM 內部另外還有一層 iptables 規則。現在只用 SSH（22 port 兩層都預設放行）不
受影響，但**以後如果想多開任何 port**（例如直接測 `pnpm dev` 的 3000、或
P5 要開 80/443），兩層都要各自開一次，只開 OCI 那層、VM 內 iptables 沒開一樣
連不進去。

### Phase C — 專案部署（約 20 分鐘）

1. 在 VM 上設定 GitHub 存取——**建議開一把新的 deploy key 或用
   `gh auth login` 裝置授權登入，不要把個人 PAT 貼給我或存進 VM 的 shell
   history**（跟先前 repo 改名那次的原則一致）
2. `git clone git@github.com:<你的帳號>/dochuki.git`
3. `cp .env.example .env`，用 `nano .env` **在 VM 上直接**填入真實值：
   - `DATABASE_URL`（對齊 docker-compose 的 5442 port 映射）
   - `GEMINI_API_KEY`（2026-08-25 起收據解析改用 Gemini，本機有的話這裡重新
     申請或直接貼——這一步只有你自己在 VM 終端機做，不經過我）
4. `docker compose up -d db` 起 Postgres（P5 之後 docker-compose.yml 多了一個 app
   服務給容器化部署用，裸指令 `docker compose up -d` 會連 app 一起建置/啟動，
   這裡只需要資料庫，明確帶 `db`）
5. `pnpm install`
6. `pnpm prisma migrate dev`
7. `pnpm prisma db seed`（灌新潟迴歸 fixture）
8. `pnpm test regression` 確認 17/17 全綠——這是「這台機器可以開始開發」的
   驗收線，跟本機當初的標準一樣

### Phase D — 連線方式（約 10 分鐘，之後每次開工只需 1 行指令）

- **看畫面**：本機開一個 SSH tunnel
  ```bash
  ssh -L 3000:localhost:3000 -i ~/.ssh/oracle_devbot ubuntu@<PUBLIC_IP>
  ```
  同一個 session 裡 VM 上跑 `pnpm dev`，本機瀏覽器開 `localhost:3000` 就看得到
- **改程式**：裝 VS Code 的 **Remote-SSH** 套件，直接連上 VM，體感等同本機開發，
  終端機／檔案總管都在遠端跑

## ARM 相容性風險（2026-09-06 已全數實測解除）

Ampere A1 是 **arm64** 架構，跟這台 Windows 機器（x64）不同，以下兩處 P3 已經
用到、還沒在 arm64 上測過：

1. **Prisma 7 client**：`prisma/schema.prisma` 的 generator 若有寫死
   `binaryTargets`，要確認含 `linux-arm64-openssl-3.0.x`（或對應版本），否則
   `prisma generate` 在 VM 上可能抓不到對應的 query engine 二進位檔
2. **Playwright**（P3 PDF 匯出用）：Chromium 的 linux-arm64 支援度沒有 x64
   完整，實際跑 `pnpm prisma db seed` 之後、要做 PDF 匯出測試時再驗證，不影響
   Phase A–D 這次的開發環境建置

這兩點不擋今天的建置計畫，等 Phase C 跑完 `pnpm test regression` 綠燈後，
下次動到 PDF 匯出或 migrate 報錯時再回來查。

> **2026-09-06 實測結果：兩項都沒問題，此節保留供日後換架構時參照。**
>
> 在 VM 上把程式碼更新到 `034e0d3`（最新）後實測：
>
> 1. **Prisma 7**：`prisma generate` 在 aarch64 正常產出 client（7.9.1，235ms），
>    `migrate deploy` 套用 `20260901120000_remove_member_weight` 成功，
>    `db seed` 寫入 `Decimal(18,6)` 正確。`schema.prisma` 未寫死 `binaryTargets`，
>    Prisma 自行解析架構即可，**不需要任何調整**。
>    `pnpm test` 209 passed + 1 skipped、`pnpm test regression` 17/17。
>    DB 實查亦重現歷史斷言：ExpenseShare 合計 666,294.25 TWD ＋ 公費
>    300,000 JPY×0.25 = 75,000 TWD，總計 **741,294.25**（顯示值 741,294）。
>
> 2. **Playwright**：`playwright install chromium` 有 **arm64 版可下載**（約 984MB，
>    含 chromium／headless_shell／ffmpeg）。真正的障礙不是架構而是
>    **Ubuntu server 沒有桌面環境的共享函式庫**，要補跑：
>    ```bash
>    sudo env "PATH=$PATH" pnpm exec playwright install-deps chromium
>    ```
>    （`sudo` 會重設 PATH，不帶 `env "PATH=$PATH"` 會找不到 nvm 的 pnpm——見坑 ④）
>    補完後端到端實測 `GET /api/trips/trip-niigata-2026/export/pdf`：
>    **HTTP 200、355,090 bytes、4.9 秒、`%PDF-1.4`、2 頁**，dev server log 無錯誤。
>    **產出的 PDF 由使用者親自開檔目視確認：中文顯示正常，未出現豆腐方塊**
>    （2026-09-07）——字型嵌入正確，`NotoSansCJKtc-Regular.otf` 在 arm64 上
>    運作無誤。這一項程式面驗不出來：中文若沒嵌好，檔案一樣是合法的 2 頁 PDF、
>    大小也相近，只有人眼看得出差別。

## 對外公開網域＋HTTPS（2026-09-07 完成）

**對外網址：https://141-147-176-204.sslip.io**

原本這一段寫的是「現在不要做」，理由是「P2 裁示暫不做帳號系統，這台機器一旦
掛上網域對外開放，任何人拿到網址就能看／改行程資料」。帳號系統在 P7 做完了
（見 `docs/AUTH_PLAN.md`），前置條件才算滿足。

### 網域用 sslip.io，不必註冊也不必架 DNS

`141-147-176-204.sslip.io` 是公開的萬用 DNS 服務：主機名裡編了 IP，解析直接
回那個 IP。Let's Encrypt 認這種網域，簽出來是**真憑證**，瀏覽器不跳警告、
PWA 也能正常安裝到手機主畫面。免費、不必註冊任何帳號。

代價只有網址難看難記。**換成自己的網域**時：改 `scripts/deploy/Caddyfile`
的主機名、DNS 的 A 記錄指向 `141.147.176.204`，重跑 `install-caddy.sh`，
憑證會自動重簽，其餘都不用動。

### 用 Caddy 而不是 nginx + certbot

Caddy 內建自動 HTTPS：設定檔就是「主機名 + reverse_proxy 目標」兩行，
憑證申請與續簽都自己來。nginx 那條路要另外裝 certbot、設 renew hook、
處理 challenge 路徑，多好幾個要維護的東西，換來的功能這裡用不到。

設定與安裝腳本都在版控裡：`scripts/deploy/Caddyfile`、
`scripts/deploy/install-caddy.sh`（可重複執行）。

### 實際做的三件事

1. **OCI Security List** 加兩條 ingress：TCP 80 與 443，來源 `0.0.0.0/0`
2. **裝 Caddy 並套設定**，reverse_proxy 指向 `127.0.0.1:3100`
3. Caddy 完成 Let's Encrypt 的 HTTP-01 驗證，取得憑證

**VM 自己的防火牆不必動**——實測 `ufw` 是 inactive、nftables 只有 Docker 的
NAT 規則、iptables INPUT policy 是 ACCEPT 且無規則。舊版指南裡那段
「VM 內 ufw／iptables 也要開 80/443」對這台機器是多餘的。

### 架構上外界只碰得到 Caddy

正式站的 app 仍然**只綁 `127.0.0.1:3100`**（`docker-compose.prod.yml` 沒有
改動），資料庫完全不對主機開埠。所有外部流量都必須經過反向代理，TLS 在
Caddy 終止，往後端走本機迴路。

### 驗證（2026-09-07）

從 VM 走公網回來測（不加 `-k`，用系統信任鏈驗證）：

| 項目 | 結果 |
|---|---|
| 憑證簽發者 | `C=US, O=Let's Encrypt, CN=YE1`，有效至 2026-12-06 |
| `/login`、`/signup` | 200 |
| `/trips`（未登入） | 307 導向登入頁——守門正常 |
| `http://` | 308 自動轉 HTTPS |
| `/sw.js`、`/manifest.json`、兩個 icon | 200，MIME 正確 |
| 通訊協定 | HTTP/2，並廣告 HTTP/3 |

### ⚠️ 本地網路有 TLS 攔檢，測試時別誤判

從開發用的那台 Mac 測，拿到的憑證簽發者是 **Fortinet**（`CN=FG201FT922900466`）
而不是 Let's Encrypt，`curl` 因為信任鏈驗不過而回 `000`，HTTP 則被回 403。
**這不是伺服器的問題**，是該網路有防火牆設備在做 TLS 攔檢與過濾。

實務影響：在那個網路下開這個網址可能被擋或跳憑證警告，**換到行動網路或
家用網路就正常**。這也可能影響 PWA 安裝（需要有效的安全內容）。
要驗證伺服器端到底對不對，從 VM 自己 `curl` 出去繞一圈最乾淨。

### 安裝腳本的驗證別用「有沒有剛簽發憑證」當判準

`install-caddy.sh` 第一版是去 journal 裡找 `certificate obtained successfully`
來確認成功。第一次執行沒問題，**重跑就誤報失敗**——憑證早就有了，Caddy 不會
再簽一次，自然找不到那行紀錄。

改成直接 `curl https://<主機名>/login` 看是不是 200，第一次與重跑都準確，
而且刻意**不加 `-k`**：要驗的正是憑證能不能通過系統信任鏈。這也是「冪等」
該有的樣子——驗的是**目前狀態對不對**，不是**這次做了什麼**。

### 踩到的坑

Debian 的 Caddy 套件在 systemd unit 設了 `ProtectSystem=full`，`/var` 對這個
服務是**唯讀**的。原本想把存取紀錄寫成 `/var/log/caddy/access.log` 的輪替檔案，
Caddy 會以 `permission denied` 拒絕載入整份設定（`systemctl reload` 失敗但
舊設定仍在跑，站台不會掛）。要用檔案得再加 systemd override 開
`ReadWritePaths`，多一個要維護的東西——改用 journald，`journalctl -u caddy` 查。

不論寫到哪裡都**不記 query string 與 request body**，那裡可能出現收據內容或
金額，違反 CLAUDE.md「禁止把收據圖檔或解析結果寫進 log」。

## 進度追蹤

- [x] Phase A：Oracle VM 建立，拿到 Public IP（`141.147.176.204`，`fsc0638-dev`）
- [x] Phase B：Docker／Node／pnpm 裝好
- [x] Phase C：專案 clone＋`.env`＋DB migrate/seed，`pnpm test regression` 綠燈（17/17）
- [x] Phase D：SSH tunnel 連線驗證可用——2026-08-25 瀏覽器實測 `localhost:3001/trips`
      正確顯示新潟團 seed 資料，Gemini 金鑰、DB、tunnel 全線打通
- [x] macOS 第二台用戶端接入（2026-09-06，`ssh dochuki` 直連實測通過，見文末實錄）
- [x] macOS 第三台用戶端接入（2026-09-07，Mac mini，走 Bastion 補金鑰後 `ssh dochuki` 直連實測通過，見文末實錄）

**Windows 用戶端慣用連線方式**（兩個視窗）：
```powershell
# 窗口 A：工作視窗，跑 pnpm dev（用 tmux 包住，斷線不會中斷）
ssh -i "$env:USERPROFILE\.ssh\oracle_devbot" ubuntu@141.147.176.204
# 連上後：tmux new -s dev（或 tmux attach -t dev 接回既有 session）→ cd ~/dochuki → pnpm dev

# 窗口 B：只負責 port forwarding，開著不要關、不要在裡面打指令
ssh -i "$env:USERPROFILE\.ssh\oracle_devbot" -L 3001:localhost:3000 ubuntu@141.147.176.204
```
本機瀏覽器開 `http://localhost:3001`。本機 3000 port 因 Windows 保留而綁不了，固定改用 3001。

**macOS 用戶端慣用連線方式**（2026-09-06 接入，過程與踩到的坑見文末「macOS 用戶端接入實錄」）：
本機 `~/.ssh/config` 已寫好兩個 Host，開工一樣兩個視窗，但指令短很多：
```bash
# 窗口 A：工作視窗，跑 pnpm dev（用 tmux 包住，斷線不會中斷）
ssh dochuki
# 連上後：tmux attach -t dev（或 tmux new -s dev）→ cd ~/dochuki → pnpm dev

# 窗口 B：只負責 port forwarding，開著不要關、不要在裡面打指令
ssh dochuki-tunnel
```
本機瀏覽器開 `http://localhost:3000`。**macOS 沒有 Windows 保留 3000 port 的問題**，不必沿用 3001。

> 2026-09-06 已端到端實測：VM 上起一個臨時 HTTP server 綁 `127.0.0.1:3000`，Mac 端 `ssh dochuki-tunnel` 後 `curl http://localhost:3000/...` 取回內容、`http_code=200`。ssh verbose 日誌並確認認證走的是 `/home/ubuntu/.ssh/authorized_keys2`。

對應的 `~/.ssh/config`（Mac 用的是**另一把**金鑰 `~/.ssh/oracle_devbot`，與 Windows 那把不同，兩把並存）：
```
Host dochuki
    HostName 141.147.176.204
    User ubuntu
    IdentityFile ~/.ssh/oracle_devbot
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 6

# 只負責 port forwarding 的視窗：本機 3000 -> VM 3000
Host dochuki-tunnel
    HostName 141.147.176.204
    User ubuntu
    IdentityFile ~/.ssh/oracle_devbot
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 6
    LocalForward 3000 localhost:3000
    RequestTTY no
```

VS Code Remote-SSH 尚未實測，之後真的要在雲端改程式碼時再驗證。

## macOS 用戶端接入實錄（2026-09-06）

把第二台用戶端（macOS，`FSC-MacBook-Pro`）接上同一台 VM。**這一節記的是實測結論，不是計畫**——中間有四個坑，文件原本完全沒提，重來一次會再踩。

### 情境

Windows 機器不在身邊，Mac 上沒有 `oracle_devbot` 私鑰（它只存在 Windows 機），所以無法用既有金鑰登入去新增金鑰——典型的雞生蛋問題。VM 本身活著（22 port 通、SSH 服務正常），純粹是缺一把被 VM 認得的金鑰。

### 最後採用的路徑

1. Mac 產一把**專屬新金鑰**（不搬 Windows 的私鑰）：
   ```bash
   ssh-keygen -t ed25519 -C "oracle devbot mac" -f ~/.ssh/oracle_devbot -N ""
   ```
2. OCI Console → Compute → 該實例 → **Management** 分頁 → Oracle Cloud Agent → 把 **Bastion** 外掛從 Disabled 改成 **Enable**（外掛狀態約 5–10 分鐘後才會從 `Stopped` 變 `Running`，要等）
3. Identity & Security → **Bastion**（網址是 `/security/bastion`）→ Create bastion：綁 `fsc0638-dev-vcn` / `fsc0638-dev-subnet`，CIDR block allowlist 填**自己當下的對外 IP `/32`**
4. 該 Bastion → Sessions → Create session：Managed SSH、Username `ubuntu`、目標實例 `fsc0638-dev`、貼上 Mac 的公鑰
5. 用 Console 給的 SSH 指令（把 `<privateKey>` 換成 `~/.ssh/oracle_devbot`）連進 VM，**把公鑰寫進 `~/.ssh/authorized_keys2`**（不是 `authorized_keys`，理由見坑 ③）
6. 刪掉 session，實測直連仍通 → 完成

### 四個坑（都實際踩到）

**① 序列主控台救不了「弄丟金鑰」**
文件上方「保命備援」寫 OCI Console 的 Instance console connection 可以在 SSH 連不上時登進去修。但 Oracle 官方 Ubuntu image 的 `ubuntu` 使用者**沒有設密碼**（設計上只認金鑰），序列主控台給的是帳密登入畫面，會直接卡住。真要靠它，得重開機在 GRUB 攔截進單使用者模式——可行但要停機且步驟細，是最後手段，不是輕鬆備援。

**② 這台 VM 沒有 Compute Instance Run Command 外掛**
OCI 的 Run Command 可以從 Console 以 root 在 VM 執行指令，是這種情境的首選解。但**這台 Ubuntu 實例的 Oracle Cloud Agent 外掛清單裡根本沒有這一項**（11 個外掛全看過）。指令送出後 Delivery status 會卡在 `Visible`／Execution `Accepted`，**永遠不會執行**，最後自己變成 `Expired`——沒有任何錯誤訊息告訴你外掛不存在。要裝這個外掛又得先能 SSH 進去，死結。
（對照：用新版精靈建立實例時，預設外掛清單裡**有**這一項。所以這是「這台 8/25 建的 Ubuntu 機當初沒裝上」，不是區域不支援。）

**③ Bastion 會還原 `authorized_keys`，永久金鑰必須放 `authorized_keys2`**
Managed SSH session 的運作方式是：把 `~/.ssh/authorized_keys` 備份成 `~/.ssh/authorized_keys_backup`（owner 為 `snap_daemon`），再把你的公鑰**暫時**插進 `authorized_keys`；**session 結束時用備份還原，插入的金鑰會被抹掉**。
所以在 session 裡把金鑰「附加到 `authorized_keys`」是白做的——而且因為 session 還沒結束時測試會過，很容易誤判成功。
解法：這台 sshd 的生效設定是
```
authorizedkeysfile .ssh/authorized_keys .ssh/authorized_keys2
```
（OpenSSH 預設值；`/etc/ssh/sshd_config` 未覆寫）。把永久金鑰寫進 **`~/.ssh/authorized_keys2`**，sshd 照樣認，而 Bastion 外掛完全不碰這個檔。不需要 sudo，也不會動到既有金鑰。

> **2026-09-07 後續：所有金鑰統一移到 `authorized_keys2`，`authorized_keys` 刻意留空。**
> 依使用者裁示，Windows 那把 `oracle devbot tokyo` 也從 `authorized_keys` 搬到
> `authorized_keys2`，兩把並存；`authorized_keys` 只保留一段說明註解，指向本節。
> 這樣兩台用戶端都不受 Bastion 還原影響，位置也一致。
>
> 搬移時的防呆（金鑰行打錯會讓那台機器登不進來，而對方私鑰不在手邊時無法實測）：
> 用 `grep -F` 原樣取出、不重打任何字元；`cmp` 逐位元組比對搬移前後那一行；
> 比對指紋；並在 VM 留下 `~/.ssh/authorized_keys.YYYY-MM-DD.bak`。
> 還原只要一行：
> ```bash
> ssh dochuki 'cp ~/.ssh/authorized_keys.2026-09-07.bak ~/.ssh/authorized_keys'
> ```
驗證方式要嚴謹：**刪掉 session、確認 `authorized_keys` 已被還原成只剩原本那把之後**，再測直連——session 還在時測不出真假。

**④ nvm 在非互動 SSH 不載入**
VM 上 node/pnpm 是用 nvm 裝的（`~/.nvm`，node v24.19.0 / npm 11.17.0 / pnpm 11.23.0）。nvm 的初始化在 `~/.bashrc`，而 Ubuntu 的 `.bashrc` 開頭就對非互動 shell `return`，所以：
```bash
ssh dochuki 'pnpm -v'        # → command not found（假象，其實裝了）
ssh dochuki 'node -v'        # → 同上；連 bash -lc 也一樣看不到
```
遠端跑非互動指令要自己載入：
```bash
ssh dochuki 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; pnpm -v'
```
互動登入（`ssh dochuki` 後手打指令）不受影響。

### 完成後的狀態

- VM `~/.ssh/authorized_keys`：**刻意留空**（只有說明註解）——2026-09-07 起
- VM `~/.ssh/authorized_keys2`：**三把金鑰都在這裡**
  - `SHA256:fYGOs92e…` `oracle devbot mac`（macOS，FSC-MacBook-Pro）
  - `SHA256:sW5+Ggcp…` `oracle devbot tokyo`（Windows）
  - `SHA256:kl0L5YY1…` `oracle devbot macmini`（macOS，Mac mini，2026-09-07 加入）
  - 驗證：`ssh -v` 顯示認證來源為 `/home/ubuntu/.ssh/authorized_keys2`，
    且 `ssh-keygen -lf ~/.ssh/authorized_keys` 金鑰數為 0
- Mac 直連實測通過：`ssh dochuki` → `ubuntu@fsc0638-dev-vcn`，Ubuntu 24.04.4 LTS / aarch64
- Bastion `Bastion202609061805`：session 用完即刪，**Bastion 本體依使用者裁示保留**（2026-09-06），當作下次換機器／弄丟金鑰時的救援入口，不必重走一輪。
  服務免費、不對外開任何 port。**但 CIDR allowlist 綁死申請當下的對外 IP——換到咖啡廳或手機熱點就連不上，要回 Console 改這一欄**。2026-09-07 已改為兩筆並存：`114.43.58.161/32`（2026-09-06 那次）與 `59.124.107.139/32`（Mac mini 那次）

### 要再加第三台用戶端時

重跑上面 1→6 即可，但可以少踩坑：直接跳過 Run Command，從「啟用 Bastion 外掛」開始；金鑰一律寫 `authorized_keys2`（用 `>>` 附加，不要覆蓋）。或者更簡單——從任何一台**已經連得上**的機器執行：
```bash
ssh dochuki "cat >> ~/.ssh/authorized_keys2" < ~/.ssh/新機器的公鑰.pub
```

## Mac mini（第三台用戶端）接入實錄（2026-09-07）

### 情境

新的 Mac mini（macOS 26.4）上什麼都沒有：沒有 repo、沒有 `~/.ssh/oracle_devbot`、
`~/.ssh/config` 只有 OrbStack 的 Include。Windows 那台當下不在手邊，所以走 Bastion。

### 實際路徑

1. `gh repo list` 找到 `fsc0638/dochuki`，clone 到 `~/Dev/dochuki`
2. 本機產生新金鑰 `ssh-keygen -t ed25519 -C "oracle devbot macmini" -f ~/.ssh/oracle_devbot`
3. `~/.ssh/config` 附加 `dochuki` / `dochuki-tunnel` 兩個 Host（原檔備份為 `config.bak.20260907`）
4. OCI Console → Bastion → Edit：CIDR allowlist **新增** `59.124.107.139/32`，
   保留原有的 `114.43.58.161/32`（兩筆並存，沒有覆蓋）
5. Sessions → Create session：Managed SSH／username `ubuntu`／instance `fsc0638-dev`／
   Paste SSH key 貼上新公鑰。**建立耗時約 70 秒**，中途一直停在 `Creating`，是正常的，不要重按
6. 用 View SSH command 取得的 ProxyCommand 連進去，把公鑰附加到 `authorized_keys2`
7. 刪除 Bastion session，改測直連 `ssh dochuki` → 通過

### 驗證紀錄

- `authorized_keys2` 三把金鑰、`authorized_keys` 金鑰數 0（維持 2026-09-07 的刻意留空）
- Bastion session 刪除後 `ssh dochuki` 仍可直連 → 確認金鑰是永久的，不依賴 Bastion
- tunnel 端到端：`ssh -f -N dochuki-tunnel` 後 `curl http://localhost:3000/trips`
  取回 `http_code=200`、標題 `道中記 Dōchūki`
- VM 現況：`main` 與 origin 同步、`db` 容器 healthy、tmux `dev` session 裡 `pnpm dev` 一直跑著

### 這次確認的事

- **VM 的 22 埠對外仍開著**，所以「連不上」多半只是金鑰不在，不是網路問題。
  下次遇到先用 `nc -z <IP> 22` 分辨，是金鑰問題就別急著開 Bastion
- 動到 `authorized_keys2` 前先 `cp` 一份備份（這次留下 `authorized_keys2.bak.20260907`）
- macOS 上沒有 `timeout` 指令，要用 `ssh -o ConnectTimeout=N` 代替

## 自動同步與正式站部署（2026-09-07 建立）

兩個需求用同一套東西解決：各設備 push 之後 VM 要自動跟上，以及在 VM 上跑一個
真正的正式站（不是 `pnpm dev`）。

### 三棵樹，各司其職

| 路徑 | 是什麼 | 誰會動它 |
|---|---|---|
| `~/dochuki` | 開發樹，tmux 裡的 `pnpm dev` 跑在這棵 | 人手動改；`sync.sh` 只在乾淨時快轉 |
| `~/dochuki.git` | bare repo，部署的唯一權威 | `sync.sh` 從 GitHub 快轉；`git push prod` 直接寫入 |
| `~/dochuki-prod` | 正式站工作樹，**沒有自己的 `.git`** | 只由 `deploy-prod.sh` 用 `checkout -f` 覆寫 |

開發樹與正式站的容器、volume、port 全部分開，互不干擾：

| | 開發 | 正式站 |
|---|---|---|
| compose project | `dochuki` | `dochuki-prod` |
| 容器名 | `dochuki-db` | `dochuki-prod-db` / `-app` / `-ocr-sidecar` |
| DB 資料 | `dochuki_dochuki-pgdata` | `dochuki-prod_dochuki-pgdata`（**另一份資料**） |
| 對外 port | db 5442、dev server 3000 | app `127.0.0.1:3100`，db 不開 |

### 兩個觸發途徑

**自動（每 2 分鐘）**：`dochuki-sync.timer` → `sync.sh` → 從 GitHub 快轉 bare repo，
有前進才呼叫 `deploy-prod.sh`。任何設備、任何作業系統，只要 push 上 GitHub 就會
被帶進來，設備端不需要任何設定。

**立即（不想等）**：本機加一個指向 VM bare repo 的 remote，push 過去由
`post-receive` hook 當場部署。

```bash
git remote add prod ssh://ubuntu@141.147.176.204/home/ubuntu/dochuki.git
git push prod main
```

兩條路走的是同一支 `deploy-prod.sh`、同一把 `flock`，同時發動也不會打架。

### 刻意這樣設計的地方

- **開發樹永不 `reset --hard`**。`sync.sh` 只在工作樹完全乾淨時做 `merge --ff-only`，
  有任何未提交的改動就整棵跳過並寫進 log。寧可不同步，也不弄丟正在改的東西。
- **正式站工作樹沒有 `.git`**，用 `git --git-dir=... --work-tree=... checkout -f`
  取出。這樣它不可能被誤當成開發目錄拿來改，權威永遠在 bare repo。
- **`checkout -f` 不刪未追蹤檔案**，所以 `~/dochuki-prod/.env` 不會被部署洗掉。
  第一次部署時由 `deploy-prod.sh` 從 `~/dochuki/.env` 撈出 `GEMINI_API_KEY`
  與 `FX_API_BASE` 產生（`app` 的 `DATABASE_URL` 是 compose 寫死指向內網
  `db:5432`，不吃 `.env`）。
- **sync 遇到無法快轉就停手**。如果有人 `git push prod` 之後忘了推 GitHub，
  bare repo 的 main 會領先 GitHub，這時強行快轉等於把那份丟掉，所以改成寫
  log 叫人來看。
- **migration 由部署流程跑，容器不自動跑**（沿用 README 部署章節的決定）。
  `migrate deploy` 重複執行是安全的，失敗會重試 30 次再放棄。

### 常用指令

```bash
~/deploy/deploy-prod.sh                        # 手動部署
~/deploy/sync.sh                               # 手動同步一次
tail -f ~/deploy/deploy.log                    # 部署紀錄
systemctl list-timers dochuki-sync.timer       # 下次什麼時候跑
journalctl -u dochuki-sync.service -n 50       # 定時任務的輸出
docker compose -p dochuki-prod -f ~/dochuki-prod/docker-compose.yml \
  -f ~/dochuki-prod/docker-compose.prod.yml logs --tail=100 app
```

### 健康檢查踩過的坑（2026-09-07）

`deploy-prod.sh` 原本只檢查 `/trips` 是否回 200。P7.2 帳號系統上線後，
未登入的請求會被 middleware 導向登入頁，`/trips` 的**正確**行為變成 307——
舊的檢查於是把一次完全成功的部署判成失敗：容器已重建、migration 已套用、
服務完全正常，但 `deployed.sha` 沒更新、腳本回傳 1。

教訓是**健康檢查的斷言會隨功能演進而過時**，而且失敗時看起來像是部署壞了，
很容易往錯的方向查。現在改成兩個條件：

- `/login` 必須 200——公開頁能渲染就代表 app 真的活著、沒有 500
- `/trips` 必須 200 或 30x——未登入導向是對的，只有 5xx 才算壞

資料庫連通性不靠 HTTP 驗證：前一步的 `prisma migrate deploy` 若連不上資料庫
就已經失敗退出了。

同一次也補上「**部署成功後把 `~/deploy` 的腳本更新成該版本**」。放在成功之後
是刻意的：部署失敗時保留上一版能跑的腳本，不會因為新版腳本本身有問題而讓
下一次部署也一起壞掉。這個機制本身是這次才加的，所以這一版仍需手動
`install` 一次；之後改腳本就會自動跟上。

### 覆寫執行中的腳本會讀到舊內容（2026-09-07 也踩到了）

修好健康檢查後手動 `install` 新版腳本，結果那一秒正好 timer 觸發了部署——
檔案的 mtime 與部署開始時間同一秒。bash 是**邊讀邊執行**的，它已經開啟舊檔
並記住讀取位置，中途被覆寫就會讀到錯亂的內容：日誌顯示跑的仍是舊版健康檢查
（訊息格式對不上新版），於是又誤判失敗一次。

避免方式是**用 `mv` 而不是原地覆寫**——`mv` 是原子的，執行中的行程握著的是
舊的 inode，不受影響。腳本內建的自我更新已經是這個寫法（先寫 `.next` 再
`mv`）。手動安裝時如果剛好可能撞上排程，也該比照辦理，或先確認沒有部署在跑。

順帶一提：用 `pgrep -f "deploy-prod.sh"` 確認「有沒有部署在跑」會**誤中自己**
——那個字串就在 pgrep 自己的命令列裡。要用 `pgrep -f` 時記得排除自身，
或改看 `~/deploy/deploy.log` 的最後一行。

### 還沒做：對外公開

正式站目前**只綁 `127.0.0.1:3100`**，從本機開 tunnel 驗收：

```bash
ssh -N -L 3100:localhost:3100 dochuki
```

要真的讓手機在旅途中連得到，還缺三樣，見上面「對外公開網域＋HTTPS」章節：
網域、TLS 憑證與反向代理、以及**至少一層存取保護**。P2 裁示暫不做帳號系統，
沒有這層保護就開 Security List，等於誰有網址誰就能看／改行程與金額資料。
這是 `docker-compose.prod.yml` 把 app 綁在 loopback 而不是 `0.0.0.0` 的原因。

### 驗收紀錄（2026-09-07）

首次部署 `dfa04fb`：建 `dochuki-prod-app`（Next.js＋Chromium）與
`dochuki-prod-ocr-sidecar`（PaddleOCR）兩個映像約 5 分鐘，兩支 migration
（`20260824053527_init`、`20260901120000_remove_member_weight`）套用成功，
健康檢查通過。

**自動同步**（timer 那條路）：

| 時間 | 事件 |
|---|---|
| 14:19:53 | Mac mini `git push origin main`（`90ec6d9`） |
| 14:19:54 | VM 的 `sync.sh` 抓到 github/main 前進，觸發部署 |
| 14:19:59 | 部署完成，健康檢查通過；開發樹也快轉到同一個 commit |

**立即部署**（hook 那條路）：14:20:34 `git push prod main`（`d9153b3`），
14:20:38 部署完成，前後 4 秒，push 的輸出裡直接看得到部署過程。

**隔離驗證**：

```
dochuki-prod-app           127.0.0.1:3100->3000/tcp
dochuki-prod-db            5432/tcp（不對主機開）
dochuki-prod-ocr-sidecar   8000/tcp（不對主機開）
dochuki-db                 0.0.0.0:5442->5432/tcp   ← 開發那組，沒被動到
```

volume 也是分開的：`dochuki-prod_dochuki-pgdata` 與 `dochuki_dochuki-pgdata`
是兩份資料。整個建置與部署期間，開發站 `localhost:3000` 全程回 200。

**正式站的 DB 是全新的空庫**——只套 migration、不灌 seed。開發環境那份新潟團
fixture 不會跑過去，這對正式站是對的。真要把資料搬過去是另一件事，得自己
`pg_dump` / `pg_restore`。

**其他設備要接立即部署那條路**：

```bash
git remote add prod dochuki:/home/ubuntu/dochuki.git
```

用 `~/.ssh/config` 的 Host 別名，不要寫 `ssh://ubuntu@141.147.176.204/...`——
`ssh://` 開頭的 URL 不會套用 config 裡的 `IdentityFile`，會因為找不到金鑰而
`Permission denied`（這次實際踩到）。Windows 那台的 config 若沒有 `dochuki`
這個 Host，補一個再加 remote。

只用自動同步那條路的設備什麼都不用設定，照常 push GitHub 即可。
