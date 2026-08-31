#!/usr/bin/env node
/**
 * Boot a second `dsh web` on a free port against this worktree and run e2e.
 * Does not kill the operator's existing DSH (often :3080).
 *
 *   node scripts/e2e/fresh.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      server.close(error => {
        if (error) reject(error)
        else resolvePort(port)
      })
    })
    server.on('error', reject)
  })
}

async function waitReady(url, timeoutMs = 60000) {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/workspace.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: crypto.randomUUID(),
          method: 'workspace.list',
          payload: {},
        }),
      })
      last = await response.text()
      if (response.ok) return
    } catch (error) {
      last = String(error && error.message ? error.message : error)
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`fresh DSH did not become ready at ${url}: ${last.slice(0, 300)}`)
}

const port = await freePort()
const url = `http://127.0.0.1:${port}`
console.log(`starting dsh web --no-open --port ${port}`)

const child = spawn('dsh', ['--profile', 'web', '--no-open', '--port', String(port)], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
})

let output = ''
child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })

const killChild = () => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3000)
}

process.on('exit', killChild)
process.on('SIGINT', () => { killChild(); process.exit(130) })
process.on('SIGTERM', () => { killChild(); process.exit(143) })

try {
  await waitReady(url)
  const run = spawn(process.execPath, [resolve(repoRoot, 'scripts/e2e/run.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DSH_E2E_URL: url },
  })
  const status = await new Promise(resolveStatus => {
    run.on('exit', (code, signal) => resolveStatus(code ?? (signal ? 1 : 0)))
  })
  killChild()
  await new Promise(resolveExit => child.on('exit', resolveExit))
  process.exit(status)
} catch (error) {
  console.error(error)
  console.error(output.slice(-2000))
  killChild()
  process.exit(1)
}
