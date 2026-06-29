#!/bin/bash

# Preview Deployment Setup Script
# This script helps you set up preview deployments for pull requests

set -e

echo "🚀 Predinex Preview Deployment Setup"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if running in the correct directory
if [ ! -f "README.md" ] || [ ! -d "web" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

echo -e "${BLUE}This script will guide you through setting up preview deployments.${NC}"
echo ""
echo "Prerequisites:"
echo "  ✓ Vercel account (free tier works)"
echo "  ✓ Admin access to GitHub repository"
echo "  ✓ 5 minutes of your time"
echo ""

read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

# Step 1: Vercel Project
echo -e "${YELLOW}Step 1: Vercel Project Setup${NC}"
echo "----------------------------"
echo ""
echo "1. Go to https://vercel.com and sign in"
echo "2. Click 'Add New...' → 'Project'"
echo "3. Import your GitHub repository"
echo "4. Configure:"
echo "   - Root Directory: web"
echo "   - Framework: Next.js"
echo "5. Click 'Deploy'"
echo ""
read -p "Have you created the Vercel project? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Please create the Vercel project first, then run this script again.${NC}"
    exit 1
fi

# Step 2: Get Vercel Credentials
echo ""
echo -e "${YELLOW}Step 2: Get Vercel Credentials${NC}"
echo "-------------------------------"
echo ""
echo "We need three values from Vercel:"
echo ""

read -p "Enter your Vercel Project ID: " VERCEL_PROJECT_ID
read -p "Enter your Vercel Org ID: " VERCEL_ORG_ID
read -p "Enter your Vercel Token: " VERCEL_TOKEN

if [ -z "$VERCEL_PROJECT_ID" ] || [ -z "$VERCEL_ORG_ID" ] || [ -z "$VERCEL_TOKEN" ]; then
    echo -e "${RED}Error: All three values are required${NC}"
    exit 1
fi

# Step 3: GitHub Secrets
echo ""
echo -e "${YELLOW}Step 3: Configure GitHub Secrets${NC}"
echo "---------------------------------"
echo ""
echo "You need to add these secrets to your GitHub repository:"
echo ""
echo "Repository → Settings → Secrets and variables → Actions"
echo ""
echo -e "${GREEN}VERCEL_TOKEN${NC}=${VERCEL_TOKEN}"
echo -e "${GREEN}VERCEL_ORG_ID${NC}=${VERCEL_ORG_ID}"
echo -e "${GREEN}VERCEL_PROJECT_ID${NC}=${VERCEL_PROJECT_ID}"
echo ""
echo "Copy these values and add them as repository secrets."
echo ""
read -p "Have you added the GitHub secrets? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Please add the secrets, then continue with the setup.${NC}"
    exit 0
fi

# Step 4: Vercel Environment Variables
echo ""
echo -e "${YELLOW}Step 4: Configure Vercel Environment Variables${NC}"
echo "-----------------------------------------------"
echo ""
echo "In your Vercel project settings, add these environment variables"
echo "for the 'Preview' environment:"
echo ""
echo -e "${GREEN}NEXT_PUBLIC_NETWORK${NC}=testnet"
echo -e "${GREEN}NEXT_PUBLIC_STACKS_API_URL${NC}=https://api.testnet.hiro.so"
echo ""
echo "Optional (but recommended):"
echo -e "${GREEN}NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID${NC}=<your-walletconnect-id>"
echo ""
read -p "Have you configured the environment variables? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Please configure the environment variables in Vercel.${NC}"
    exit 0
fi

# Step 5: Test
echo ""
echo -e "${YELLOW}Step 5: Test the Setup${NC}"
echo "----------------------"
echo ""
echo "To test your preview deployment setup:"
echo ""
echo "1. Create a test branch:"
echo "   git checkout -b test-preview-deployment"
echo ""
echo "2. Make a small change to the web app:"
echo "   echo '// Test preview' >> web/app/page.tsx"
echo ""
echo "3. Commit and push:"
echo "   git add web/app/page.tsx"
echo "   git commit -m 'test: preview deployment'"
echo "   git push origin test-preview-deployment"
echo ""
echo "4. Create a pull request on GitHub"
echo ""
echo "5. Wait ~2 minutes for the preview deployment"
echo ""
echo "6. Check the PR for a comment with the preview URL"
echo ""

# Summary
echo ""
echo -e "${GREEN}✓ Setup Complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Test the preview deployment with a PR"
echo "  2. Review the documentation: docs/preview-deployments.md"
echo "  3. Share the preview URLs with your team"
echo ""
echo "Troubleshooting:"
echo "  - Check GitHub Actions logs if deployment fails"
echo "  - Verify secrets are correctly configured"
echo "  - Review docs/preview-deployments.md"
echo ""
echo -e "${BLUE}Happy deploying! 🚀${NC}"
