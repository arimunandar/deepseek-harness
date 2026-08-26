/**
 * Delegated route fallback: the `subagent/fallback` session event recording that
 * one child's route was refused before it could act, and which route the retry
 * used instead.
 *
 * It exists because the substitution is otherwise invisible. The second child's
 * own `request/header` records the route it ran on, but nothing says a first
 * child was refused, why, or that the two attempts are one delegation — and a
 * reader comparing a role's configured route against what actually ran needs
 * exactly that.
 *
 * @module @deepseek-ai/dsh-subagent/fallback
 */

import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One route substitution inside a single delegation, appended to the
     * DELEGATING session before the replacement child starts. Log-only: it
     * carries no `surfaceOp`, never enters model history, and survives
     * compaction. At most one per delegation — a fallback that also fails is
     * final, so there is no chain to record.
     */
    'subagent/fallback': SubagentFallback
  }
}

/** Why a delegation abandoned its configured route, and what it used instead. */
export interface SubagentFallback {
  /** The refused child, pairing this with that run's `subagent/start`. */
  readonly childId: SessionId
  /** The `ctx.subagents` provider both attempts used; only the route changed. */
  readonly provider: string
  /** The refused child's failure code, the fact that qualified the substitution. */
  readonly failureCode: string
  /** The configured options the first child was started with, absent when it inherited the parent's. */
  readonly from?: AgentOptions
  /** The options the replacement child was started with. */
  readonly to: AgentOptions
}
