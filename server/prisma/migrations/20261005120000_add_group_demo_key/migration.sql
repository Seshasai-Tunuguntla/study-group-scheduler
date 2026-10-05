-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "demoKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Group_demoKey_key" ON "Group"("demoKey");

