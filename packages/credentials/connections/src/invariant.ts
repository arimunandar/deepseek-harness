/** Package-owned invariant companion. @module @deepseek-ai/dsh-connections/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-connections'

/** Cordis companion plugin name. */
export const name = 'connections-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No question outlives the sign-in that asked it.
 *
 * The open-question table is the mutable state this package owns, and a stale
 * entry is invisible from outside it: a surface would keep rendering a question
 * whose flow stopped listening, and the answer a person typed would resolve
 * nothing. `connect()` clears its entry in a `finally`, so an entry left behind
 * for a connection with no running attempt means some path escaped that
 * clearing.
 */
const install: InvariantInstaller = (ctx: Context, fail) => {
  ctx.on('connections/changed', () => {
    // A disposer-time emit can outlive the service-store entry during whole-
    // context teardown; only a live service promises a readable table.
    const connections = ctx.get('connections')
    if (connections === undefined) return
    /* v8 ignore next 3 -- reaching the reporter IS the violation: `connect()`
       clears its entry in a `finally` that no in-process path can skip, so a
       suite can only produce an orphan by reaching into the private table. */
    for (const id of connections.orphanedPrompts()) {
      fail(`a question for "${id}" is still waiting on a sign-in that already settled`)
    }
  }, { global: true })
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
