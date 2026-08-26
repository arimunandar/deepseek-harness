/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-settings-connections/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-connections'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-connections-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every fact this page renders is read from the Host
 * directory on each pass, and the one piece of local state — the running
 * sign-in conversation — is owned end to end by the Host attempt whose
 * invariant already covers it.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
