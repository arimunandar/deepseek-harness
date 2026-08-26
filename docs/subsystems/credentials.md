# User Credentials

English | [中文](credentials.zh.md)

The credential seam of [dsh-credentials](../../packages/credentials/credentials) keeps secrets out of configuration: settings sections and `cordis.yml` entries carry *references* (environment-variable names), providers such as [dsh-credentials-local](../../packages/credentials/credentials-local) own the values, and consumers resolve a reference once per operation — the LLM adapters resolve once per model request, so a rotated credential reaches the very next request without any restart. One seam-wide rule binds every provider: an empty stored value is absent everywhere.

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## Identity

A reference names one credential as a POSIX-style environment-variable name. The brand prevents callers from mixing credential references with other strings passed between packages or processes; construction validates the shell-identifier syntax.

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## Resolution

`resolve(ref)` returns the value with the provider-defined source layer that supplied it, or `undefined` while unconfigured. Consumers re-resolve at each operation and never cache across operations — that per-operation read is the hot-update mechanism.

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## Description

`describe(ref)` answers configuration surfaces without ever exposing a value: whether the reference resolves, from which layer, and whether `set` would currently succeed. The local provider reports a reference supplied by the live process environment as `writable: false` — a write would appear to succeed while resolution kept returning the shadowing value, so the seam rejects it and the UI can render the reference read-only up front.

```ts type-equiv
/** Source and writability facts for one reference, safe for configuration UIs — never the value. */
interface CredentialInfo {
  /** Whether {@link CredentialProvider.resolve} would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether {@link CredentialProvider.set} would currently succeed for this reference. */
  writable: boolean
}
```

## Change commits

`credentials/reference-updated (ref)` fires after a committed change to a provider-managed source — a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Consumers do not need the event (they re-resolve per operation); it exists for configuration surfaces refreshing a "configured" badge.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauthorization--authorizationservice"></a>

### `ctx.authorization` — `AuthorizationService`

`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.

```ts cordis-catalog
/**
 * Offer a way to obtain one credential. One flow per key: two plugins
 * claiming the same key would each write a record in their own format, and
 * whichever ran last would leave the other reading a payload it cannot parse.
 *
 * @param flow - the key it writes, its label, its methods, and its runner.
 * @returns Disposer that withdraws this flow.
 * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
 */
registerFlow(flow: AuthorizationFlow): () => void

/**
 * Every registered flow, for a surface listing what can be authorized.
 * @returns one entry per flow, in registration order.
 */
list(): readonly AuthorizationEntry[]

/**
 * One registered flow.
 * @param key - the credential record to ask about.
 * @returns the entry, or undefined when no flow claims that key.
 */
describe(key: CredentialKey): AuthorizationEntry | undefined

/**
 * Withdraw the attempt running for a key, if any. Separate from the
 * request's own signal because a request/response transport answers a Cancel
 * button on a second call, with no handle on the first one's signal.
 * @param key - the credential record whose attempt should stop.
 */
cancel(key: CredentialKey): void

/**
 * Run one attempt to authorize a key, and report how it ended.
 *
 * One attempt per key at a time. A second caller is refused rather than
 * joined: the two would be prompting different humans through the same flow,
 * and the second would answer questions the first was asked.
 *
 * @param request - the key, the method, the surface, and the cancel signal.
 * @returns `authorized` once the flow's record is committed during this
 *   attempt and observed, or `cancelled` when the human declined or the
 *   caller withdrew.
 * @throws {AuthorizationError} code `NO_FLOW` when nothing claims the key,
 *   `UNKNOWN_METHOD` when the named method is not one the flow offers,
 *   `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or
 *   `NOT_COMMITTED` when the flow resolved without committing a record
 *   during the attempt.
 */
async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="ctxconnections--connectionsservice"></a>

### `ctx.connections` — `ConnectionsService`

The connection directory, joined per call from its four owners.

Nothing is cached. Every input is owned elsewhere and changes without asking this service — a second tab signs in, `settings.yaml` is edited by hand, a route registers when its profile appears — so a cache here would be a fifth truth to keep synchronized against four that already publish their own change events. `connections/changed` is emitted from those events instead, and every consumer re-reads.

