-- LUM-1027: Better Auth identity tables for self-hosted deployments
-- (AUTH_PROVIDER=better-auth). Additive only: four new tables, no change to
-- any existing table or row. The SaaS (Clerk) deployment never writes here.

-- CreateTable
CREATE TABLE "auth_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_email_key" ON "auth_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "auth_sessions"("token");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts"("userId");

-- CreateIndex
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications"("identifier");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
