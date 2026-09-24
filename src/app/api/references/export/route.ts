import { prisma } from "@/lib/db";
import { exportSelectedReferences } from "@/lib/reference-export";
import { parseReferenceSelection, ReferenceExportError } from "@/lib/reference-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const selection = parseReferenceSelection(new URL(request.url).searchParams);
    const payload = await exportSelectedReferences(prisma, selection);
    return Response.json(payload, { headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="success-ai-references.json"',
    } });
  } catch (error) {
    if (error instanceof ReferenceExportError) {
      return Response.json({ error: error.message }, { status: error.status,
        headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}
