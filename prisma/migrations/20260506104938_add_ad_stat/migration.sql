-- CreateTable
CREATE TABLE "AdStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creativeId" TEXT NOT NULL,
    "capturedDate" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    CONSTRAINT "AdStat_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Ad" ("creativeId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AdStat_creativeId_idx" ON "AdStat"("creativeId");

-- CreateIndex
CREATE INDEX "AdStat_capturedDate_idx" ON "AdStat"("capturedDate");

-- CreateIndex
CREATE UNIQUE INDEX "AdStat_creativeId_capturedDate_key" ON "AdStat"("creativeId", "capturedDate");
