/*
  Warnings:

  - Added the required column `accessKeyCipher` to the `LossLimit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token` to the `LossLimit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passkeyPublicKey` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LossLimit" ADD COLUMN     "accessKeyCipher" TEXT NOT NULL,
ADD COLUMN     "authorizedTx" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "token" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passkeyCounter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "passkeyPublicKey" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempoTransfer" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "token" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" DECIMAL(36,6) NOT NULL,
    "memo" TEXT NOT NULL,
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempoTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutMemo" (
    "memo" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutMemo_pkey" PRIMARY KEY ("memo")
);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_challenge_key" ON "AuthChallenge"("challenge");

-- CreateIndex
CREATE INDEX "TempoTransfer_memo_idx" ON "TempoTransfer"("memo");

-- CreateIndex
CREATE UNIQUE INDEX "TempoTransfer_txHash_logIndex_key" ON "TempoTransfer"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutMemo_settlementId_key" ON "PayoutMemo"("settlementId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
