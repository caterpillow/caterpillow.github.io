#!/usr/bin/env node

/**
 * Deployment script for GitHub Pages
 * Builds the Vite app and copies dist to the root wip directory for GitHub Pages
 */

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const deployDir = path.join(__dirname, '..', 'wip-deploy');

// Create deploy directory if it doesn't exist
if (!fs.existsSync(deployDir)) {
  fs.mkdirSync(deployDir, { recursive: true });
}

// Copy all files from dist to deploy directory
function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Clean deploy directory
if (fs.existsSync(deployDir)) {
  fs.readdirSync(deployDir).forEach((file) => {
    const curPath = path.join(deployDir, file);
    if (fs.lstatSync(curPath).isDirectory()) {
      fs.rmSync(curPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(curPath);
    }
  });
}

// Copy dist to deploy directory
if (fs.existsSync(distDir)) {
  copyRecursiveSync(distDir, deployDir);
  console.log(`✅ Build files copied from ${distDir} to ${deployDir}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Commit and push the 'wip-deploy' folder to your repository`);
  console.log(`   2. In GitHub Settings > Pages, set source to '/wip-deploy' folder`);
  console.log(`   3. Your site will be available at: https://caterpillow.github.io/wip/`);
} else {
  console.error(`❌ Error: ${distDir} not found. Run 'npm run build' first.`);
  process.exit(1);
}

