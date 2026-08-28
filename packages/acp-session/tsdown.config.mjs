import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/plugin.ts', 'src/peers.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'lib',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  deps: { neverBundle: [/^@deepseek-ai\//, /^\.\/plugin(?:\.ts)?$/] },
})
