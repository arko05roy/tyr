-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "error" TEXT,
ADD COLUMN     "escrowTx" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "solanaOpenTx" TEXT,
ADD COLUMN     "stakeSalt" TEXT,
ADD COLUMN     "stakeUsd" DECIMAL(18,6),
ADD COLUMN     "step" TEXT NOT NULL DEFAULT 'created',
ADD COLUMN     "tempoStakeTx" TEXT;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "closeOrderId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "escrowPayTx" TEXT,
ADD COLUMN     "payoutSalt" TEXT,
ADD COLUMN     "payoutUsd" DECIMAL(18,6) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

