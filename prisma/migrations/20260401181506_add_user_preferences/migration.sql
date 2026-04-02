-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'auto',
    "notifyInAppAssigned" BOOLEAN NOT NULL DEFAULT true,
    "notifyInAppComment" BOOLEAN NOT NULL DEFAULT true,
    "notifyInAppAgentDone" BOOLEAN NOT NULL DEFAULT true,
    "notifyInAppAgentInput" BOOLEAN NOT NULL DEFAULT true,
    "notifyInAppMention" BOOLEAN NOT NULL DEFAULT true,
    "notifySlackAssigned" BOOLEAN NOT NULL DEFAULT true,
    "notifySlackComment" BOOLEAN NOT NULL DEFAULT true,
    "notifySlackAgentDone" BOOLEAN NOT NULL DEFAULT true,
    "notifySlackAgentInput" BOOLEAN NOT NULL DEFAULT true,
    "notifySlackMention" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_memberId_key" ON "user_preferences"("memberId");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
