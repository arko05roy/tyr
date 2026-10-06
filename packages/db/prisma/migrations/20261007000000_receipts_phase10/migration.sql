-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "payload" JSONB,
ADD COLUMN     "proof" JSONB,
ADD COLUMN     "subjectId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_userId_idx" ON "Receipt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_kind_subjectId_key" ON "Receipt"("kind", "subjectId");

