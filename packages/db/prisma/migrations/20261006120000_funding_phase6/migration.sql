-- DropIndex
DROP INDEX "Deposit_sourceChain_sourceTx_key";

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "asset" TEXT NOT NULL DEFAULT 'USDC',
ADD COLUMN     "creditedAt" TIMESTAMP(3),
ADD COLUMN     "fxRate" DECIMAL(36,8),
ADD COLUMN     "fxRound" TEXT,
ADD COLUMN     "logIndex" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "mintTx" TEXT,
ADD COLUMN     "rawAmount" TEXT;

-- CreateTable
CREATE TABLE "DepositAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "hdIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanCursor" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanCursor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddress_hdIndex_key" ON "DepositAddress"("hdIndex");

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddress_userId_chain_key" ON "DepositAddress"("userId", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddress_chain_address_key" ON "DepositAddress"("chain", "address");

-- CreateIndex
CREATE INDEX "Deposit_status_idx" ON "Deposit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_sourceChain_sourceTx_logIndex_key" ON "Deposit"("sourceChain", "sourceTx", "logIndex");

-- AddForeignKey
ALTER TABLE "DepositAddress" ADD CONSTRAINT "DepositAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

