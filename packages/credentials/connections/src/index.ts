/**
 * The connection directory: one product-shaped answer to "can I use this
 * backend yet, and what do I press if not".
 *
 * Whether a person can start a conversation with Claude, Codex, or DeepSeek is
 * a join over four owners — a sign-in flow registered on `ctx.authorization`,
 * a credential recorded with `ctx.credentials`, a model route registered on
 * `ctx.llm`, and the default selection held by `ctx.agentDefaultModel`. Each
 * owner answers its own question correctly and none of them answers that one.
 * This service performs the join, names the result in the four words a badge
 * can carry, and exposes exactly the repairs those four states imply, so a
 * surface renders a card per backend without knowing that credential
 * references, record scopes, settings namespaces, or provider routes exist.
 *
 * What it deliberately does not do is decide which backends a deployment
 * offers. That is `Config.connections`, because the answer varies by
 * deployment and by which adapters are composed; a shipped bundle names the
 * three it ships and another composition names its own.
 *
 * @module @deepseek-ai/dsh-connections
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialKey, credentialRef, isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
// Context augmentation only: ctx.agentDefaultModel carries the active selection.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { commandOnPath } from './detect.ts'
import type {
  ConnectionAttention, ConnectionMethod, ConnectionOutcome, ConnectionPrompt, ConnectionStatus, ConnectionView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Connection directory: what a person can use, and what they press to fix the rest. */
    connections: ConnectionsService
  }
}

/** Where one connection's credential lives, in the key space that addresses it. */
export interface ConnectionCredentialConfig {
  /**
   * `record` addresses a stored grant by `<scope>/<id>` — what a sign-in
   * produces. `reference` addresses an environment-variable name — what a
   * typed API key resolves through. The two key spaces answer different
   * questions and never collide, so a connection names one.
   */
  kind: 'record' | 'reference'
  /** Owning plugin's registered name, for `record` alone. */
  scope?: string
  /** Record id within that scope, for `record` alone. */
  id?: string
  /** Environment-variable name, for `reference` alone. */
  reference?: string
}

/** One backend this deployment offers to connect. */
export interface ConnectionConfig {
  /** Product name of the backend, as a person knows it. */
  label: string
  /** One plain sentence about what connecting gets them. */
  description: string
  /** Where this connection's credential lives. */
  credential: ConnectionCredentialConfig
  /** Provider route key, as `ctx.llm` registers it and a model selection names it. */
  provider: string
  /** Model this connection starts new conversations with once it is active. */
  defaultModel: string
  /** User-settings namespace whose section configures this connection's route. */
  settingsNs: string
  /**
   * Path from that namespace's section root to this connection's profile —
   * the same address `LlmConfigurableProvider.settingsPath` states.
   *
   * Empty means this connection needs no route written at all, which is the
   * case for an adapter that registers its route unconditionally and reads
   * only a credential. Empty rather than absent because the settings path
   * grammar reads an empty path as the section ROOT, and writing there would
   * replace a whole namespace document with this package's profile; the one
   * address this package must never write is therefore the one it uses to mean
   * "write nothing".
   */
  routePath?: string[]
  /**
   * Profile fields written at `routePath` when this package creates the route.
   * Empty for a catalog route that needs nothing beyond its own key.
   */
  profile?: Record<string, unknown>
  /**
   * Bare command name whose presence on PATH means the vendor's own tool is
   * installed here. Used for one sentence of copy; never read for credentials.
   */
  vendorCli?: string
}

/** Which backends this deployment offers, keyed by the id every method names. */
export interface Config {
  /** One entry per offered backend. An empty dict serves an empty directory. */
  connections: Record<string, ConnectionConfig>
}

/** Schema of one connection's credential address. */
const credentialConfig: z<ConnectionCredentialConfig> = z.object({
  kind: z.union(['record', 'reference'] as const).required(),
  scope: z.string(),
  id: z.string(),
  reference: z.string(),
})

