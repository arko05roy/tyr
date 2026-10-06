-- AlterTable
ALTER TABLE "ZcashOrder" ADD COLUMN     "error" TEXT,
ADD COLUMN     "excessZat" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "frostSig" TEXT,
ADD COLUMN     "frostSigners" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "nonce" TEXT,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "payoutTxid" TEXT,
ADD COLUMN     "payoutZat" BIGINT,
ADD COLUMN     "rateSource" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "valueZat" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "zecUsd" DECIMAL(18,6);

-- CreateIndex
CREATE UNIQUE INDEX "ZcashOrder_orderId_key" ON "ZcashOrder"("orderId");

-- AddForeignKey
ALTER TABLE "ZcashOrder" ADD CONSTRAINT "ZcashOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

