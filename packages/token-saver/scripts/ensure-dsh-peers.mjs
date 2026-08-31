#!/usr/bin/env node
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const fromUrl = new URL('../package.json', import.meta.url).href
let ensure
try {
  ({ ensureDshPeers: ensure } = await import('../lib/peers.js'))
} catch {
  const require = createRequire(fromUrl)
  console.error('ensure-dsh-peers: build the package before running the peer healer')
  console.error(`looked from ${fileURLToPath(fromUrl)}`)
  void require
  process.exitCode = 1
}

if (ensure) {
  const linked = ensure(fromUrl)
  if (linked.length === 0) {
    console.error('ensure-dsh-peers: no DSH peers found; set DSH_HOME and DSH_PROFILE')
    process.exitCode = 1
  } else {
    console.log(`ensure-dsh-peers: ${linked.join(', ')}`)
  }
}