/** Schema of one offered backend. */
const connectionConfig: z<ConnectionConfig> = z.object({
  label: z.string().required(),
  description: z.string().required(),
  credential: credentialConfig.required(),
  provider: z.string().required(),
  defaultModel: z.string().required(),
  settingsNs: z.string().required(),
  routePath: z.array(z.string()),
  profile: z.dict(z.any()),
  vendorCli: z.string(),
})

/** One configured backend after the schema's authoring shorthands are resolved. */
interface ResolvedConnection {
  /** Configuration key of this connection. */
  id: string
  /** The entry as configuration wrote it. */
  config: ConnectionConfig
  /** The branded key or reference addressing its credential. */
  credential: ReturnType<typeof resolveCredential>
  /** Where its route profile lives; empty when its adapter registers the route itself. */
  routePath: readonly string[]
  /** The profile written when this package creates the route. */
  profile: Record<string, unknown>
}

/** One open question inside a running attempt, and the answer it is waiting for. */
interface PendingPrompt {
  /** Identifies the question within its attempt; an answer must echo it. */
  promptId: string
  /** Hands the typed value back to the flow. */
  resolve: (value: string) => void
  /** Fails the question as declined, which settles its attempt as cancelled. */
  decline: () => void
}

/**
 * Resolve a configured credential address into the branded key that addresses
 * it, failing loud on an address no key space accepts.
 *
 * Misconfiguration is caught here, at load, rather than at the first click:
 * every field this reads is self-contained in the configuration document.
 * @param id - connection id, named in the failure so the document is searchable.
 * @param config - the credential address to resolve.
 * @returns the record key, or the reference name, that addresses this credential.
 */
function resolveCredential(id: string, config: ConnectionCredentialConfig):
{ kind: 'record'; key: CredentialKey } | { kind: 'reference'; ref: CredentialRef } {
  if (config.kind === 'record') {
    const { scope, id: recordId } = config
    if (scope === undefined || recordId === undefined) {
      throw new TypeError(`connections: "${id}" declares a record credential without both scope and id`)
    }
    if (!isCredentialKeySegment(scope) || !isCredentialKeySegment(recordId)) {
      throw new TypeError(`connections: "${id}" declares a record credential outside the key grammar: ${scope}/${recordId}`)
    }
    return { kind: 'record', key: credentialKey(scope, recordId) }
  }
  const { reference } = config
  if (reference === undefined) {
    throw new TypeError(`connections: "${id}" declares a reference credential without a reference`)
  }
  return { kind: 'reference', ref: credentialRef(reference) }
}

/**
 * Name the one repair a non-connected state implies.
 * @param hasCredential - whether a credential is stored and resolvable.
 * @param routeLive - whether a model route currently reads it.
 * @param writable - whether this deployment can write the credential at all.
 * @returns the attention reason, or undefined when nothing is missing.
 */
function attentionFor(hasCredential: boolean, routeLive: boolean, writable: boolean): ConnectionAttention | undefined {
  if (hasCredential && routeLive) return undefined
  if (hasCredential) return 'route-missing'
  if (!writable) return 'credential-read-only'
  return routeLive ? 'credential-missing' : undefined
}

/**
 * Project the join onto the badge word.
 * @param hasCredential - whether a credential is stored and resolvable.
 * @param routeLive - whether a model route currently reads it.
 * @param attention - the repair this state implies, when it is not connected.
 * @returns the state a surface renders.
 */
function statusFor(hasCredential: boolean, routeLive: boolean, attention: ConnectionAttention | undefined): ConnectionStatus {
  if (hasCredential && routeLive) return 'connected'
  if (attention === 'route-missing') return 'setup-required'
  // No reason left means nothing was ever stored: the person has simply not
  // chosen this backend, which is not a problem to report.
  if (attention === undefined) return 'not-connected'
  // The two remaining reasons — a credential that resolves to nothing and one
  // a read-only source supplies — are both about a credential this surface
  // cannot repair by writing.
  return 'needs-attention'
}

