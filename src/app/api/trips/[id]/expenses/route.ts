import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { toErrorMessage } from "@/lib/actionState";
import { ExpenseFormSchema } from "@/lib/schemas/expense";
import { createExpense } from "@/lib/trips/write";

/**
 * 離線佇列補送專用端點——`createExpenseAction`（Server Action）沒辦法被
 * Service Worker 攔截重放（SW 沒有 React 執行環境），需要一支真正的 HTTP
 * endpoint。線上的正常送出路徑完全不走這裡，還是原本的 Server Action，
 * 這支只服務 `src/lib/offline/outbox.ts` 的 `syncOutbox()`。
 *
 * 不支援 receiptId／拍照收據——離線新增本來就只能手動輸入，見
 * ExpenseForm.tsx 的離線分支。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const parsed = ExpenseFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "請檢查輸入內容", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  if (parsed.data.tripId !== id) {
    return NextResponse.json({ error: "行程 ID 不符" }, { status: 400 });
  }

  try {
    const expense = await createExpense(parsed.data);
    revalidatePath(`/trips/${id}`);
    return NextResponse.json({ id: expense.id });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
