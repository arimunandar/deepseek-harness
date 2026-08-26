# Agent Note: a delegated child's spend is a session event, and its absence means unmeasured

Status: implemented

English | [中文](2026-08-27-delegated-token-usage.zh.md)

## Problem

`ctx.tokenMeter` folds usage from durable session logs. An in-process child owns a Session, so its spend is already accounted for there. An out-of-process child — Codex, Claude Code, an ACP peer — owns no Session in this harness: its model requests happen inside another one, and nothing here records them.

The result was a total that read as complete while omitting an unbounded amount. A deployment that moved a role from `spawn` to `claude-code` saw its measured spend *fall*, because the work moved somewhere the meter cannot see. That is worse than a visible gap: it looks like a saving.

## Decision

`subagent/usage` is a log-only session event appended to the **delegating** session when a foreground run settles, carrying the child's token buckets, its child id, and the provider that reported them. The delegating session is the only durable place an out-of-process child's spend can land, since the child has no log of its own here.

The seam splits along what each role actually knows. A Service Provider reports `SubagentReportedUsage` — four disjoint token buckets and, when its protocol names exactly one, the model — because at the point it reads its child's protocol it knows the numbers and nothing about run identity. The Consumer adds `childId` and `reportedBy`, which it holds and the provider does not. `SubagentResult.usage` therefore carries no ids.

The buckets are the four `ctx.tokenMeter` already sums (`uncachedInputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`), so delegated spend adds to measured spend without reconciling two vocabularies.

**Absence means unmeasured, not zero.** A provider whose protocol carries no usage appends nothing, and `reportedBy` names the provider so a reader can say which delegation it is missing rather than reporting a smaller number. Recording happens before a failing result throws, so a run that spent tokens and then failed is still counted — those are the runs most worth noticing.

`subagent-claude-code` reports it today: the official SDK's `result` message carries `usage` and `modelUsage`, exactly where the provider already reads. That value crossed a process boundary as JSON, so it is validated rather than trusted — a missing object or an unreadable bucket yields no report at all, because turning a decoding gap into zero would claim the child was free. A null cache bucket is a real zero and is kept as one.

`subagent-codex` reports nothing. Its `turn/completed` notification may carry usage, but the installed `@openai/codex` package ships a binary with no schema, so there is no evidence in this repository for what those fields are called. Guessing a wire field to fill in a number is how a wrong number becomes durable.

## Alternatives considered

**Add money.** The Claude SDK reports `total_cost_usd`, and cost is what the gap is really about. Rejected: the harness owns no pricing seam, so a currency figure would be the only priced fact in the log with nothing to reconcile it against, and it would be the vendor's price for the vendor's account rather than anything the harness can verify.

**Fold usage into `ctx.tokenMeter` through a service call.** The meter is replay-driven by construction — it advances one isolated fold per session from the durable log — so a push API would give it a second, unreplayable source of truth. Writing the event and letting the fold find it keeps one source.

**Record it in the child's session.** Correct for in-process children, and they already do it. Impossible for the children this exists for: they have no session here, which is the whole problem.

**Report the branch of unmeasured delegations as zero and annotate the UI.** Rejected for the reason absence exists: a zero is a number, and numbers get summed. A missing event cannot be accidentally added up.

## Consequences

`SessionEventMap` gains one member. It is log-only — no `surfaceOp`, never in model history, survives compaction — and the model sees nothing: the delegation tool's result is byte-identical either way.

`SubagentResult` gains an optional field, so every existing provider stays correct by reporting nothing. The four real-product Claude Code cases that pinned the whole result by equality now assert the result without `usage` and check the reported buckets separately, because a real CLI's token counts are not stable across product versions or cache state.

Background one-shot and continuable delegations record nothing yet. A background run's result is collected through the generic task surface and a continuable child's never returns through the tool at all, so neither settles where this Consumer can see it. The gap is narrower than the one this closes but it is real.

No projection reads the event yet. The fact is durable and named, which is what a total needs to stop being wrong; presenting delegated spend beside measured spend is a separate change to `token-meter` and its projection units.

## Testing

`packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts` covers the reader against the shapes a process boundary can deliver: the four buckets with a single billed model, several billed models attributing none, a null cache bucket as a real zero, and four unreadable reports each yielding nothing rather than zero. Two further cases run the reader through `consumeClaudeQuery` so the result's `usage` is what the provider actually returns.

`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` covers the recording through the shipping tool path with a parent whose session records appends: one `subagent/usage` attributed to the child id and provider, nothing appended when the provider reports none, and one recorded for a run that failed after spending. It also pins that the model-facing tool result is unchanged.

`packages/subagent/subagent-claude-code/tests/real-product.spec.ts` exercises the reader against the real distributed Claude Code CLI, which is the only evidence that the SDK field names are right.
