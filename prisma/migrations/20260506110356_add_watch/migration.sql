-- CreateTable
CREATE TABLE "Watch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'KR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunAt" DATETIME,
    "lastRunStatus" TEXT,
    "lastRunNote" TEXT
);

-- CreateIndex
CREATE INDEX "Watch_active_idx" ON "Watch"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Watch_keyword_kind_region_key" ON "Watch"("keyword", "kind", "region");
