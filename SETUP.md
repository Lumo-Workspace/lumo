# Environment Variables Setup Guide

## 1. Database Configuration

Your database is already configured with Prisma Postgres. The current setup is working.

## 2. Encryption Keys (Generated)

Use these generated encryption keys in your `.env` file:

```env
OAUTH_ENCRYPTION_KEY="jonaC870OQNzg7IACxFQ6mBf7pmueUw0YkTpk2a2ydk="
ACCESS_TOKEN_KEY="Zq9l4QI0ytbyGf+TQe+ytclNTiIX6S0kHuXqnfTQJhs="
REFRESH_TOKEN_KEY="DiMXD1jf07kOr1g0sCxO9EEpvJBNOnZYaQqK9IxlfCc="
```

## 3. Google OAuth Setup

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API (or Google Identity API)

### Step 2: Create OAuth 2.0 Credentials

1. Go to "Credentials" in the Google Cloud Console
2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
3. Set application type to "Web application"
4. Add authorized redirect URIs:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://yourdomain.com/api/auth/callback/google`

### Step 3: Get Your Credentials

Copy the Client ID and Client Secret to your `.env` file:

```env
GOOGLE_CLIENT_ID="your-google-client-id-here"
GOOGLE_CLIENT_SECRET="your-google-client-secret-here"
```

## 4. NextAuth Configuration

Generate a secure secret for NextAuth:

```bash
openssl rand -base64 32
```

Add to your `.env` file:

```env
NEXTAUTH_SECRET="your-generated-secret-here"
NEXTAUTH_URL="http://localhost:3000"  # Change to your domain in production
```

## 5. Vercel Blob Storage

### For Development (Local)

You can skip this for local development, but you'll need it for production.

### For Production (Vercel)

1. Go to your Vercel project dashboard
2. Go to "Storage" → "Create Database" → "Blob"
3. Copy the `BLOB_READ_WRITE_TOKEN` to your environment variables:

```env
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
```

## 6. Complete .env File Template

Create a `.env.local` file in your project root:

```env
# Database (already configured)
DATABASE_URL="prisma+postgres://localhost:51213/?api_key=..."

# NextAuth.js
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-generated-secret-here"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id-here"
GOOGLE_CLIENT_SECRET="your-google-client-secret-here"

# Encryption Keys (use the generated ones above)
OAUTH_ENCRYPTION_KEY="jonaC870OQNzg7IACxFQ6mBf7pmueUw0YkTpk2a2ydk="
ACCESS_TOKEN_KEY="Zq9l4QI0ytbyGf+TQe+ytclNTiIX6S0kHuXqnfTQJhs="
REFRESH_TOKEN_KEY="DiMXD1jf07kOr1g0sCxO9EEpvJBNOnZYaQqK9IxlfCc="

# Vercel Blob Storage (for production)
BLOB_READ_WRITE_TOKEN="your-vercel-blob-token-here"
```

## 7. Testing Your Setup

After setting up your environment variables:

1. **Restart your development server**:

   ```bash
   npm run dev
   ```

2. **Test Google OAuth**:
   - Go to `http://localhost:3000/login`
   - Click "Sign in with Google"
   - You should be redirected to Google's consent screen

3. **Test Database**:
   ```bash
   npx prisma studio
   ```
   This will open Prisma Studio to view your database.

## 8. Security Notes

- Never commit your `.env` or `.env.local` files to version control
- Use different credentials for development and production
- Rotate your encryption keys periodically
- Use strong, unique secrets for each environment

## Next Steps

Once you have your Google OAuth credentials:

1. Update your `.env` file with the real values
2. Test the authentication flow
3. Deploy to Vercel for production testing
