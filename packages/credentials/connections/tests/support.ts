/**
 * Doubles for the four owners the connection directory joins, plus the one
 * settings provider it writes through. Each double answers only the questions
 * the join asks, and each is mutable from a test so a suite can move one owner
 * at a time and observe the joined state change.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

/**
 * In-memory credentials provider covering both key spaces: records for the
 * sign-in half, references for the typed-key half.
 */
export class MemoryCredentials extends CredentialProvider {
  /** Stored records, addressed by `<scope>/<id>`. */
  readonly records = new Map<CredentialKey, CredentialRecord>()
  /** Stored reference values, addressed by environment-variable name. */
  readonly refs = new Map<CredentialRef, string>()
  /** References a read-only source shadows, which the seam refuses to write. */
  readonly readOnly = new Set<CredentialRef>()

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.refs.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'file' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({
      configured: this.refs.has(ref),
      ...this.refs.has(ref) ? { source: this.readOnly.has(ref) ? 'env' : 'file' } : {},
      writable: !this.readOnly.has(ref),
    })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    this.refs.set(ref, value)
    this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    if (this.refs.delete(ref)) this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = this.records.get(key)
    return Promise.resolve(stored === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: stored.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.records.get(key))
    if (next === undefined) return this.records.get(key)
    this.records.set(key, next)
    this.ctx.emit('credentials/record-updated', key)
    return next
  }

  override deleteRecord(key: CredentialKey): Promise<void> {
    if (this.records.delete(key)) this.ctx.emit('credentials/record-updated', key)
    return Promise.resolve()
  }
}

/** The provider-route registry, as the join reads it. */
export class MemoryLlm extends Service {
  /** Route keys currently registered, mutable so a test can bring one up. */
  readonly live = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /**
   * Registered routes.
   * @returns one entry per live route.
   */
  listProviders(): { id: string; name: string }[] {
    return [...this.live].map(id => ({ id, name: id }))
  }
}

/** The default model selection new conversations start from. */
export class MemoryDefaultModel extends Service {
  /** The current selection, replaced wholesale by `saveSelection`. */
  selection = { provider: 'none', model: 'none' }

  constructor(ctx: Context) {
    super(ctx, 'agentDefaultModel')
  }

  /**
   * Read the current selection.
   * @returns provider and model.
   */
  currentSelection(): { provider: string; model: string } {
    return this.selection
  }

  /**
   * Replace the current selection.
   * @param next - the accepted selection.
   * @returns fulfillment after it is stored.
   */
  saveSelection(next: { provider: string; model: string }): Promise<void> {
    this.selection = next
    return Promise.resolve()
  }
}

/** The user-settings document, holding one section per namespace. */
export class MemorySettings extends Service {
  /** Section documents by namespace. */
  readonly sections = new Map<string, Record<string, unknown>>()
  /** Every mutate call, in order, so a test can assert what was written. */
  readonly writes: { ns: string; ops: readonly { op: string; path: readonly string[]; value?: unknown }[] }[] = []

  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  /**
   * Read one section.
   * @param ns - namespace name.
   * @returns the stored section, or undefined.
   */
  get(ns: string): unknown {
    return this.sections.get(ns)
  }

  /**
   * Apply path operations to one section.
   * @param ns - namespace name.
   * @param ops - the operations, applied in order.
   * @returns fulfillment after the section is replaced.
   */
  mutate(ns: string, ops: readonly { op: string; path: readonly string[]; value?: unknown }[]): Promise<void> {
    this.writes.push({ ns, ops })
    const section = { ...this.sections.get(ns) }
    for (const operation of ops) {
      let cursor: Record<string, unknown> = section
      const head = operation.path.slice(0, -1)
      const last = operation.path[operation.path.length - 1]
      for (const step of head) {
        const child = cursor[step]
        const next = typeof child === 'object' && child !== null ? child as Record<string, unknown> : {}
        cursor[step] = next
        cursor = next
      }
      if (last !== undefined) cursor[last] = operation.value
    }
    this.sections.set(ns, section)
    return Promise.resolve()
  }
}
