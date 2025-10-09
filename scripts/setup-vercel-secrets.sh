#!/bin/bash
# Script to add secrets to Vercel
# Run this with: bash scripts/setup-vercel-secrets.sh

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Setting up Vercel secrets...${NC}\n"

# Load environment variables from .env
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    exit 1
fi

source .env

# Add SUPA_POSTGRES_PRISMA_URL
if [ ! -z "$SUPA_POSTGRES_PRISMA_URL" ]; then
    echo -e "${GREEN}Adding supa_postgres_prisma_url...${NC}"
    vercel secrets add supa_postgres_prisma_url "$SUPA_POSTGRES_PRISMA_URL" --force
else
    echo "Warning: SUPA_POSTGRES_PRISMA_URL not found in .env"
fi

# Add SUPA_POSTGRES_URL_NON_POOLING
if [ ! -z "$SUPA_POSTGRES_URL_NON_POOLING" ]; then
    echo -e "${GREEN}Adding supa_postgres_url_non_pooling...${NC}"
    vercel secrets add supa_postgres_url_non_pooling "$SUPA_POSTGRES_URL_NON_POOLING" --force
else
    echo "Warning: SUPA_POSTGRES_URL_NON_POOLING not found in .env"
fi

# Add NEXTAUTH_SECRET
if [ ! -z "$NEXTAUTH_SECRET" ]; then
    echo -e "${GREEN}Adding nextauth_secret...${NC}"
    vercel secrets add nextauth_secret "$NEXTAUTH_SECRET" --force
else
    echo "Warning: NEXTAUTH_SECRET not found in .env"
fi

# Add NEXTAUTH_URL
if [ ! -z "$NEXTAUTH_URL" ]; then
    echo -e "${GREEN}Adding nextauth_url...${NC}"
    vercel secrets add nextauth_url "$NEXTAUTH_URL" --force
else
    echo "Warning: NEXTAUTH_URL not found in .env"
fi

# Add GOOGLE_CLIENT_ID
if [ ! -z "$GOOGLE_CLIENT_ID" ]; then
    echo -e "${GREEN}Adding google_client_id...${NC}"
    vercel secrets add google_client_id "$GOOGLE_CLIENT_ID" --force
else
    echo "Warning: GOOGLE_CLIENT_ID not found in .env"
fi

# Add GOOGLE_CLIENT_SECRET
if [ ! -z "$GOOGLE_CLIENT_SECRET" ]; then
    echo -e "${GREEN}Adding google_client_secret...${NC}"
    vercel secrets add google_client_secret "$GOOGLE_CLIENT_SECRET" --force
else
    echo "Warning: GOOGLE_CLIENT_SECRET not found in .env"
fi

# Add TOKEN_ENCRYPTION_KEY as oauth_encryption_key
if [ ! -z "$TOKEN_ENCRYPTION_KEY" ]; then
    echo -e "${GREEN}Adding oauth_encryption_key...${NC}"
    vercel secrets add oauth_encryption_key "$TOKEN_ENCRYPTION_KEY" --force
else
    echo "Warning: TOKEN_ENCRYPTION_KEY not found in .env"
fi

# For access_token_key and refresh_token_key, use TOKEN_ENCRYPTION_KEY if not separately defined
if [ ! -z "$TOKEN_ENCRYPTION_KEY" ]; then
    echo -e "${GREEN}Adding access_token_key...${NC}"
    vercel secrets add access_token_key "$TOKEN_ENCRYPTION_KEY" --force
    
    echo -e "${GREEN}Adding refresh_token_key...${NC}"
    vercel secrets add refresh_token_key "$TOKEN_ENCRYPTION_KEY" --force
fi

# Add BLOB_READ_WRITE_TOKEN
if [ ! -z "$BLOB_READ_WRITE_TOKEN" ]; then
    echo -e "${GREEN}Adding blob_read_write_token...${NC}"
    vercel secrets add blob_read_write_token "$BLOB_READ_WRITE_TOKEN" --force
else
    echo "Warning: BLOB_READ_WRITE_TOKEN not found in .env"
fi

echo -e "\n${GREEN}✅ Vercel secrets setup complete!${NC}"
echo -e "\nYou can now run: ${YELLOW}vercel deploy${NC}"
