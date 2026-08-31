import { typert, valueOf } from '../rpc.mjs'

export async function runRoutinesProbe() {
  const errors = []
  const routines = valueOf(await typert('routine/list', {}))

  if (!routines || routines.__error) {
    errors.push({
      step: 'routine.list',
      message: 'routine.list is unavailable or failed; ensure @lumine/dsh-routines is mounted on the live DSH profile.',
      detail: routines,
    })
  }

  return {
    name: 'routines',
    ok: errors.length === 0,
    routines,
    errors,
  }
}
