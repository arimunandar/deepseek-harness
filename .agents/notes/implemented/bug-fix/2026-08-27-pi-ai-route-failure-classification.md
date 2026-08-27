# Agent Note: two pi-ai route failures carry canonical codes so a delegation can be rescued

Status: implemented

English | [中文](2026-08-27-pi-ai-route-failure-classification.zh.md)

## Problem

[Delegation route fallback](../feature/2026-08-27-delegation-route-fallback.md) starts one replacement child when the first is refused for a reason about the route and produced no output. On a real deployment it never fired, because the two failures that actually occur both arrived as `dsh-llm-pi-ai`'s catch-all:

- `Provider is not configured: anthropic` — the route declared in settings, its credential store empty.
- ``Project `proj_…` does not have access to model `gpt-5.3-codex` `` — the shipped engineer default, on an OpenAI project without codex access.

`PI_AI_ERROR` is deliberately outside every qualifying set, so `delegate_engineer` failed on that deployment and its configured `deepseek-official` fallback was never reached. What the operator saw was a worktree provisioned, the child refused, the worktree retired empty, and `Error: subagent run failed` naming no route.

This also closes a deferral recorded in [the OAuth-only withholding note](2026-08-13-oauth-only-providers-withheld.md), which listed mapping `Provider is not configured` to a named error as worth doing and deferred it as a separate change.

## Decision

`classifyPiAiError` recognizes both wordings. The first reuses `MISSING_CREDENTIAL` — exactly what the adapter's own credential resolution already means by it, a route with no resolvable credential, reached at a different detection point. The second gets a new canonical code, `MODEL_NOT_ENTITLED`: the credential is valid and the model is in the route's catalog, but the account is not permitted to use it.

Text matching is forced rather than preferred. pi-ai throws `ModelsError('auth', …)` and then flattens it to `error.message` before it reaches the adapter, discarding the code; the standing `XXX(pi-ai upstream)` comment records that and names forwarding the original error as the durable fix.

Both checks sit above every status-digit test. They are the most specific wordings and are digit-free, while the existing tests are hazards in both directions: a project id or model name carrying a bare three-digit run beginning with 5 would be classified `SERVER`, and an upstream release that begins prefixing the HTTP status would silently move entitlement to `AUTH`. The regexes are whole-word anchored for the same reason `/not configured/i` and `/no access/i` were rejected — a tool error's own text carries both.

### Why not `AUTH`

Two independent grounds. `packages/client/runtime/src/client/sessions/failure-display.ts` is the one consumer that special-cases a code for display, and it replaces an `AUTH` message with the fixed string "API key is invalid" — which would send someone to rotate a working key. And `AUTH` is outside the fallback set, so the delegation would die anyway. `MODEL_NOT_ENTITLED` deliberately gets no special case there, so the provider's own accurate sentence reaches the operator.

### Why not reuse `UNKNOWN_MODEL`

It was the first choice and it is wrong: it would falsify two written invariants and one piece of user-facing advice. The package README states that a model the route does not configure fails *before any provider request* with `UNKNOWN_MODEL`; `PRE_REQUEST_ROUTE_CODES`' own documentation claims such a child never reached the network; and `docs/user/guide/providers.md` tells the operator to add the missing model to the custom provider — useless when the model is present and the account lacks access. Minting follows the direct prior art of `INVALID_CREDENTIAL_CODE`, which split "supplied but unusable" from "absent" for one stated reason: the fix differs. It differs here too — obtain access or choose another model, versus edit the route. Codes are open strings on `HarnessError`, so nothing widens a union and the cost is documentation, not types.

### The fallback set widens, and what that costs

`MODEL_NOT_ENTITLED` had to join `PRE_REQUEST_ROUTE_CODES` or the classification would achieve nothing. That set was defined by a mechanically checkable property — the failure happened before any network I/O — and an entitlement refusal happens *on* the first request. Rather than keep a claim that is now false, the constant is re-documented to what actually holds: these codes mean the configured route cannot serve this deployment, they are deterministic for that route, they never succeed on a restart of the same one, and they cannot arise after the child produced output.

