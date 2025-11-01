# Deploying to GitHub Pages

This document explains how to build and deploy the `/wip` app to GitHub Pages.

## Quick Start

### Option 1: Automated Deployment (Recommended)

1. **Install dependencies** (if not already done):
   ```bash
   cd wip
   npm install
   ```

2. **Enable GitHub Pages**:
   - Go to your repository Settings > Pages
   - Under "Source", select "GitHub Actions"
   - Save the settings

3. **Push to trigger deployment**:
   - The GitHub Actions workflow will automatically build and deploy when you push changes to files in `/wip/`
   - Or manually trigger it from the Actions tab > "Deploy WIP to GitHub Pages" > "Run workflow"

4. **Access your site**:
   - After deployment, your site will be available at your GitHub Pages URL
   - Example: `https://caterpillow.github.io/caterpillow.github.io-1/` (or whatever your repo name is)

### Option 2: Manual Deployment

1. **Build the app**:
   ```bash
   cd wip
   npm install
   npm run build
   ```

2. **Deploy**:
   - Copy the contents of `wip/dist/` to your GitHub Pages location
   - Or use the deploy script: `npm run deploy` (which will copy to `wip-deploy/`)

## Configuring the Base Path

If your repository name is NOT the same as your GitHub username/organization:
- Update `vite.config.ts` to set the correct `base` path
- For example, if your repo is `caterpillow.github.io-1`, set `base: '/caterpillow.github.io-1/'`
- Or set it via environment variable: `VITE_BASE_PATH=/your-repo-name/ npm run build`

If deploying to root (username.github.io):
- Set `base: '/'` in `vite.config.ts`

## Local Testing

Before deploying, test the production build locally:

```bash
cd wip
npm run build
npm run preview
```

This will serve the built files on a local server so you can verify everything works.

## Troubleshooting

- **404 errors on routes**: Make sure the `base` path in `vite.config.ts` matches your repository path
- **Assets not loading**: Check that the `base` path is correct (should start and end with `/`)
- **Build fails**: Make sure all dependencies are installed (`npm install`)