/**
 * How much of a failure a card may show. Long enough for a provider's own
 * sentence, short enough that a page cannot become a log viewer.
 */
const FAILURE_TEXT_LIMIT = 200

/**
 * The part of a failure a person can read.
 *
 * A flow's own words are the useful half, but a provider library is free to
 * pack whatever it likes into `Error.message` — pi-ai's OAuth exchange embeds
 * a `stack=` chain of absolute filesystem paths — and this string is rendered
 * verbatim on a configuration page whose whole purpose is to keep that kind of
 * thing off screen. So the message is cut at the first thing that marks the
 * start of machine detail and bounded, rather than trusted to be a sentence.
 *
 * This is a readability bound, not a redaction guarantee: a provider that puts
 * a secret in the first clause of its message would still surface it, which no
 * consumer-side rule can prevent.
 * @param error - the rejection the attempt failed with.
 * @returns one bounded line, or a plain statement when nothing readable remains.
 */
function readableFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const [firstLine = ''] = raw.split('\n')
  const marker = firstLine.search(/(?:^|[\s;])(?:stack|details)=/)
  const trimmed = (marker < 0 ? firstLine : firstLine.slice(0, marker)).trim().replace(/[;,]$/, '')
  if (trimmed.length === 0) return 'The sign-in did not complete.'
  return trimmed.length <= FAILURE_TEXT_LIMIT ? trimmed : `${trimmed.slice(0, FAILURE_TEXT_LIMIT - 1).trimEnd()}…`
}

/** Restate one flow question as the frame a surface renders, minting its answer id. */
function restate(id: string, promptId: string, prompt: AuthorizationPrompt): ConnectionPrompt {
  return {
    id,
    promptId,
    kind: prompt.kind,
    message: prompt.message,
    ...prompt.kind === 'select'
      ? { options: prompt.options.map(option => ({ ...option })) }
      : prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
  }
}

/**
 * The connection directory, joined per call from its four owners.
 *
 * Nothing is cached. Every input is owned elsewhere and changes without asking
 * this service — a second tab signs in, `settings.yaml` is edited by hand, a
 * route registers when its profile appears — so a cache here would be a fifth
 * truth to keep synchronized against four that already publish their own
 * change events. `connections/changed` is emitted from those events instead,
 * and every consumer re-reads.
 */
export class ConnectionsService extends TypertRemoteService {
  static inject = ['authorization', 'credentials', 'llm', 'agentDefaultModel']

  static Config: z<Config> = z.object({
    connections: z.dict(connectionConfig).default({}),
  })

  /** Configured backends, in declaration order, with every authoring shorthand resolved. */
  private readonly entries: readonly ResolvedConnection[]

  /** The open question of each running attempt, keyed by connection id. */
  private readonly pending = new Map<string, PendingPrompt>()

  /** Connection ids with an attempt this process is currently running. */
  private readonly running = new Set<string>()

  /** Monotonic source of prompt ids; an answer to a superseded question is refused, not applied. */
  private nextPromptId = 0

  constructor(ctx: Context, config: Config) {
    super(ctx, 'connections')
    this.entries = Object.entries(config.connections).map(([id, entry]) => ({
      id,
      config: entry,
      credential: resolveCredential(id, entry.credential),
      // The schema materializes both containers, so an omitted `routePath` or
      // `profile` arrives as an empty one and neither fallback below ever
      // runs; they state the resolved type rather than leaving two optional
      // fields for every reader further down to re-handle.
      /* v8 ignore next */
      routePath: entry.routePath ?? [],
      /* v8 ignore next */
      profile: entry.profile ?? {},
    }))
    // Every owner that can change what list() answers, folded into one signal.
    // A payload-carrying increment is impossible here: the join spans four
    // owners and no single event describes the resulting state.
    for (const event of ['credentials/reference-updated', 'credentials/record-updated', 'llm/adapters-updated', 'authorization/settled'] as const) {
      ctx.on(event, () => { ctx.emit('connections/changed') })
    }
  }

