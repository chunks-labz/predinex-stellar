# Preview Deployments

This document describes how preview deployments work for pull requests and how to configure them.

## Overview

Preview deployments automatically create a live, temporary deployment of the web application for each pull request. This allows reviewers to:

- Test UI changes in a real environment
- Verify functionality without running the app locally
- Share a live link with stakeholders for feedback
- Catch integration issues before merging

## How It Works

1. **Trigger**: When a PR is opened or updated with changes to the `web/` directory
2. **Build**: The workflow builds the Next.js application
3. **Deploy**: Deploys to Vercel as a preview environment
4. **Comment**: Posts the preview URL as a comment on the PR
5. **Update**: Subsequent pushes update the same preview deployment

## Setup Instructions

### Prerequisites

- A Vercel account (free tier works)
- Admin access to the GitHub repository

### Step 1: Create a Vercel Project

1. Go to [Vercel](https://vercel.com) and sign in
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
5. **Important**: Do NOT enable automatic deployments (we'll use GitHub Actions instead)

### Step 2: Get Vercel Credentials

1. Go to your Vercel project settings
2. Navigate to "Settings" → "General"
3. Copy the following values:
   - **Project ID**: Found in project settings
   - **Org ID**: Found in team/account settings
4. Create a Vercel token:
   - Go to [Account Settings → Tokens](https://vercel.com/account/tokens)
   - Click "Create Token"
   - Name it "GitHub Actions Preview Deployments"
   - Copy the token (you won't see it again)

### Step 3: Configure GitHub Secrets

Add the following secrets to your GitHub repository:

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret" and add:

| Secret Name | Description | Where to Find |
|-------------|-------------|---------------|
| `VERCEL_TOKEN` | Vercel authentication token | Created in Step 2 |
| `VERCEL_ORG_ID` | Your Vercel organization ID | Vercel project settings |
| `VERCEL_PROJECT_ID` | Your Vercel project ID | Vercel project settings |

### Step 4: Configure Environment Variables in Vercel

Set up environment variables for preview deployments:

1. Go to your Vercel project → Settings → Environment Variables
2. Add the following variables for **Preview** environment:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_NETWORK` | `testnet` | Use testnet for previews |
| `NEXT_PUBLIC_APP_URL` | (auto-set by Vercel) | Preview URL |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Your WalletConnect ID | Optional but recommended |
| `NEXT_PUBLIC_STACKS_API_URL` | `https://api.testnet.hiro.so` | Testnet API |
| `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` | Your testnet contract ID | If using Stellar |

**Security Note**: Never add production secrets or mainnet configurations to preview environments.

## Usage

### For Contributors

1. Create a pull request with your changes
2. Wait for the preview deployment workflow to complete (~2-3 minutes)
3. Find the preview URL in the PR comment
4. Share the URL with reviewers

### For Reviewers

1. Open the pull request
2. Look for the "🚀 Preview Deployment" comment
3. Click the preview URL to test the changes
4. Provide feedback on the PR

## Workflow Details

### Trigger Conditions

The preview deployment workflow runs when:
- A PR is opened targeting the `main` branch
- New commits are pushed to an open PR
- Changes affect files in the `web/` directory

### Concurrency

- Only one preview deployment runs per PR at a time
- New commits cancel in-progress deployments
- Each PR gets its own isolated preview environment

### Cleanup

Preview deployments are automatically deleted when:
- The PR is merged
- The PR is closed
- After 30 days of inactivity (Vercel default)

## Troubleshooting

### Deployment Fails with "Vercel Token Invalid"

**Solution**: Regenerate your Vercel token and update the `VERCEL_TOKEN` secret in GitHub.

### Preview Shows Wrong Network

**Solution**: Check environment variables in Vercel project settings. Ensure `NEXT_PUBLIC_NETWORK=testnet` is set for preview environment.

### Build Fails with Missing Dependencies

**Solution**: 
1. Ensure `package-lock.json` is committed
2. Check that all dependencies are in `package.json`
3. Review build logs in the GitHub Actions tab

### Preview URL Not Posted to PR

**Solution**: 
1. Verify the GitHub Actions bot has write permissions
2. Check workflow permissions in repository settings
3. Review the workflow run logs for errors

### Environment Variables Not Working

**Solution**:
1. Verify variables are set in Vercel for the "Preview" environment
2. Ensure variable names start with `NEXT_PUBLIC_` for client-side access
3. Redeploy the preview after updating variables

## Alternative Deployment Platforms

While this setup uses Vercel, you can adapt the workflow for other platforms:

### Netlify

Replace the Vercel steps with:
```yaml
- name: Deploy to Netlify
  uses: nwtgck/actions-netlify@v2.0
  with:
    publish-dir: './web/.next'
    production-deploy: false
```

### Cloudflare Pages

Use the Cloudflare Pages GitHub Action:
```yaml
- name: Deploy to Cloudflare Pages
  uses: cloudflare/pages-action@v1
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: predinex
    directory: ./web/.next
```

### Self-Hosted

For self-hosted previews:
1. Set up a preview server with Docker
2. Use GitHub Actions to build and deploy containers
3. Use a reverse proxy (nginx/Traefik) for PR-specific subdomains

## Security Considerations

### Environment Isolation

- Preview deployments use testnet configuration only
- Never expose production secrets or API keys
- Use separate contract addresses for preview environments

### Access Control

- Preview URLs are public but unguessable (long random strings)
- Consider adding basic auth for sensitive projects
- Review Vercel's security settings for additional protection

### Secret Management

- Store all secrets in GitHub Secrets (encrypted at rest)
- Rotate tokens periodically
- Use least-privilege access for service accounts
- Never commit secrets to the repository

### Content Security

- Preview deployments may contain unreleased features
- Avoid sharing preview URLs publicly before release
- Consider adding a banner indicating "Preview Environment"

## Cost Considerations

### Vercel Free Tier Limits

- 100 GB bandwidth per month
- 100 hours of build time per month
- Unlimited preview deployments
- 6,000 minutes of serverless function execution

For most projects, the free tier is sufficient for preview deployments.

### Optimization Tips

1. **Limit workflow triggers**: Only run on `web/` changes
2. **Cancel in-progress builds**: Use concurrency groups
3. **Cache dependencies**: Use npm cache in workflow
4. **Optimize build**: Use Next.js build cache

## Monitoring

### Deployment Status

Check deployment status in:
- GitHub Actions tab (workflow runs)
- PR checks (status badges)
- Vercel dashboard (deployment history)

### Metrics to Track

- Average deployment time
- Success/failure rate
- Build duration trends
- Preview environment usage

## Support

For issues or questions:
1. Check the [GitHub Actions logs](../../actions)
2. Review [Vercel documentation](https://vercel.com/docs)
3. Open an issue in the repository
4. Contact the maintainers

## References

- [Vercel CLI Documentation](https://vercel.com/docs/cli)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Next.js Deployment Guide](https://nextjs.org/docs/deployment)
- [WalletConnect Cloud Setup](https://cloud.walletconnect.com)
