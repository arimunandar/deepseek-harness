# dsh-connections

English | [中文](README.zh.md)

Connection directory (`ctx.connections`). Whether a person can start a conversation with a given backend is a join over four owners — a sign-in flow on [`ctx.authorization`](../authorization/README.md), a credential recorded with [`ctx.credentials`](../credentials/README.md), a model route registered on `ctx.llm`, and the default selection held by `ctx.agentDefaultModel`. Each answers its own question correctly and none answers that one. This service performs the join, names the result in the four words a badge can carry, and exposes exactly the repairs those states imply — so a surface renders a card per backend without knowing that credential references, record scopes, settings namespaces, or provider routes exist.

**Which backends exist is configuration, not code.** `Config.connections` names them, because the answer varies by deployment and by which adapters are composed. The shipped bundles name the three they ship; another composition names its own.

## The four states

| Status | The join that produces it | The repair |
|---|---|---|
| `connected` | credential stored **and** a route reads it | none |
| `setup-required` | credential stored, no route | `finishSetup()` writes the route |
| `needs-attention` | route live, credential missing or supplied read-only | sign in again, or fix the launch environment |
| `not-connected` | nothing stored | `connect()` |

`attention` names which of those the state means, so a surface picks copy without re-deriving the join. `credential-read-only` is the one repair this package refuses to attempt: a value in the launch environment shadows the writable layer, the credential seam rejects the write rather than letting resolution keep returning the shadowing value, and reporting success would be a lie.

## Surface

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connections'

declare const ctx: Context

await ctx.connections.list()                       // ConnectionView[] — never a credential value
await ctx.connections.connect('claude', 'oauth')   // resolves when the sign-in settles
ctx.connections.answer('claude', '3', 'ABC-123')   // answers the question that attempt asked
ctx.connections.cancel('claude')                   // withdraws it, here or in the tab that started it
await ctx.connections.finishSetup('claude')        // the setup-required repair; idempotent
await ctx.connections.activate('claude')           // new conversations start here
await ctx.connections.disconnect('claude')         // forgets what is stored; never revokes
```

Every method is a Typert `@Remote`, so one implementation serves a terminal caller in-process and a browser through the Gateway.

## The conversation crosses as events, not as a second wire quadrant

`connect()` resolves when the attempt settles — however long the person takes in their browser. While it runs, the flow's notices and questions reach every watching surface as `connections/notice` and `connections/prompt`, and the answer returns through the ordinary unary `answer()` rather than through the open call. So a sign-in needs no server-initiated request quadrant, no pending-response table in a carrier, and no special client: a second tab watching the same connection sees the same conversation and can answer it.

`promptId` is what makes a late answer safe. A question that has been superseded is refused rather than applied to its successor, which is the difference between "your code expired, here is a new one" and a code silently answering the wrong question.

`connections/changed` carries no payload. The join spans four owners, and no single owner's increment describes the resulting state, so every consumer re-reads the whole directory. The service subscribes to `credentials/reference-updated`, `credentials/record-updated`, `llm/adapters-updated`, and `authorization/settled` and folds all four into that one signal.

## Nothing is read out of another product's files

`vendorCliInstalled` answers whether the vendor's own command-line tool is on `PATH`, and it exists for one sentence of copy — "you already use this". Nothing here opens, parses, or copies a credential out of that tool's storage. Those formats carry no compatibility promise, and a subscription token issued to one client is not this app's to reuse. A person who already has the vendor's tool signs in here with the same account, which takes one click and produces a grant that belongs to this app. The probe never executes the command, so a vendor tool that is present but broken, or that would prompt on launch, cannot affect a configuration page.

## A failure is one bounded line

A flow's own words are the useful half of a failure, but a provider library is free to pack whatever it likes into `Error.message` — pi-ai's OAuth exchange embeds a `stack=` chain of absolute filesystem paths — and this string is rendered verbatim on a page whose purpose is to keep that kind of thing off screen. So `connect()` cuts the message at the first `stack=`/`details=` marker, keeps its first line, and bounds it at 200 characters. A message with nothing readable left becomes a plain statement that the sign-in did not complete.

This is a readability bound, not a redaction guarantee: a provider that puts a secret in the first clause of its message would still surface it, which no consumer-side rule can prevent.

## A successful sign-in writes the route

A stored credential no route reads is not a connection anyone can use, and asking a person to press a second button for it would be asking them about plumbing. So `connect()` follows an authorized attempt with the route write, skipped when a route already exists — a reconnect never overwrites a profile someone tuned. A deployment with no settings provider composes its routes in `cordis.yml`, where this package has nothing to write and the route is already whatever that document says.

The route it creates carries the connection's own name. A route key is the adapter's vocabulary — `anthropic`, `openai-codex` — and it is what a configuration surface shows when a profile names nothing else, so somebody who connected "Claude" would otherwise have to recognize it as "anthropic" on the Models page. An existing route missing that name gets it on the next `connect()` or `finishSetup()`; a route already carrying one keeps it, because a name in the document was chosen by somebody and the product label loses to a deliberate override.

## Model Experience

Indirectly, through the backend a person connects here, which owns every model-visible surface once it is selected.

#### KV Cache effect

No direct effect; credentials and connection state never enter a request prefix.

## Known Limitations and Deferred Work

- **A sign-in lives only in the process that started it** — the authorization seam holds no store for attempts, so reloading a page mid-login abandons it and the person starts over. A surface must say so rather than implying the attempt survives.
- **Nothing revokes** — `disconnect()` is `deleteRecord`/`unset`, which forgets the credential locally without telling the issuer. A provider needing a server-side revoke has no place to declare one.
- **`activate()` names one model per connection** — `defaultModel` is a configuration constant, so a backend whose flagship changes needs a configuration edit. The composer's model picker remains the per-conversation answer.
- **The route write covers `providers.<route>` alone** — a connection whose adapter wants more than a profile under that path is composition, not something this package can create.
- **Detection is a `PATH` lookup** — a vendor tool installed outside `PATH`, or reachable only through a shell alias or function, reads as absent. The consequence is one missing sentence of copy, never a wrong status.
