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

## 之後要盯的 ARM 相容性風險（尚未驗證，先記下）

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

## 之後才做：對外公開網域＋HTTPS（P5 階段，現在不要做）

同事附件的指南有一大段是「申請網域（ClouDNS）→ Certbot／Let's Encrypt 簽 SSL
→ OCI Security List 開 80/443 → VM 內 ufw／iptables 也開 80/443 → nginx 反代」。
這套流程本身沒問題，記錄在這裡備用，**但現在先不要做**：

- 現在的目標是「遠端開發機」，只走 SSH tunnel，不需要對外開任何 port
- P2 裁示「暫不做帳號系統」——這台機器一旦掛上網域對外開放，任何人拿到網址
  就能看/改行程資料，公開前要先補一層存取保護（帳號或至少 Basic Auth）
- 這件事對應的是 PROMPTS.md 的 **P5「PWA 與收尾」**，等 P4 報表做完、真的要讓
  手機在旅途中直接連時再回頭做

備用清單（P5 再展開執行）：
```bash
sudo apt install certbot python3-certbot-nginx netfilter-persistent iptables-persistent -y
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
sudo certbot renew --dry-run   # 確認 90 天自動 renew 沒問題
```
搭配：OCI Security List 開 TCP 80/443（source 0.0.0.0/0）＋ `sudo ufw allow 'Nginx Full'`
＋ 檢查 VM 內 iptables 沒有把 80/443 擋下來（`sudo iptables -L -n -v`，卡住的話
`sudo iptables -I INPUT 1 -p tcp --dport <port> -j ACCEPT` 後
`sudo netfilter-persistent save` 存檔）。

## 進度追蹤

- [x] Phase A：Oracle VM 建立，拿到 Public IP（`141.147.176.204`，`fsc0638-dev`）
- [x] Phase B：Docker／Node／pnpm 裝好
- [x] Phase C：專案 clone＋`.env`＋DB migrate/seed，`pnpm test regression` 綠燈（17/17）
- [x] Phase D：SSH tunnel 連線驗證可用——2026-08-25 瀏覽器實測 `localhost:3001/trips`
      正確顯示新潟團 seed 資料，Gemini 金鑰、DB、tunnel 全線打通
- [x] macOS 第二台用戶端接入（2026-09-06，`ssh dochuki` 直連實測通過，見文末實錄）

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

- VM `~/.ssh/authorized_keys`：只有 Windows 那把 `oracle devbot tokyo`（未被動過）
- VM `~/.ssh/authorized_keys2`：Mac 那把 `oracle devbot mac`
- Mac 直連實測通過：`ssh dochuki` → `ubuntu@fsc0638-dev-vcn`，Ubuntu 24.04.4 LTS / aarch64
- Bastion `Bastion202609061805` 與其 session 已完成任務；Bastion 本身免費，留著可當下次換機器的備援，但 **CIDR allowlist 綁著當時的對外 IP，換網路（咖啡廳、手機熱點）就要回去改**

### 要再加第三台用戶端時

重跑上面 1→6 即可，但可以少踩坑：直接跳過 Run Command，從「啟用 Bastion 外掛」開始；金鑰一律寫 `authorized_keys2`（用 `>>` 附加，不要覆蓋）。或者更簡單——從任何一台**已經連得上**的機器執行：
```bash
ssh dochuki "cat >> ~/.ssh/authorized_keys2" < ~/.ssh/新機器的公鑰.pub
```