  /**
   * Locate one configured connection, failing with the id a caller supplied.
   * @param id - connection id from a caller.
   * @returns the configured entry.
   */
  private entry(id: string): ResolvedConnection {
    const found = this.entries.find(candidate => candidate.id === id)
    if (found === undefined) throw new TypeError(`connections: no connection named "${id}"`)
    return found
  }

  /**
   * Describe every offered backend: what it is, whether it is usable, and what
   * a person would press about it.
   * @returns one view per configured connection, in declaration order.
   */
  @Remote('list')
  async list(): Promise<ConnectionView[]> {
    const flows = this.ctx.authorization.list()
    const live = new Set(this.ctx.llm.listProviders().map(provider => provider.id))
    const active = this.ctx.agentDefaultModel.currentSelection()
    const views: ConnectionView[] = []
    for (const { id, config, credential } of this.entries) {
      const stored = credential.kind === 'record'
        ? await this.ctx.credentials.describeRecord(credential.key)
        : await this.ctx.credentials.describe(credential.ref)
      const flow = credential.kind === 'record'
        ? flows.find(candidate => candidate.key === credential.key)
        : undefined
      const routeLive = live.has(config.provider)
      const attention = attentionFor(stored.configured, routeLive, stored.writable)
      views.push({
        id,
        label: config.label,
        description: config.description,
        status: statusFor(stored.configured, routeLive, attention),
        ...attention === undefined ? {} : { attention },
        methods: flow?.methods.map((method): ConnectionMethod => ({ id: method.id, label: method.label })) ?? [],
        connecting: flow?.inFlight ?? false,
        active: active.provider === config.provider,
        vendorCliInstalled: config.vendorCli !== undefined && commandOnPath(config.vendorCli),
        disconnectable: stored.configured && stored.writable,
      })
    }
    return views
  }

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
  @Remote('connect')
  async connect(id: string, method: string): Promise<ConnectionOutcome> {
    const entry = this.entry(id)
    if (entry.credential.kind !== 'record') {
      throw new TypeError(`connections: "${id}" authenticates with a stored key and has no sign-in to run`)
    }
    const key = entry.credential.key
    this.running.add(id)
    // An attempt starting is a directory change: `inFlight` flipped, and a
    // surface that did not start it has no other way to learn the connection
    // is busy.
    this.ctx.emit('connections/changed')
    try {
      const outcome = await this.ctx.authorization.begin({
        key,
        method,
        interaction: {
          notify: (notice) => {
            this.ctx.emit('connections/notice', { id, ...notice })
          },
          prompt: prompt => new Promise<string>((resolve, reject) => {
            const promptId = String(this.nextPromptId++)
            this.pending.set(id, {
              promptId,
              resolve,
              decline: () => { reject(new AuthorizationDeclinedError('the person closed the sign-in')) },
            })
            this.ctx.emit('connections/prompt', restate(id, promptId, prompt))
          }),
        },
      })
      if (outcome.status !== 'authorized') return { status: 'cancelled' }
      await this.ensureRoute(id)
      return { status: 'connected' }
    } catch (error) {
      // What reaches a person is one bounded line of the flow's own words; the
      // machine detail a provider packs after it belongs in a log, not a card.
      return { status: 'failed', message: readableFailure(error) }
    } finally {
      this.pending.delete(id)
      this.running.delete(id)
      this.ctx.emit('connections/changed')
    }
  }

  /**
   * Connections holding an open question with no attempt running behind it.
   *
   * Read by this package's invariant companion, which is the only caller: the
   * table and the attempt set are both private, so nothing outside can compare
   * them.
   * @returns the offending connection ids, empty when the two agree.
   */
  orphanedPrompts(): string[] {
    return [...this.pending.keys()].filter(id => !this.running.has(id))
  }

