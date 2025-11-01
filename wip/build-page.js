#!/usr/bin/env node

/**
 * Simple build script that copies the built files to wip/byot.html
 * This makes it viewable at https://caterpillow.github.io/wip/byot.html
 */

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const outputDir = path.join(__dirname, '..', 'wip');
const outputFile = path.join(outputDir, 'byot.html');
const assetsDir = path.join(outputDir, 'assets');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Read the built index.html
const indexHtml = path.join(distDir, 'index.html');
if (!fs.existsSync(indexHtml)) {
  console.error('❌ Error: dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

// Read and fix asset paths if needed (they should be relative already)
let htmlContent = fs.readFileSync(indexHtml, 'utf-8');

// Copy index.html to wip/byot.html
fs.writeFileSync(outputFile, htmlContent, 'utf-8');
console.log(`✅ Created ${outputFile}`);

// Copy assets directory to wip/assets/
const distAssetsDir = path.join(distDir, 'assets');
if (fs.existsSync(distAssetsDir)) {
  // Remove old assets if they exist
  if (fs.existsSync(assetsDir)) {
    fs.rmSync(assetsDir, { recursive: true, force: true });
  }
  
  // Copy assets
  copyRecursiveSync(distAssetsDir, assetsDir);
  console.log(`✅ Copied assets to ${assetsDir}`);
}

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

console.log('\n✅ Build complete!');
console.log(`   Your page will be available at: https://caterpillow.github.io/wip/byot.html`);
console.log(`   (after you commit and push the wip/byot.html and wip/assets/ files)`);

