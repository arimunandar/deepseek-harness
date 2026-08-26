# Agent Note: connect-your-AI directory

Status: implemented

English | [中文](2026-08-26-connect-your-ai-directory.zh.md)

## Problem

Nobody could sign in to anything.

`@deepseek-ai/dsh-llm-pi-ai` registers one authorization flow per installed catalog provider that ships a login — Anthropic's Claude Pro/Max subscription, ChatGPT's Codex, and the rest — inside `ctx.inject(['authorization'], …)`. No shipped bundle mounted `ctx.authorization`, so those flows never registered in any composition a person could actually run. The seam existed, the flows existed, and the only caller was an example overlay that had to insert the seam row itself.

Even with a sign-in, "can I use this backend yet" had no owner. The answer is a join over four services that each answer a different question correctly: a flow on `ctx.authorization`, a credential on `ctx.credentials`, a registered route on `ctx.llm`, and the default selection on `ctx.agentDefaultModel`. The Models page performs a narrower version of that join and renders it as provider profiles — API-key fields, endpoints, model catalogs, a route id that doubles as a settings key. That page is right for someone tuning a deployment and wrong for someone who wants to use Claude.

## Decision

`@deepseek-ai/dsh-authorization` mounts in the base bundle, so every profile that composes pi-ai has its login flows.

A new `@deepseek-ai/dsh-connections` owns the join and publishes it as `ctx.connections`: `list`, `connect`, `answer`, `cancel`, `finishSetup`, `activate`, `disconnect`. Every method is a Typert `@Remote`, so one implementation serves an in-process caller and a browser through the Gateway with no hand-written wire schemas.

The join produces four words a badge can carry, each naming exactly one repair:

| Status | The join | The repair |
|---|---|---|
| `connected` | credential stored **and** a route reads it | none |
| `setup-required` | credential stored, no route | `finishSetup()` writes it |
| `needs-attention` | route live, credential missing or read-only | sign in again, or fix the launch environment |
| `not-connected` | nothing stored | `connect()` |

Which backends exist is `Config.connections`, not code. The base bundle names Claude, Codex, and DeepSeek; another composition names its own, and the web e2e scenario names two of its own so a developer's real `DEEPSEEK_API_KEY` cannot move what the page says.

`@deepseek-ai/dsh-client-ui-settings-connections` renders one card per entry into `settings.section`, at order 5 — ahead of Models, because connecting an account is the question a person arrives with and editing a provider profile is the one they arrive at later. It contributes no `settings.onboarding` step; see below.

### The conversation crosses as events, not as a second wire quadrant

A flow talks to a human: it notifies, then asks. The obvious wiring is an answerable server-initiated request, which the carrier already has for approvals and questions — a pending table, a `/api/respond` route, and a per-method answerable/push dichotomy.

Instead, `connect()` stays a long-lived unary call that resolves when the attempt settles, notices and questions ride out as ordinary forwarded events (`connections/notice`, `connections/prompt`), and the answer comes back through a separate unary `answer()`. Nothing was added to the carrier: no quadrant, no pending table, no route. A second tab watching the same connection sees the same conversation and can answer it, because the transport is a broadcast rather than a correspondence with one caller.

`promptId` is what makes that safe. An answer naming a question that is no longer open is refused rather than applied to its successor — the difference between "your code expired, here is a new one" and a code silently answering a different question.

`connections/changed` carries no payload. The join spans four owners and no single owner's increment describes the resulting state, so the service folds `credentials/reference-updated`, `credentials/record-updated`, `llm/adapters-updated`, and `authorization/settled` into one signal and every consumer re-reads the whole directory.

### A successful sign-in writes the route

A stored credential no route reads is not a connection anyone can use, and asking a person to press a second button for it would be asking them about plumbing. `connect()` therefore follows an authorized attempt with the route write, skipped when a route already exists so a reconnect never overwrites a tuned profile.

`routePath` is empty rather than absent for a connection whose adapter registers its own route (`llm-deepseek`). The settings path grammar reads an empty path as the section **root**, so writing there would replace a whole namespace document with this package's profile; the one address this package must never write is therefore the one it uses to mean "write nothing". The unit suite pins that, and it caught the bug: schemastery materializes an omitted array as `[]`, so an `=== undefined` guard never fired and the DeepSeek entry wrote `{}` over its whole section.

### A failure is one bounded line

A provider library owns its `Error.message`, and pi-ai's OAuth exchange packs a `stack=` chain of absolute filesystem paths into it. Rendered verbatim, that is a log dump on the one page built to keep such things off screen — which is exactly what the first browser run showed. `connect()` therefore keeps the first line up to the first `stack=`/`details=` marker, bounded at 200 characters, and states a plain sentence when nothing readable is left. It is a readability bound, not redaction: a provider that puts a secret in its first clause would still surface it, and no consumer-side rule can prevent that.

The route it creates carries the connection's own name, and an existing route missing one gets it on the next attempt. A route key is the adapter's vocabulary, and it is what a configuration surface shows when a profile names nothing else — so a person who connected "Claude" would otherwise meet "anthropic" on the Models page and have no way to know they are the same thing. A route already carrying a name keeps it: a name in the document was chosen by somebody, and this is the one field where the product label and a deliberate override collide.

### Detection reads `PATH`, never another product's credentials

`vendorCliInstalled` answers whether `claude` or `codex` is on `PATH`, and it exists for one sentence of copy — "you already use this". Nothing opens, parses, or copies a credential out of those tools' storage. The probe never executes the command either, so a vendor tool that is present but broken, or that prompts on launch, cannot affect a configuration page.

## Alternatives considered

