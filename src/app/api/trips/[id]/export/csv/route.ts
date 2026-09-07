import { NextResponse, type NextRequest } from "next/server";
import { guardRoute } from "@/lib/auth/guard";
import { contentDispositionAttachment } from "@/lib/export/contentDisposition";
import { buildExpenseDetailCsv } from "@/lib/export/csv";
import { loadReportData } from "@/lib/trips/report";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // P7.4：守門取代原本的存在性檢查。沒權限與不存在回一樣的 404，
  // 不讓人拿 cuid 探測哪些行程存在
  const guard = await guardRoute(id, "VIEWER");
  if (!guard.ok) return guard.response;
  const data = await loadReportData(id);
  const csv = buildExpenseDetailCsv(data);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(`${data.trip.name}-明細.csv`, "expenses.csv"),
    },
  });
}
