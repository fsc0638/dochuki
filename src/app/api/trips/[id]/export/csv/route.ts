import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { contentDispositionAttachment } from "@/lib/export/contentDisposition";
import { buildExpenseDetailCsv } from "@/lib/export/csv";
import { loadReportData } from "@/lib/trips/report";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (trip === null) {
    return NextResponse.json({ error: "行程不存在" }, { status: 404 });
  }
  const data = await loadReportData(id);
  const csv = buildExpenseDetailCsv(data);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(`${data.trip.name}-明細.csv`, "expenses.csv"),
    },
  });
}
