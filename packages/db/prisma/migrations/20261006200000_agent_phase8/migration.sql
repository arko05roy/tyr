-- AlterTable
ALTER TABLE "AgentSession" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "period" "LimitPeriod" NOT NULL DEFAULT 'day',
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "agentSessionId" TEXT;

-- CreateTable
CREATE TABLE "AgentCharge" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "amountUsd" DECIMAL(18,6) NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCharge_txHash_key" ON "AgentCharge"("txHash");

-- CreateIndex
CREATE INDEX "AgentCharge_sessionId_idx" ON "AgentCharge"("sessionId");

-- CreateIndex
CREATE INDEX "AgentSession_ownerId_idx" ON "AgentSession"("ownerId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCharge" ADD CONSTRAINT "AgentCharge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
