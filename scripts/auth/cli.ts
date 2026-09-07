import "dotenv/config";
import { createInterface } from "node:readline";
import { stdin, stdout, argv, exit } from "node:process";
import { prisma } from "../../src/lib/db";
import { createSession } from "../../src/lib/auth/session";
import { adoptOrphanTrips, authenticate, createPasswordUser } from "../../src/lib/auth/users";
import { SignupSchema } from "../../src/lib/schemas/auth";

/**
 * 帳號系統的維運指令（P7.1）。
 *
 * 密碼一律從終端機當場輸入、不回顯，不接受命令列參數——參數會留在 shell
 * history 與 process list 裡（跟 docs/CLOUD_SETUP.md 對 PAT 的原則一致）。
 *
 *   pnpm auth bootstrap            建立第一個管理者帳號，並收編所有既有行程
 *   pnpm auth create-user          只建立帳號
 *   pnpm auth issue-session        以 email＋密碼換一組 session token（驗收用）
 *   pnpm auth whoami <token>       驗證 token 並印出對應帳號
 */

/**
 * 輸入來源分兩種，因為 readline 在管線輸入下行為完全不同。
 *
 * 終端機：用 readline 逐題問，密碼那題要把 stdout 的 write 暫時換掉擋住回顯。
 *
 * 管線（`printf ... | pnpm auth create-user`）：**不能用 readline**。
 * `terminal: false` 時它會把整份輸入一口氣讀完並同步發出所有 line 事件，
 * 而 `question()` 只接得住「註冊當下的下一行」——第三題還沒問，第三、四行
 * 就已經被丟掉了，接著 stdin EOF 讓 readline 關閉，pending 的 callback
 * 永遠不會觸發，行程安靜地以 exit 0 結束。實測就是停在「顯示名稱：」不動。
 * 所以管線模式改成先把 stdin 讀完切成行，再逐題從佇列取。
 */
let queued: string[] | null = null;
let queueIndex = 0;
let sharedRl: ReturnType<typeof createInterface> | null = null;

async function nextQueuedLine(): Promise<string> {
  if (queued === null) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    queued = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  }
  return queued[queueIndex++] ?? "";
}

function closeRl(): void {
  sharedRl?.close();
  sharedRl = null;
}

async function ask(question: string): Promise<string> {
  if (stdin.isTTY !== true) {
    stdout.write(question);
    const line = await nextQueuedLine();
    stdout.write("\n");
    return line.trim();
  }
  sharedRl ??= createInterface({ input: stdin, output: stdout, terminal: true });
  const rl = sharedRl;
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/** 讀密碼但不回顯。管線輸入沒有回顯這回事，直接走 ask 即可。 */
async function askSecret(question: string): Promise<string> {
  if (stdin.isTTY !== true) {
    stdout.write(question);
    const line = await nextQueuedLine();
    stdout.write("\n");
    return line;
  }
  sharedRl ??= createInterface({ input: stdin, output: stdout, terminal: true });
  const rl = sharedRl;
  return new Promise((resolve) => {
    const output = stdout as unknown as { write: (chunk: string) => boolean };
    const original = output.write.bind(stdout);
    let muted = false;
    output.write = (chunk: string): boolean => (muted ? true : original(chunk));

    rl.question(question, (answer) => {
      output.write = original;
      original("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function promptNewAccount(): Promise<{ email: string; password: string; displayName: string }> {
  const email = await ask("電子郵件：");
  const displayName = await ask("顯示名稱：");
  const password = await askSecret("密碼（不會顯示）：");
  const again = await askSecret("再輸入一次：");
  if (password !== again) {
    throw new Error("兩次輸入的密碼不一致");
  }
  const parsed = SignupSchema.safeParse({ email, password, displayName });
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => `  - ${issue.message}`).join("\n");
    throw new Error(`輸入不符合規則：\n${messages}`);
  }
  return parsed.data;
}

async function cmdCreateUser(): Promise<void> {
  const input = await promptNewAccount();
  const user = await createPasswordUser(input);
  console.log(`\n已建立帳號 ${input.email}（id: ${user.id}）`);
}

async function cmdBootstrap(): Promise<void> {
  const input = await promptNewAccount();
  const user = await createPasswordUser(input);
  console.log(`\n已建立帳號 ${input.email}（id: ${user.id}）`);

  const adopted = await adoptOrphanTrips(user.id);
  if (adopted.length === 0) {
    console.log("沒有找到無人擁有的行程，不需要收編。");
  } else {
    console.log(`已收編 ${adopted.length} 個既有行程為 OWNER：`);
    for (const name of adopted) console.log(`  - ${name}`);
  }
}

async function cmdIssueSession(): Promise<void> {
  const email = (await ask("電子郵件：")).toLowerCase();
  const password = await askSecret("密碼（不會顯示）：");
  const result = await authenticate(email, password);
  if ("failure" in result) {
    throw new Error(
      result.failure === "locked"
        ? "登入嘗試次數過多，此帳號暫時鎖定，請稍後再試"
        : "帳號或密碼錯誤",
    );
  }
  const { token, expiresAt } = await createSession(result.user.id, "dochuki-cli");
  console.log("\nsession token（只會顯示這一次）：");
  console.log(token);
  console.log(`到期：${expiresAt.toISOString()}`);
}

async function cmdWhoami(token: string | undefined): Promise<void> {
  if (token === undefined || token === "") {
    throw new Error("用法：pnpm auth whoami <token>");
  }
  // 動態載入：verifySessionToken 會寫 lastSeenAt，放在這裡讓上面的指令
  // 不必為了型別而一起把它拉進來
  const { verifySessionToken } = await import("../../src/lib/auth/session");
  const result = await verifySessionToken(token);
  if (result === null) {
    console.log("token 無效或已過期");
    exit(1);
  }
  console.log(`${result.user.displayName} <${result.user.email ?? "（無 email）"}>`);
  console.log(`user id: ${result.user.id}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = argv.slice(2);
  switch (command) {
    case "bootstrap":
      await cmdBootstrap();
      break;
    case "create-user":
      await cmdCreateUser();
      break;
    case "issue-session":
      await cmdIssueSession();
      break;
    case "whoami":
      await cmdWhoami(rest[0]);
      break;
    default:
      console.log("用法：pnpm auth <bootstrap|create-user|issue-session|whoami>");
      exit(1);
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  })
  .finally(() => {
    closeRl();
    void prisma.$disconnect();
  });
