# Agent Note: a delegation falls back only when its child was refused before it could act

Status: implemented

English | [中文](2026-08-27-delegation-route-fallback.zh.md)

## Problem

The [team preset](2026-08-26-team-agent-preset-role-bound-routes.md) pins each role to a route, which is what makes a role a deployment decision rather than a model's choice. The cost is that a role whose route the deployment cannot serve fails every time, and live testing produced three such failures in a row on real accounts:

- `NO_ADAPTER` — `no adapter registered for provider "anthropic"`, on a deployment with no `llm-pi-ai:` section.
- `Provider is not configured: anthropic` — the route declared but its credential store empty.
- `Project proj_… does not have access to model gpt-5.3-codex` — the shipped engineer default, on an OpenAI project without codex access.

Each killed a delegation the lead could have completed on another route. Worse, the parent's tool result is `Error: subagent run failed` with no route name, so the operator cannot even see which role was misrouted without opening the child transcript.

## Decision

`dsh-tool-subagent` gains `fallbackAgentOptions`: a second route to start **one** more child on. No chain — a fallback that also fails is the result.

Two conditions gate it, and both are necessary.

The failure must name a qualifying `failure.code`. That required surfacing the code: `SubagentResult` gains an optional `failure` carrying the turn's structured `LlmFailure`, which the in-process driver reads from its `turn/end` reason. Routing on `diagnostic` would have needed no seam change and was rejected — that field is safe display text, and the repo's own rule is to route on a code and never parse a message.

The child must have produced no output. `output.length === 0` is the only evidence this seam offers that nothing happened before the failure, and it is what makes a restart a second attempt at the same task rather than a repeat of work.

`fallbackOnCodes` defaults to the codes a route raises **before any provider request**: `NO_ADAPTER`, `UNKNOWN_MODEL`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `UNSUPPORTED_REASONING_EFFORT`. A child refused by one of those never reached the network, so a restart cannot repeat an effect. `QUOTA`, `AUTH`, and `RATE_LIMIT` are deliberately **not** in the default set: they can arrive mid-run, and an empty `output` cannot distinguish a child that did nothing from one that called a tool and produced no assistant text. A deployment may add them, and the config documents what it is accepting.

Each substitution appends `subagent/fallback` to the delegating session before the replacement starts, naming the refused child, the failure code, and both routes. Without it the log says nothing about a first attempt: the replacement's own `request/header` records only the route it ran on, so a reader comparing a role's configured route against what ran would see no discrepancy to explain.

## Alternatives considered

**Fallback in the agent loop, on `agent/request-error`.** This was the design proposed before implementation, and it does not work. `installModelSelection` — which both `api-proxy` and the headless bundle install — registers an `agent/request` listener that calls `next()` and then overwrites `provider` and `model` from its own snapshot, so a route set deeper in the chain is clobbered. Its `current` getter reads the last logged `request/header`, and the selection ref itself is private to each entry point, so no plugin can influence it. Making that work requires a `modelSelection` service published by every entry point — the right end state for root-session fallback, and out of scope for a delegation failure.

**Fall back on any failure.** Simpler, and wrong in the direction that costs money and repeats side effects. A `SERVER` or `TIMEOUT` failure is retryable on the same route, which `dsh-llm-retry` already owns; substituting the route would bill another vendor for a transient fault and hide it.

**Chain several routes.** Rejected as speculation. One fallback covers "the configured route cannot serve this deployment", which is the observed failure; a chain invites a delegation that quietly costs three vendors before reporting.

**Report the substitution to the model.** The model called one tool and wants one answer; which route produced it is a deployment fact, not task-relevant content, and putting it in the result would change model-visible text for no model benefit.

## Consequences

`SubagentResult` gains an optional field, so every provider stays correct by omitting it. Only the in-process driver populates it today; out-of-process providers report `diagnostic` text and no code, so their children never qualify for fallback. That is a real gap and the honest one — those providers' protocols do not carry a harness failure code.

`settleForegroundRun` split into `collectForegroundRun` (settle and dispose, returning even an errored result) and `toForegroundToolResult` (throw or convert). The old single function threw before a caller could inspect the failure, which is exactly what the decision needs.

The team preset's `delegate_engineer` now falls back to `deepseek-official`. Its `openai` default is the route that failed live, and the lead's own vendor is the one route a DeepSeek Harness deployment can be assumed to have.

Background and continuable delegations do not fall back. A background run settles through the generic task surface and a continuable child never returns a result through this tool, so neither reaches the code that decides.

## Testing

`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` drives the shipping tool path over a scripted provider whose script is indexed per start, so one case can refuse the first attempt and serve the second. It pins the successful substitution and that the second start names the fallback route; the appended `subagent/fallback` with both routes and the code; no fallback for a non-qualifying code (`SERVER`), for a child that produced output before failing, and for no configured fallback; a fallback whose own failure is final; and an explicit `fallbackOnCodes` list admitting `QUOTA`.

The three route failures in the Problem section came from live runs against real OpenAI and Anthropic accounts, which is where the default code set comes from rather than from guessing which failures matter.