**Lift the existing sign-in out of the vendor's own credential file.** Claude Code stores a Claude Pro/Max grant and Codex stores a ChatGPT one; reading them would make "connect" instant for anyone who already has those tools. Rejected on two independent grounds. Those file formats carry no compatibility promise, so the feature breaks silently whenever either vendor ships a change, and the failure looks like a credential problem rather than a parsing one. And a subscription token issued to one client is not this app's to reuse — using it here is outside those subscriptions' terms regardless of how the bytes were obtained. Signing in fresh with the same account costs the person one click and produces a grant that belongs to this app. Detection stayed; the extraction did not.

**Put the connect flow on the Models page.** It already joins providers, settings, and credentials, and it already owns a first-run credential step. Rejected because the two surfaces answer different questions for different people. Models is a provider-profile editor — route ids, endpoints, protocols, model catalogs — and every one of those is a concept this page exists to keep off screen. A mode switch inside one page would have made the technical half reachable by accident, and the page is already the largest client plugin in the repo.

**Model the whole thing as a thin `ctx.authorization` mirror on the wire and join in the browser.** Rejected because three of the four inputs are Host-only (`ctx.llm`'s live routes, the settings document, and `PATH`), so the browser would need three more wire reads per render and would compute a different answer than a terminal caller. The join belongs where its inputs are; the BFF holds no other domain's knowledge, so it lives in its own plugin rather than in `apiproxy`.

**An answerable server-request for the prompt.** The carrier's existing approval/question machinery would have worked. Rejected because it would add a third pending registry to a 157 KB file for a conversation that is not session-scoped, and because the event path gives a second tab the same conversation for free.

**Leaving first run to the official-DeepSeek step.** That was this feature's original posture, recorded here as the alternative it now supersedes. It was built with a takeover, removed before landing because two would stack for anyone deferring the first, and reinstated once the card could take a typed key — which is what let the narrower step retire instead of coexist. The cost is that the directory only knows the backends it carries: someone whose only usable provider is a route outside `Config.connections` is still asked, where the old step ended for any reachable provider. Deferring is one click and nothing is blocked behind it.

The original reasoning, kept because it is what made the ordering safe: **a first-run takeover of its own.** Built, then removed before landing. `settings.onboarding` already has an occupant — the official-DeepSeek credential step — and registering ahead of it made first run two takeovers deep for anyone who deferred the first, which the existing `onboarding-deepseek-config` and `onboarding-usable-provider` scenarios caught immediately: this step preempted the credential dialog and held the app root inert across a reload where one of them asserts no takeover chrome. Those failures are the design, not the test: which step owns first run is a decision about that flow, and folding it into a page is how a first-run redesign happens by accident. The page is reached through Settings until that decision is made deliberately, and the cost is recorded as a limitation rather than hidden — someone with no credential still meets the narrower DeepSeek question and has to find Settings to reach Claude or Codex.

**A `dsh login` command in the same change.** Deferred, not rejected. The launcher's modes boot a named profile, and a shipped `login` profile is a decision about how profiles are scaffolded on install — larger than this feature should make on its own. `examples/anthropic-login` still covers the terminal case, and it got smaller here: the seam row it used to insert now comes from the base bundle.

## Testing

Unit coverage is per-file 100% on both packages: the four-state truth table across both key spaces, the conversation including a refused stale `promptId`, the declined and failed settlements, the idempotent route write, the no-settings-provider path, and the `PATH` probe including the Windows `PATHEXT` rule (pure, so it runs on macOS and Linux).

`apps/web/tests/connections-settings.e2e.ts` drives the real page in a browser against a real booted tree with zero model calls: Connect offered only where a flow exists, a credential written through the seam converging the open page to `setup-required`, Finish setup writing the route and flipping the card to connected, the activate gesture landing in `agent-default-model`, and the named confirmation keeping the credential on dismiss. It defers the shipped first-run step to reach Settings, which is what a person does today.

The composition itself is pinned in `packages/bundle/base/tests/base.spec.ts`: mounting `llm-pi-ai` without the `authorization` seam composes a tree where no provider can ever be signed into, and nothing at runtime reports it — the flows simply never register.

## Consequences

First run is now this page: three backends in product terms, one button each, and a masked key field where a backend takes one instead of a sign-in. The vocabulary a person reads never includes credential, reference, record, route, provider, or namespace. `ui-settings-models` no longer registers its credential step; the component and its readiness projection stay exported for a composition that wants the narrow one.

The cost is a fifth place that knows about backends. `Config.connections` restates each one's route key, default model, settings address, and credential address, all of which the adapter and its settings schema already know in their own vocabulary. Nothing derives one from the other, so adding a backend to the shipped bundle is a configuration edit in two files, and a route renamed in an adapter leaves a connection entry pointing at nothing until someone notices.

Mounting the seam in the base bundle collides with any user layer that already inserts it. Everyone who followed the `anthropic-login` example's earlier instructions has a `- id: authorization` row in `$DSH_HOME/cordis.patch.yml`, and every profile they own now fails to boot with `duplicate loader entry id: authorization`. The pre-release stance takes the hard failure over a shim, so the example's README carries the one-row deletion; nothing detects the collision and rewrites it.

Two limits are inherited rather than introduced. An authorization attempt lives only in the process that started it, so a reload mid-sign-in abandons it and the card can only warn. And `disconnect()` forgets locally without telling the issuer, because no seam here has a place to declare a revoke.

## Related

- [capability seams](../architecture/2026-06-13-capability-seams.md) — the Service Definition / Provider / Consumer split this service deliberately does not claim: it is a product-shaped join over four seams, with one implementation.
- [web config plane](../architecture/2026-07-30-web-config-plane.md) — the Models page whose vocabulary this page exists to stay out of.
