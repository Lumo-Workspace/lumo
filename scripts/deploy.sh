#!/bin/bash

# Deployment script for Lumo AI with Google OAuth Login
echo "🚀 Starting Lumo AI deployment to Vercel..."

# Check if user is logged in to Vercel
if ! vercel whoami > /dev/null 2>&1; then
    echo "❌ Please log in to Vercel first:"
    echo "   vercel login"
    exit 1
fi

# Build the project locally first to check for errors
echo "🔨 Building project locally..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please fix the errors before deploying."
    exit 1
fi

echo "✅ Local build successful!"

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

if [ $? -eq 0 ]; then
    echo "✅ Deployment successful!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Set up your environment variables in Vercel dashboard:"
    echo "   - Go to your project settings"
    echo "   - Add environment variables from your .env file"
    echo "   - Make sure to set NEXTAUTH_URL to your production domain"
    echo ""
    echo "2. Set up Google OAuth:"
    echo "   - Update your Google Cloud Console OAuth redirect URI"
    echo "   - Add your Vercel domain to authorized redirect URIs"
    echo ""
    echo "3. Set up database (if using Vercel Postgres):"
    echo "   - Create a Postgres database in Vercel"
    echo "   - Update SUPA_POSTGRES_PRISMA_URL environment variable"
    echo "   - Run: vercel env pull .env.local"
    echo "   - Run: npx prisma db push"
    echo ""
    echo "4. Test your deployment:"
    echo "   - Visit your deployed URL"
    echo "   - Test Google OAuth login"
    echo "   - Verify all features work correctly"
else
    echo "❌ Deployment failed. Check the error messages above."
    exit 1
fi