  /**
   * Answer the question a running sign-in is waiting on.
   * @param id - connection id whose attempt asked.
   * @param promptId - the id the question carried; a stale one is refused.
   * @param value - the typed text, or the chosen option's id.
   * @returns whether the answer reached an open question.
   */
  @Remote('answer')
  answer(id: string, promptId: string, value: string): boolean {
    const open = this.pending.get(id)
    if (open === undefined || open.promptId !== promptId) return false
    this.pending.delete(id)
    open.resolve(value)
    return true
  }

  /**
   * Withdraw a running sign-in, here or in whichever surface started it.
   * @param id - connection id.
   */
  @Remote('cancel')
  cancel(id: string): void {
    const entry = this.entry(id)
    this.pending.get(id)?.decline()
    this.pending.delete(id)
    if (entry.credential.kind === 'record') this.ctx.authorization.cancel(entry.credential.key)
  }

  /**
   * Write the model route for a connection whose credential is already stored.
   *
   * This is the `setup-required` repair, and it is idempotent: a connection
   * that already has a route is left exactly as it is.
   * @param id - connection id.
   */
  @Remote('finishSetup')
  async finishSetup(id: string): Promise<void> {
    await this.ensureRoute(id)
    this.ctx.emit('connections/changed')
  }

  /**
   * Make this connection the one new conversations start with.
   * @param id - connection id.
   */
  @Remote('activate')
  async activate(id: string): Promise<void> {
    const { config } = this.entry(id)
    await this.ctx.agentDefaultModel.saveSelection({ provider: config.provider, model: config.defaultModel })
    this.ctx.emit('connections/changed')
  }

  /**
   * Forget what is stored for one connection.
   *
   * This is a local erasure and never a revocation: the issuer is not told,
   * because no seam here has a place to declare one. A credential supplied by
   * a source this deployment cannot write is left untouched — the write would
   * be refused and reporting success would be a lie.
   * @param id - connection id.
   */
  @Remote('disconnect')
  async disconnect(id: string): Promise<void> {
    const { credential } = this.entry(id)
    if (credential.kind === 'record') await this.ctx.credentials.deleteRecord(credential.key)
    else await this.ctx.credentials.unset(credential.ref)
    this.ctx.emit('connections/changed')
  }

  /**
   * Create this connection's provider route when the settings document does
   * not already carry one.
   * @param id - connection id.
   */
  private async ensureRoute(id: string): Promise<void> {
    const { config, routePath, profile } = this.entry(id)
    // An adapter that registers its route unconditionally states no path, and
    // there is nothing to create: the route is live from the moment the
    // adapter mounts and only the credential was ever missing. The empty path
    // is also the section root, which this package must never write.
    if (routePath.length === 0) return
    const settings = this.ctx.get('settings')
    // A deployment without a settings provider composes its routes in
    // cordis.yml, where this package has nothing to write and the route is
    // already whatever that document says.
    if (settings === undefined) return
    const ns = settingsNamespace(config.settingsNs)
    if (readPath(settings.get(ns), routePath) !== undefined) return
    await settings.mutate(ns, [{ op: 'set', path: [...routePath], value: profile }])
  }
}

/**
 * Whether a settings value is a plain object this code may index.
 * @param value - the value read out of a settings section.
 * @returns whether it can be indexed as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one path out of a settings section.
 * @param section - the section root, whatever the document holds there.
 * @param path - field names from that root, as configuration states them.
 * @returns the value at that path, or undefined when any step is absent.
 */
function readPath(section: unknown, path: readonly string[]): unknown {
  let cursor = section
  for (const step of path) {
    if (!isRecord(cursor)) return undefined
    cursor = cursor[step]
  }
  return cursor
}

export default ConnectionsService
