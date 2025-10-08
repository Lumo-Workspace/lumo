# Vercel Deployment Guide

## Pre-Deployment Checklist

- [x] ✅ Database schema synchronized with Prisma
- [x] ✅ Vercel Blob storage configured
- [x] ✅ Environment variables documented
- [x] ✅ All tests passing (97/97)
- [x] ✅ Build configuration ready

## Step 1: Deploy to Vercel

### Option A: Using the deployment script (Recommended)

```bash
./scripts/deploy.sh
```

### Option B: Manual deployment

```bash
# Build locally first
npm run build

# Deploy to Vercel
vercel --prod
```

## Step 2: Set up Environment Variables in Vercel

After deployment, configure these environment variables in your Vercel dashboard:

### Required Environment Variables

1. **NextAuth Configuration**

   ```
   NEXTAUTH_URL=https://your-app-name.vercel.app
   NEXTAUTH_SECRET=GDbmo+DgBIw6uSZ+6DJ5SHQKStFEF5s6epGh4yEtOAg=
   ```

2. **Google OAuth Credentials**

   ```
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   ```

3. **Encryption Keys**

   ```
   OAUTH_ENCRYPTION_KEY=jonaC870OQNzg7IACxFQ6mBf7pmueUw0YkTpk2a2ydk=
   ACCESS_TOKEN_KEY=Zq9l4QI0ytbyGf+TQe+ytclNTiIX6S0kHuXqnfTQJhs=
   REFRESH_TOKEN_KEY=DiMXD1jf07kOr1g0sCxO9EEpvJBNOnZYaQqK9IxlfCc=
   ```

4. **Database (Choose one option)**

   **Option A: Vercel Postgres (Recommended)**
   - Create a Postgres database in Vercel dashboard
   - Copy the connection string to `DATABASE_URL`

   **Option B: External Database**
   - Use your existing database connection string
   - Ensure it's accessible from Vercel

5. **Vercel Blob Storage**
   ```
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
   ```

## Step 3: Update Google OAuth Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to your OAuth 2.0 credentials
3. Update authorized redirect URIs:
   - Add: `https://your-app-name.vercel.app/api/auth/callback/google`
   - Remove: `http://localhost:3000/api/auth/callback/google` (if not needed)

## Step 4: Set up Database (if using Vercel Postgres)

```bash
# Pull environment variables locally
vercel env pull .env.local

# Push schema to production database
npx prisma db push

# Generate Prisma client
npx prisma generate
```

## Step 5: Test Your Deployment

1. **Visit your deployed URL**
2. **Test Google OAuth login**:
   - Click "Sign in with Google"
   - Complete the OAuth flow
   - Verify user creation and session management

3. **Test account linking**:
   - Go to `/settings`
   - Test linking/unlinking Google accounts

4. **Test file uploads**:
   - Try uploading avatars and documents
   - Verify files are stored in Vercel Blob

## Step 6: Domain Configuration (Optional)

If you have a custom domain:

1. Add your domain in Vercel dashboard
2. Update `NEXTAUTH_URL` to your custom domain
3. Update Google OAuth redirect URIs
4. Configure DNS records as instructed by Vercel

## Troubleshooting

### Common Issues

1. **"Can't reach database server"**
   - Check your DATABASE_URL
   - Ensure database is accessible from Vercel
   - Verify firewall settings

2. **Google OAuth errors**
   - Check redirect URIs match exactly
   - Verify client ID and secret
   - Ensure APIs are enabled in Google Cloud Console

3. **Environment variables not working**
   - Restart your Vercel deployment
   - Check variable names match exactly
   - Ensure no extra spaces or quotes

4. **File uploads failing**
   - Check BLOB_READ_WRITE_TOKEN
   - Verify Vercel Blob is enabled for your project

### Debug Commands

```bash
# Check deployment logs
vercel logs

# View environment variables
vercel env ls

# Test database connection
npx prisma db push --preview-feature
```

## Performance Optimization

1. **Enable Vercel Analytics** (optional)
2. **Set up caching headers** for static assets
3. **Optimize images** using Next.js Image component
4. **Monitor performance** with Vercel Analytics

## Security Checklist

- [ ] Environment variables are properly secured
- [ ] HTTPS is enforced (automatic with Vercel)
- [ ] CORS is properly configured
- [ ] Rate limiting is implemented
- [ ] Security headers are set (configured in vercel.json)

## Monitoring

1. **Vercel Analytics**: Monitor performance and usage
2. **Error Tracking**: Set up error monitoring (Sentry, etc.)
3. **Database Monitoring**: Monitor database performance
4. **Authentication Logs**: Monitor auth events

## Support

If you encounter issues:

1. Check Vercel deployment logs
2. Verify all environment variables are set
3. Test locally with production environment variables
4. Check Google OAuth configuration
5. Verify database connectivity

Your Lumo AI application with Google OAuth Login is now ready for production! 🎉
