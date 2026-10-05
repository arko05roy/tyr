-- CreateEnum
CREATE TYPE "LimitPeriod" AS ENUM ('day', 'week');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('yes', 'no');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('private', 'public');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tempoAddress" TEXT NOT NULL,
    "passkeyCredentialId" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" "LimitPeriod" NOT NULL,
    "amountUsd" DECIMAL(18,6) NOT NULL,
    "tempoAccessKeyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LossLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidentialAccount" (
    "userId" TEXT NOT NULL,
    "solanaTokenAccount" TEXT NOT NULL,
    "elgamalPubkey" TEXT NOT NULL,
    "aeKeyRef" TEXT NOT NULL,

    CONSTRAINT "ConfidentialAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceChain" TEXT NOT NULL,
    "sourceTx" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "status" TEXT NOT NULL,
    "solanaTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZcashOrder" (
    "id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "memoRaw" BYTEA NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "size" DECIMAL(36,8) NOT NULL,
    "returnAddr" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZcashOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hlMarket" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "size" DECIMAL(36,8) NOT NULL,
    "price" DECIMAL(36,8) NOT NULL,
    "hlOid" BIGINT,
    "builderFee" DECIMAL(36,8),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "orderId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "pnl" DECIMAL(36,8) NOT NULL,
    "solanaTx" TEXT,
    "tempoPayoutTx" TEXT,
    "memoHash" TEXT,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "Hedge" (
    "orderId" TEXT NOT NULL,
    "stockToken" TEXT NOT NULL,
    "amountIn" DECIMAL(36,18) NOT NULL,
    "amountOut" DECIMAL(36,18) NOT NULL,
    "uniswapTx" TEXT NOT NULL,
    "chainlinkRound" TEXT NOT NULL,

    CONSTRAINT "Hedge_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "agentPubkey" TEXT NOT NULL,
    "capUsd" DECIMAL(18,6) NOT NULL,
    "spentUsd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "tempoSessionId" TEXT,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "proofRef" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tempoAddress_key" ON "User"("tempoAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_passkeyCredentialId_key" ON "User"("passkeyCredentialId");

-- CreateIndex
CREATE INDEX "LossLimit_userId_idx" ON "LossLimit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfidentialAccount_solanaTokenAccount_key" ON "ConfidentialAccount"("solanaTokenAccount");

-- CreateIndex
CREATE INDEX "Deposit_userId_idx" ON "Deposit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_sourceChain_sourceTx_key" ON "Deposit"("sourceChain", "sourceTx");

-- CreateIndex
CREATE UNIQUE INDEX "ZcashOrder_txid_key" ON "ZcashOrder"("txid");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_memoHash_key" ON "Settlement"("memoHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSession_agentPubkey_key" ON "AgentSession"("agentPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_payloadHash_key" ON "Receipt"("payloadHash");

-- AddForeignKey
ALTER TABLE "LossLimit" ADD CONSTRAINT "LossLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialAccount" ADD CONSTRAINT "ConfidentialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hedge" ADD CONSTRAINT "Hedge_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
