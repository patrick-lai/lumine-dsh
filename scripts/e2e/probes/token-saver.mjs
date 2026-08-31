import { typert, valueOf } from '../rpc.mjs'

export async function runTokenSaverProbe() {
  const errors = []
  const state = valueOf(await typert('tokenSaver/get', {}))

  if (!state || state.__error) {
    errors.push({
      step: 'tokenSaver.get',
      message: 'tokenSaver.get is unavailable; ensure @lumine/dsh-token-saver is mounted on the live DSH profile.',
      detail: state,
    })
    return { name: 'token-saver', ok: false, errors }
  }

  const level = state.level
  if (level !== 'off' && level !== 'light' && level !== 'balanced' && level !== 'aggressive') {
    errors.push({
      step: 'level',
      message: `tokenSaver.get returned unknown level ${String(level)}`,
      detail: state,
    })
  }

  return {
    name: 'token-saver',
    ok: errors.length === 0,
    level,
    errors,
  }
}