The residual hole, stated plainly: entitlement revoked mid-run, after the child called a tool but produced no assistant text, would repeat that one tool call. The `output.length === 0` guard bounds it to exactly that case and is untouched.

## Alternatives considered

- **A second `DETERMINISTIC_ROUTE_REFUSAL_CODES` set whose union forms the default.** It preserves the mechanically checkable invariant of the original set instead of relaxing it. Rejected as disproportionate — a whole constant for one member — but recorded here so the next code added to the single set has to argue for itself rather than cite this change as precedent.
- **Changing the preset's engineer route.** The alternative to classifying at all. `openai-codex` serves only `gpt-5.3-codex-spark` and needs a ChatGPT OAuth grant, so it fails API-key-only deployments: one unusable default for another. Every vendor route is unavailable on some deployment, and the fallback is the mechanism for exactly that, so the preset keeps `openai`/`gpt-5.3-codex`.
- **Mapping every pi-ai failure wording.** Only the two observed on real accounts are mapped, so no regex is guessed at.
- **Making `PI_AI_ERROR` retryable.** Already rejected by [the transport-truncation note](2026-07-22-pi-ai-transport-truncation-classification.md) for blurring the catch-all, and none of these codes should be retryable: an entitlement refusal is a property of the account and fails identically on every attempt.

## Consequences

No code is in `DEFAULT_RETRYABLE_CODES`, so this changes diagnosis and fallback qualification and never retry behavior. Classification is provider-wording dependent: a pi-ai or provider release that rewords either message silently returns it to `PI_AI_ERROR`, which stays diagnosable but no longer qualifies a delegated child for a fallback route. That is recorded in the package README's known limitations, and forwarding `ModelsError.code` upstream remains the durable answer.

## Testing

`packages/llm/llm-pi-ai/tests/convert.spec.ts` pins both wordings verbatim from the live runs, plus the two ordering guards that motivated the placement — an entitlement message naming `gpt-500-codex` stays `MODEL_NOT_ENTITLED` rather than `SERVER`, and the same message prefixed `403:` stays `MODEL_NOT_ENTITLED` rather than `AUTH` — and two negative cases (`tool configuration is not valid`, `no access to /etc/hosts`) that hold the catch-all against a wider regex. `adapter.spec.ts` drives the real plugin against its local mock server answering a genuine 403 entitlement body, which is what shows the wording survives pi-ai's flattening rather than only the classifier being correct about a string. `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` pins that the new code with empty output qualifies for fallback under the default set.

`examples/headless-agent/tests/headless.snapshot.ts` pins the credential half through the assembled application, keylessly: `pi-ai-keyless.cordis.snapshot.yml` disables the DeepSeek adapter, mounts a pi-ai route naming no `apiKeyEnv`, and re-pins the agent to it, so pi-ai's own auth resolution refuses the route before the endpoint is dialed. The recorded transcript carries `MISSING_CREDENTIAL`; the same composition run against the previous classifier produces `PI_AI_ERROR`, which is what makes the recording a test rather than a description.

`pi-ai-entitlement.cordis.yml` pins the other half the same way. The suite already stands up a local HTTP server and points a composition's `baseURL` at it, so an entitlement refusal needs no new harness support: the server answers 403 with the wording, the route carries a valid credential, and the transcript records `MODEL_NOT_ENTITLED`. Two facts only the assembled run could establish: pi-ai prefixes the flattened message with the literal status (`403: {…}`), so the ordering decision above is load-bearing rather than defensive, and the same scenario against the previous classifier records `AUTH` — the outcome that would send an operator to rotate a working key. The refusal costs exactly one request, which the recorded server request count pins, because the code is outside the retryable set.

The unit tests assert the mapping, not that the mapping matches reality; both wordings came from live runs against real OpenAI and Anthropic accounts.
