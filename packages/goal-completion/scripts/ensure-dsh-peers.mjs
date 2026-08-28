#!/usr/bin/env node
/**
 * Link @deepseek-ai/cordis (and the other DSH peers) into this package's
 * node_modules. `dsh plugin add link:...` loads the package from its real
 * path, so Node never sees the profile node_modules those peers live in.
 *
 * Usage: node scripts/ensure-dsh-peers.mjs
 * Honors DSH_HOME and DSH_PROFILE.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const fromUrl = new URL('../package.json', import.meta.url).href

let ensure
try {
  ({ ensureDshPeers: ensure } = await import('../lib/peers.js'))
} catch {
  try {
    ({ ensureDshPeers: ensure } = await import('../src/peers.ts'))
  } catch {
    const require = createRequire(fromUrl)
    console.error(
      'ensure-dsh-peers: could not load peers helper. Run `pnpm build` first, or keep src/peers.ts.',
    )
    console.error(`looked from ${fileURLToPath(fromUrl)}`)
    void require
    process.exitCode = 1
  }
}

if (ensure) {
  const linked = ensure(fromUrl)
  if (linked.length === 0) {
    console.error(
      'ensure-dsh-peers: no DSH peers found. Set DSH_HOME (and DSH_PROFILE=web) to the Harness home that already has `dsh` installed, then re-run.',
    )
    process.exitCode = 1
  } else {
    console.log(`ensure-dsh-peers: ${linked.join(', ')}`)
  }
}
