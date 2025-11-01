# How to View Your Deployed Page

## Finding Your GitHub Pages URL

After pushing and the GitHub Actions workflow completes:

### Method 1: Check GitHub Settings
1. Go to your repository: `https://github.com/caterpillow/caterpillow.github.io`
2. Click **Settings** → **Pages** (in the left sidebar)
3. You'll see your site URL at the top, something like:
   - `https://caterpillow.github.io` (if it's a user site)
   - Or a custom domain if configured

### Method 2: Check GitHub Actions
1. Go to your repository → **Actions** tab
2. Click on the latest "Deploy WIP to GitHub Pages" workflow run
3. Once it completes, expand the "Deploy to GitHub Pages" step
4. The URL will be shown in the output

## Your Site URL

Based on your repository setup, your site should be available at:

**Most likely:** `https://caterpillow.github.io/`

## Timing

⚠️ **It may take 1-5 minutes** after the workflow completes for the site to be accessible.

## Verify Deployment

1. Wait for the workflow to complete (green checkmark in Actions tab)
2. Visit your GitHub Pages URL
3. If you see a 404 or blank page, check the browser console for errors

## Troubleshooting

### If assets don't load (404 errors):
The `base` path in `vite.config.ts` might be wrong. Check:
- If your repo is a user site (`caterpillow.github.io`), use `base: '/'`
- If it's a project site, use `base: '/repository-name/'`

Update `vite.config.ts` and rebuild/redeploy.

### If you see the old site:
- Make sure GitHub Pages is set to use "GitHub Actions" as the source (Settings → Pages)
- The workflow deploys to the root, replacing the previous content