```ts cordis-catalog
/**
 * Describe every offered backend: what it is, whether it is usable, and what
 * a person would press about it.
 * @returns one view per configured connection, in declaration order.
 */
@Remote('list') async list(): Promise<ConnectionView[]>

/**
 * Sign in to one backend and leave it ready to use.
 *
 * The call is long-lived by construction: it resolves when the sign-in
 * settles, which is however long the person takes in their browser. While it
 * runs, the flow's notices and questions reach every watching surface as
 * `connections/notice` and `connections/prompt`, and the answer comes back
 * through {@link answer} rather than through this call.
 *
 * A sign-in that succeeds is followed by the route write, because a stored
 * credential no route reads is not a connection a person can use and asking
 * them to press a second button for it would be asking about plumbing. The
 * write is skipped when a route already exists, so a reconnect never
 * overwrites a profile someone tuned.
 * @param id - connection id.
 * @param method - one of the method ids this connection's flow offers.
 * @returns how the attempt ended, with the flow's own words on failure.
 */
@Remote('connect') async connect(id: string, method: string): Promise<ConnectionOutcome>

/**
 * Connections holding an open question with no attempt running behind it.
 *
 * Read by this package's invariant companion, which is the only caller: the
 * table and the attempt set are both private, so nothing outside can compare
 * them.
 * @returns the offending connection ids, empty when the two agree.
 */
orphanedPrompts(): string[]

/**
 * Answer the question a running sign-in is waiting on.
 * @param id - connection id whose attempt asked.
 * @param promptId - the id the question carried; a stale one is refused.
 * @param value - the typed text, or the chosen option's id.
 * @returns whether the answer reached an open question.
 */
@Remote('answer') answer(id: string, promptId: string, value: string): boolean

/**
 * Withdraw a running sign-in, here or in whichever surface started it.
 * @param id - connection id.
 */
@Remote('cancel') cancel(id: string): void

/**
 * Write the model route for a connection whose credential is already stored.
 *
 * This is the `setup-required` repair, and it is idempotent: a connection
 * that already has a route is left exactly as it is.
 * @param id - connection id.
 */
@Remote('finishSetup') async finishSetup(id: string): Promise<void>

/**
 * Make this connection the one new conversations start with.
 * @param id - connection id.
 */
@Remote('activate') async activate(id: string): Promise<void>

/**
 * Store the key one backend is reached by.
 *
 * The value crosses this seam in one direction and is never read back: the
 * credential seam holds it, and every view here is structurally value-free.
 * A blank is refused rather than stored, because an empty stored value reads
 * as absent everywhere and would leave the card claiming a key it does not
 * have.
 * @param id - connection id.
 * @param value - the key as the person typed it.
 * @returns fulfillment after the credential is stored and the change announced.
 */
@Remote('saveKey') async saveKey(id: string, value: string): Promise<void>

/**
 * Forget what is stored for one connection.
 *
 * This is a local erasure and never a revocation: the issuer is not told,
 * because no seam here has a place to declare one. A credential supplied by
 * a source this deployment cannot write is left untouched — the write would
 * be refused and reporting success would be a lie.
 * @param id - connection id.
 */
@Remote('disconnect') async disconnect(id: string): Promise<void>
```

Source: [`packages/credentials/connections/src/index.ts`](../../packages/credentials/connections/src/index.ts)

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (abstract seam)

Abstract credential service over two key spaces that answer two questions.

A CredentialRef answers "what is behind this environment-variable name", layered over the process environment, the provider-managed store, and `.env` files. One seam-wide rule binds that half: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.

A CredentialKey answers "what credential does this plugin hold for this id". Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and modifyRecord is the only write path because a correct write depends on the current value (a token refresh is read-decide-replace under one lock).

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 * @param ref - the reference to resolve.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>

/**
 * Read one stored record. The value is returned as its owner wrote it; a
 * {@link GrantRecord} payload is not interpreted on the way out.
 * @param key - the record to read.
 * @returns the record, or `undefined` while none is stored.
 */
abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>

/**
 * Describe one record for configuration surfaces without exposing its value.
 * @param key - the record to describe.
 * @returns presence, discriminant, and writability.
 */
abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>

/**
 * Enumerate every stored record's address and tag. Unlike the reference
 * half, which has no enumeration because configuration surfaces learn which
 * references exist from settings schemas, records have no such discovery
 * path: a surface that cannot list them cannot show what a user is
 * authorized for, nor find an orphan left by an uninstalled plugin.
 * @returns every stored record, values excluded.
 */
abstract listRecords(): Promise<readonly CredentialRecordEntry[]>

/**
 * Serialized read-modify-write over one record — the only write path.
 * `mutate` sees the record as it stands at the moment the write is
 * exclusive, and returning `undefined` leaves the entry untouched. Exclusion
 * holds across processes where the backing store supports it, which is what
 * makes a token refresh safe: two processes rotating one refresh token
 * concurrently would otherwise lose whichever wrote first.
 * @param key - the record to modify.
 * @param mutate - receives the current record and returns its replacement, or `undefined` to leave it.
 * @returns the record after the write, or the current one when `mutate` declined.
 */
