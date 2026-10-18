# Build Your Own Treap (BYOT) Next

This is the next-gen version of the BYOT code generator. Features:
- Modern React + Tailwind + TypeScript UI
- Modular codegen system for Treap variants
- Preset loading/saving (coming soon)
- Monaco Editor integration (coming soon)
- Designed to be reusable in a future VSCode extension

## Local Dev

```bash
npm install
npm run dev
```

Edit `src/codegen/treapConfig.ts` to grow the feature and codegen system.

## Building for GitHub Pages

To compile this into a static HTML page viewable at `https://caterpillow.github.io/byot`:

```bash
npm run build:page
```

This will:
1. Build the React app
2. Copy the output to `../byot.html` and `../assets/`
3. Write compatibility redirects at `byot.html` (the old `/wip/byot` URL) and `../byot2.html`
4. You can then commit and push these files

The built page will work as a standalone static file - no server needed!

The legacy generators are preserved at `/archive/byot/` and `/archive/byot/byot2`. Their files and the old `wip/assets/` bundles are retained when publishing.
