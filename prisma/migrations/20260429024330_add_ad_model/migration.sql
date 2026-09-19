-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "advertiserId" TEXT NOT NULL,
    "advertiserName" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'KR',
    "firstSeen" TEXT,
    "lastSeen" TEXT,
    "previewUrl" TEXT,
    "imageHtml" TEXT,
    "obfuscatedCustomerId" TEXT,
    "keyword" TEXT NOT NULL,
    "jobId" TEXT,
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ad_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMsg" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "adCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Job" ("createdAt", "errorMsg", "id", "keyword", "resultCount", "status", "updatedAt") SELECT "createdAt", "errorMsg", "id", "keyword", "resultCount", "status", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Ad_creativeId_key" ON "Ad"("creativeId");

-- CreateIndex
CREATE INDEX "Ad_advertiserId_idx" ON "Ad"("advertiserId");

-- CreateIndex
CREATE INDEX "Ad_keyword_idx" ON "Ad"("keyword");

-- CreateIndex
CREATE INDEX "Ad_savedAt_idx" ON "Ad"("savedAt");
