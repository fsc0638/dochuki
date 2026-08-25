import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { contentDispositionAttachment } from "@/lib/export/contentDisposition";
import { renderReportPdf } from "@/lib/export/pdf/render";
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
  const buffer = await renderReportPdf(data);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionAttachment(`${data.trip.name}-旅費結算總表.pdf`, "report.pdf"),
    },
  });
}
