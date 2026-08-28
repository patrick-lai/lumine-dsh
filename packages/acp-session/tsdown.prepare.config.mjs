import { defineConfig } from 'tsdown'

// Git installs run `prepare`. Transpile without typecheck so the published
// entrypoints are self-contained (DSH publish tutorial). JS config avoids
// tsdown's optional `unrun` loader.
export default defineConfig({
  entry: ['src/index.ts', 'src/plugin.ts', 'src/peers.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  outDir: 'lib',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  deps: { neverBundle: [/^@deepseek-ai\//, /^\.\/plugin(?:\.ts)?$/] },
})