abstract modifyRecord( key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>, ): Promise<CredentialRecord | undefined>

/**
 * Remove one record; removing an absent record is a no-op.
 * @param key - the record to remove.
 */
abstract deleteRecord(key: CredentialKey): Promise<void>
```

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

<a id="authorization-events"></a>

### `authorization/*` events

<a id="authorizationsettled--emit"></a>

#### `authorization/settled` — emit

One authorization attempt has finished and released its key. Fires for every terminal outcome, failures included, so a surface watching a key it did not start (a second browser tab) learns the attempt is over.

```ts cordis-catalog
/**
 * One authorization attempt has finished and released its key. Fires for
 * every terminal outcome, failures included, so a surface watching a key it
 * did not start (a second browser tab) learns the attempt is over.
 * @mode emit
 * @param key - the credential record the finished attempt was authorizing.
 * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
 */
'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void
```

Source: [`packages/credentials/authorization/src/types.ts`](../../packages/credentials/authorization/src/types.ts)

<a id="connections-events"></a>

### `connections/*` events

<a id="connectionschanged--emit"></a>

#### `connections/changed` — emit

Anything that can change what `list()` answers has changed: an attempt started or settled, a credential was stored or removed, a route registered or dropped, or the active connection moved. Carries no payload because every consumer re-reads the whole directory — the join spans four owners and a per-field increment could not be assembled from any one of them.

```ts cordis-catalog
/**
 * Anything that can change what `list()` answers has changed: an attempt
 * started or settled, a credential was stored or removed, a route
 * registered or dropped, or the active connection moved. Carries no
 * payload because every consumer re-reads the whole directory — the join
 * spans four owners and a per-field increment could not be assembled from
 * any one of them.
 * @mode emit
 */
'connections/changed'(): void
```

Source: [`packages/credentials/connections/src/types.ts`](../../packages/credentials/connections/src/types.ts)

<a id="connectionsnotice--emit"></a>

#### `connections/notice` — emit

A running sign-in has something to tell the person waiting on it. Push only — nothing answers a notice, and a surface that cannot render one loses the notice rather than the attempt.

```ts cordis-catalog
/**
 * A running sign-in has something to tell the person waiting on it. Push
 * only — nothing answers a notice, and a surface that cannot render one
 * loses the notice rather than the attempt.
 * @mode emit
 * @param notice - what is happening, and where to go if anywhere.
 */
'connections/notice'(notice: ConnectionNotice): void
```

Source: [`packages/credentials/connections/src/types.ts`](../../packages/credentials/connections/src/types.ts)

<a id="connectionsprompt--emit"></a>

#### `connections/prompt` — emit

A running sign-in needs an answer before it can continue. The surface that renders it answers through `ctx.connections.answer()`; an attempt whose question is never answered ends when its caller cancels.

```ts cordis-catalog
/**
 * A running sign-in needs an answer before it can continue. The surface
 * that renders it answers through `ctx.connections.answer()`; an attempt
 * whose question is never answered ends when its caller cancels.
 * @mode emit
 * @param prompt - the question, and the id an answer must echo.
 */
'connections/prompt'(prompt: ConnectionPrompt): void
```

Source: [`packages/credentials/connections/src/types.ts`](../../packages/credentials/connections/src/types.ts)

<a id="credentials-events"></a>

### `credentials/*` events

<a id="credentialsrecord-updated--emit"></a>

#### `credentials/record-updated` — emit

Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage. Separate from `credentials/reference-updated` because the two key grammars are disjoint — a listener that received both on one event could not tell which space a subject belongs to. Listener failures are contained on the same terms as `credentials/reference-updated`.

```ts cordis-catalog
/**
 * Committed change to a stored credential record: a `modifyRecord` that
 * wrote, a `deleteRecord` that removed, or an external edit observed in
 * storage. Separate from `credentials/reference-updated` because the two key
 * grammars are disjoint — a listener that received both on one event could
 * not tell which space a subject belongs to. Listener failures are
 * contained on the same terms as `credentials/reference-updated`.
 * @param key - the record whose stored value changed.
 * @mode emit
 */
'credentials/record-updated'(key: CredentialKey): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)

<a id="credentialsreference-updated--emit"></a>

#### `credentials/reference-updated` — emit

Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners, so
 * invariant checks on this event must not be async functions.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/reference-updated'(ref: CredentialRef): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
