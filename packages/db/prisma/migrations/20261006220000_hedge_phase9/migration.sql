-- AlterTable
ALTER TABLE "Hedge" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "direction" TEXT NOT NULL,
ADD COLUMN     "entryPx" DECIMAL(36,8) NOT NULL,
ADD COLUMN     "escrowTopUpTx" TEXT,
ADD COLUMN     "escrowTx" TEXT,
ADD COLUMN     "exitPx" DECIMAL(36,8),
ADD COLUMN     "payTx" TEXT,
ADD COLUMN     "priceAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "priceSource" TEXT NOT NULL,
ADD COLUMN     "receiptId" TEXT,
ADD COLUMN     "receiptTx" TEXT,
ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "symbol" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ADD COLUMN     "valueUsd" DECIMAL(18,6),
ALTER COLUMN "uniswapTx" DROP NOT NULL,
ALTER COLUMN "chainlinkRound" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Hedge_receiptId_key" ON "Hedge"("receiptId");

