-- Phase 11b: orders reference a venue market id; hlMarket stays for HL orders only.
ALTER TABLE "Order" ADD COLUMN "marketId" TEXT;
UPDATE "Order" SET "marketId" = 'hyperliquid:' || "hlMarket";
ALTER TABLE "Order" ALTER COLUMN "marketId" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "hlMarket" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "routeKey" TEXT;

-- CreateIndex
CREATE INDEX "Order_routeKey_idx" ON "Order"("routeKey");
