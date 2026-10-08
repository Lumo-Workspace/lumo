-- LUM-1044: MCP OAuth authorization server for self-hosted deployments
-- (AUTH_PROVIDER=better-auth): tables of Better Auth's `jwt` plugin and of
-- `@better-auth/oauth-provider`. Additive only: eight new tables, no change to
-- any existing table or row. The SaaS (Clerk) deployment never writes here.

-- CreateTable
CREATE TABLE "auth_jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "alg" TEXT,
    "crv" TEXT,

    CONSTRAINT "auth_jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_oauth_clients" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "clientDiscoveryId" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT[],
    "clientCredentialsScopes" TEXT[],
    "userId" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT[],
    "postLogoutRedirectUris" TEXT[],
    "backchannelLogoutUri" TEXT,
    "backchannelLogoutSessionRequired" BOOLEAN,
    "tokenEndpointAuthMethod" TEXT,
    "applicationType" TEXT,
    "jwks" TEXT,
    "jwksUri" TEXT,
    "grantTypes" TEXT[],
    "responseTypes" TEXT[],
    "requirePKCE" BOOLEAN,
    "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
    "referenceId" TEXT,
    "metadata" TEXT,

    CONSTRAINT "auth_oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_oauth_resources" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[],
    "customClaims" TEXT,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" TEXT,

    CONSTRAINT "auth_oauth_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_oauth_client_resources" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "auth_oauth_client_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[],
    "requestedUserInfoClaims" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "revoked" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "rotationReplayResponse" TEXT,
    "rotationReplayExpiresAt" TIMESTAMP(3),
    "authTime" TIMESTAMP(3),
    "confirmation" TEXT,
    "scopes" TEXT[],

    CONSTRAINT "auth_oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_oauth_access_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[],
    "requestedUserInfoClaims" TEXT[],
    "refreshId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "revoked" TIMESTAMP(3),
    "confirmation" TEXT,
    "scopes" TEXT[],

    CONSTRAINT "auth_oauth_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_oauth_consents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "referenceId" TEXT,
    "resources" TEXT[],
    "requestedUserInfoClaims" TEXT[],
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_oauth_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_oauth_client_assertions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_oauth_client_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_oauth_clients_clientId_key" ON "auth_oauth_clients"("clientId");

-- CreateIndex
CREATE INDEX "auth_oauth_clients_userId_idx" ON "auth_oauth_clients"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_oauth_resources_identifier_key" ON "auth_oauth_resources"("identifier");

-- CreateIndex
CREATE INDEX "auth_oauth_client_resources_clientId_idx" ON "auth_oauth_client_resources"("clientId");

-- CreateIndex
CREATE INDEX "auth_oauth_client_resources_resourceId_idx" ON "auth_oauth_client_resources"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_oauth_client_resources_clientId_resourceId_key" ON "auth_oauth_client_resources"("clientId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_oauth_refresh_tokens_token_key" ON "auth_oauth_refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "auth_oauth_refresh_tokens_clientId_idx" ON "auth_oauth_refresh_tokens"("clientId");

-- CreateIndex
CREATE INDEX "auth_oauth_refresh_tokens_sessionId_idx" ON "auth_oauth_refresh_tokens"("sessionId");

-- CreateIndex
CREATE INDEX "auth_oauth_refresh_tokens_userId_idx" ON "auth_oauth_refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "auth_oauth_refresh_tokens_authorizationCodeId_idx" ON "auth_oauth_refresh_tokens"("authorizationCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_oauth_access_tokens_token_key" ON "auth_oauth_access_tokens"("token");

-- CreateIndex
CREATE INDEX "auth_oauth_access_tokens_clientId_idx" ON "auth_oauth_access_tokens"("clientId");

-- CreateIndex
CREATE INDEX "auth_oauth_access_tokens_sessionId_idx" ON "auth_oauth_access_tokens"("sessionId");

-- CreateIndex
CREATE INDEX "auth_oauth_access_tokens_userId_idx" ON "auth_oauth_access_tokens"("userId");

-- CreateIndex
CREATE INDEX "auth_oauth_access_tokens_authorizationCodeId_idx" ON "auth_oauth_access_tokens"("authorizationCodeId");

-- CreateIndex
CREATE INDEX "auth_oauth_access_tokens_refreshId_idx" ON "auth_oauth_access_tokens"("refreshId");

-- CreateIndex
CREATE INDEX "auth_oauth_consents_clientId_idx" ON "auth_oauth_consents"("clientId");

-- CreateIndex
CREATE INDEX "auth_oauth_consents_userId_idx" ON "auth_oauth_consents"("userId");

-- AddForeignKey
ALTER TABLE "auth_oauth_clients" ADD CONSTRAINT "auth_oauth_clients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_client_resources" ADD CONSTRAINT "auth_oauth_client_resources_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "auth_oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_client_resources" ADD CONSTRAINT "auth_oauth_client_resources_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "auth_oauth_resources"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_refresh_tokens" ADD CONSTRAINT "auth_oauth_refresh_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "auth_oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_refresh_tokens" ADD CONSTRAINT "auth_oauth_refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_refresh_tokens" ADD CONSTRAINT "auth_oauth_refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_access_tokens" ADD CONSTRAINT "auth_oauth_access_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "auth_oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_access_tokens" ADD CONSTRAINT "auth_oauth_access_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_access_tokens" ADD CONSTRAINT "auth_oauth_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_access_tokens" ADD CONSTRAINT "auth_oauth_access_tokens_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "auth_oauth_refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_consents" ADD CONSTRAINT "auth_oauth_consents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "auth_oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_oauth_consents" ADD CONSTRAINT "auth_oauth_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

