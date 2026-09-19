-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ad',
    "status" TEXT NOT NULL,
    "errorMsg" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "adCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Job" ("adCount", "createdAt", "errorMsg", "id", "keyword", "resultCount", "status", "updatedAt") SELECT "adCount", "createdAt", "errorMsg", "id", "keyword", "resultCount", "status", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");
CREATE INDEX "Job_kind_idx" ON "Job"("kind");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
