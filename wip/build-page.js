#!/usr/bin/env node

/**
 * Publish the current app at /byot and keep the previous URLs working.
 */

const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, process.env.BYOT_DIST_DIR || 'dist');
const outputDir = path.join(__dirname, '..');
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
const htmlContent = fs.readFileSync(indexHtml, 'utf-8').replace(/\r\n?/g, '\n');

// Copy index.html to the canonical page.
fs.writeFileSync(outputFile, htmlContent, 'utf-8');
console.log(`✅ Created ${outputFile}`);

// Copy assets beside the canonical page.
const distAssetsDir = path.join(distDir, 'assets');
if (fs.existsSync(distAssetsDir)) {
  // Remove old assets if they exist
  if (fs.existsSync(assetsDir) && process.argv.includes('--clean-assets')) {
    fs.rmSync(assetsDir, { recursive: true, force: true });
  }
  
  // Copy assets
  copyRecursiveSync(distAssetsDir, assetsDir);
  console.log(`✅ Copied assets to ${assetsDir}`);
}

for (const [file, destination] of [
  [path.join(__dirname, 'byot.html'), '/byot'],
  [path.join(outputDir, 'byot2.html'), '/archive/byot/byot2'],
]) {
  fs.writeFileSync(file, redirectPage(destination), 'utf-8');
}

function redirectPage(destination) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BYOT has moved</title>
    <link rel="canonical" href="https://caterpillow.github.io${destination}">
    <script>window.location.replace(${JSON.stringify(destination)} + window.location.search + window.location.hash);</script>
    <noscript><meta http-equiv="refresh" content="0; url=${destination}"></noscript>
  </head>
  <body>
    <p><a href="${destination}">Continue to BYOT</a></p>
  </body>
</html>
`;
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
console.log(`   Your page will be available at: https://caterpillow.github.io/byot`);
console.log(`   (after you commit and push byot.html, assets/, and the compatibility redirects)`);
