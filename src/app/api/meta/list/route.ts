import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const jobs = await prisma.metaJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      keyword: true,
      region: true,
      status: true,
      adCount: true,
      pageCount: true,
      errorMsg: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ jobs });
}
