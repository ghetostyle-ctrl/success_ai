/**
 * Next.js instrumentation hook — runs once per server start (PM2 reload,
 * cold boot, restart). We use it to clean up "stuck" jobs left behind by
 * the previous process: when PM2 restarts mid-scrape, the in-flight
 * Job/MetaJob rows stay at status="진행 중" / "in_progress" forever,
 * showing up in the UI as 5%-progress jobs that never finish.
 *
 * Strategy: on startup, transition every Job/MetaJob older than 30 min
 * still in an in-progress state to "실패" / "error" with a clear
 * errorMsg. The 30-min floor avoids racing legitimately running jobs.
 *
 * Why instrumentation vs cron: cron is async and brittle (might fail
 * silently), instrumentation guarantees the cleanup runs every time the
 * process boots and only the new process serves traffic. No drift.
 */
export async function register() {
  // Only run on the node server runtime — skip edge / build phases.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Dynamic import — prisma client pulls in heavy deps we don't want
  // evaluated during build introspection.
  const { prisma } = await import("./src/lib/db");

  async function cleanupStaleJobs(reason: string) {
    try {
      const cutoff = new Date(Date.now() - 30 * 60_000);
      const [adsResult, metaResult] = await Promise.all([
        prisma.job.updateMany({
          where: { status: "진행 중", createdAt: { lt: cutoff } },
          data: {
            status: "실패",
            errorMsg: `${reason} (30분+ 응답 없음, 자동 정리)`,
          },
        }),
        prisma.metaJob.updateMany({
          where: { status: "in_progress", createdAt: { lt: cutoff } },
          data: {
            status: "error",
            errorMsg: `${reason} (30분+ 응답 없음, 자동 정리)`,
          },
        }),
      ]);
      if (adsResult.count > 0 || metaResult.count > 0) {
        console.log(
          `[stale-jobs] cleaned: ${adsResult.count} ATC + ${metaResult.count} Meta (${reason})`
        );
      }
    } catch (e) {
      // Cleanup failure must not crash. Log and move on.
      console.error("[stale-jobs] cleanup failed:", e);
    }
  }

  // 1. Boot-time sweep — catches everything left behind by previous process.
  await cleanupStaleJobs("서버 재시작");

  // 2. Runtime sweep every 10 minutes — catches jobs that hang mid-flight
  // inside the current process (e.g. scraper deadlock, network hang past
  // curl --max-time). Without this, a job that wedges between two pages
  // sits at "진행 중" until the next PM2 reload, blocking the UI.
  setInterval(() => {
    void cleanupStaleJobs("타임아웃");
  }, 10 * 60_000);
}
