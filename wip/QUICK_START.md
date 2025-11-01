# Quick Start - Getting Your Page Live

## Step 1: Build (Already Done ✅)
```bash
npm run build:page
```

## Step 2: Commit and Push
```bash
git add wip/byot.html wip/assets/
git commit -m "Add built BYOT page"
git push
```

## Step 3: Verify GitHub Pages is Enabled

Since your repo is `caterpillow.github.io`, GitHub Pages should automatically serve from the root of your `main` branch.

1. Go to: https://github.com/caterpillow/caterpillow.github.io/settings/pages
2. Make sure:
   - Source is set to "Deploy from a branch"
   - Branch is `main` (or `master`)
   - Folder is `/ (root)`
   - Save if you made changes

## Step 4: Wait and View

- Wait 1-2 minutes after pushing for GitHub Pages to update
- Visit: https://caterpillow.github.io/wip/byot.html

## Troubleshooting

**If you get a 404:**
- Wait a few more minutes (GitHub Pages can take up to 5 minutes)
- Check that the files are actually in the repo: https://github.com/caterpillow/caterpillow.github.io/tree/main/wip
- Verify GitHub Pages settings (Step 3)

**If the page loads but assets are broken:**
- Check browser console for 404 errors
- Verify `wip/assets/` folder is committed with the files
- Make sure asset paths in byot.html are relative (they should be `./assets/...`)

