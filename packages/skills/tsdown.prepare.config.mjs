import { defineConfig } from 'tsdown'

// Git installs run `prepare`; transpile without typechecking so the published
// entrypoints are self-contained even before optional DSH peers are linked.
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
