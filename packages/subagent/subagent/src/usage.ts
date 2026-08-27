/**
 * Delegated token usage: the `subagent/usage` session event that records what a
 * child agent's own model requests cost, in the parent's durable log.
 *
 * It exists for children the harness cannot otherwise account for. An
 * in-process child owns a Session, so `ctx.tokenMeter` already folds its usage
 * from that child's log. An out-of-process child owns no Session here — its
 * requests happen inside another harness — so without this event its spend is
 * recorded nowhere, and a total built from the logs the harness does have reads
 * as complete while omitting it.
 *
 * Absence is therefore meaningful and is not zero: a provider that cannot read
 * its child's usage appends nothing, and a reader must present that as
 * unmeasured rather than as free. {@link SubagentUsage.reportedBy} names the
 * provider so a reader can say which delegation it is missing.
 *
 * Money is deliberately absent. Some child protocols report a cost, but the
 * harness owns no pricing seam, so a currency figure here would be the only
 * priced fact in the log with nothing to reconcile it against.
 *
 * @module @deepseek-ai/dsh-subagent/usage
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Token usage one delegated child reported for its own model requests,
     * appended to the DELEGATING session's log when the run settles. Log-only:
     * it carries no `surfaceOp`, never enters model history, and survives
     * compaction. One event per settled run that reported usage; a run whose
     * provider reports none appends nothing.
     */
    'subagent/usage': SubagentUsage
  }
}

/**
 * What a delegated child's model requests cost, in the four disjoint buckets
 * `ctx.tokenMeter` already sums, so a reader can add delegated spend to
 * measured spend without reconciling two vocabularies.
 *
 * A Service Provider reports exactly this and nothing more: at the point it
 * reads its child's protocol it knows the numbers and the model, while the run
 * and child ids belong to the service and the Consumer.
 */
export interface SubagentReportedUsage {
  /**
   * The model the child harness attributed the usage to. A child may use
   * several models in one run; this is absent when the protocol names none or
   * names more than one, because picking one arbitrarily would misattribute
   * the whole run.
   */
  readonly model?: string
  /** Input tokens the child was billed at full price. */
  readonly uncachedInputTokens: number
  /** Input tokens served from the provider's prompt cache. */
  readonly cacheReadTokens: number
  /** Input tokens written into the provider's prompt cache. */
  readonly cacheWriteTokens: number
  /** Output tokens, reasoning included as a subdivision rather than added again. */
  readonly outputTokens: number
}

/**
 * One delegated child's usage as it is recorded in the delegating session:
 * what the provider reported, plus the identity the Consumer knows.
 */
export interface SubagentUsage extends SubagentReportedUsage {
  /** The child agent's id, pairing this with the run's `subagent/start`. */
  readonly childId: SessionId
  /** The `ctx.subagents` provider that reported it, for attribution and for naming what is missing. */
  readonly reportedBy: string
}
