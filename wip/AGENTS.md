# BYOT development

- Run commands from `wip/`. `src/codegen/treapConfig.ts` generates GNU C++17; shared dependencies live in `src/codegen/features.ts` and `depsUtil.ts`.
- Verification: `npm test -- --jobs 6`, `npm run typecheck`, and `npm run test:byot -- --stress-only --sanitize --jobs 4`.
- Production build without removing existing build artifacts: `node --input-type=module -e 'import { build } from "vite"; await build({ build: { emptyOutDir: false } });'`.
- Do not run `build:page` or change the checked-in publishing HTML/assets unless publication is requested.
- For publication, build to a fresh temporary directory and pass its absolute path as `BYOT_DIST_DIR` when running `node build-page.js`. This avoids copying stale local builds. The publisher preserves previous hashed assets by default for cached pages; `--clean-assets` deletes them and requires explicit confirmation.
- Core benchmarks: `npm run bench:byot -- --cpu=2 --keep`. Use `--quick` for correctness smoke checks, not performance conclusions; `--variants=...` selects comparisons.
- Wrapper benchmarks: `npm run bench:wrappers -- --cpu=2 --keep`; add `--kind=array` for DynamicArray.
- Benchmark CPU affinity uses Linux `taskset`; choose an allowed CPU or omit `--cpu`. Run timing benchmarks serially, without simultaneous builds/tests. They use fixed traces, vector oracles, warmups, rotating variant order, and repeated measurements. Allocation/build time is excluded.
- Generated benchmark sources, binaries, timings, and instrumentation counters stay in temporary directories, not the repository.
