/**
 * Connections page store. The Host owns every fact — `connections.list()` is
 * the whole directory, and each mutation writes through the wire and re-reads —
 * so this store adds exactly one thing the Host cannot hold: the running
 * sign-in conversation, which is per-surface by construction because the
 * notices and questions of an attempt reach whichever surfaces are watching.
 */

import type { ClientRemote, ConnectionNotice, ConnectionPrompt, ConnectionView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** What a person is currently being told and asked about one sign-in. */
export interface ConnectionConversation {
  /**
   * Whether the attempt this surface started is still running.
   *
   * Local, and deliberately not read from the directory: the Host's
   * `connecting` needs a round trip to arrive, and the card must become the
   * conversation the moment the button is pressed rather than a request later.
   * A surface that did not start the attempt renders it from `connecting`
   * instead, which is what `connections/changed` delivers.
   */
  running: boolean
  /** Everything the flow has said so far, oldest first. */
  notices: readonly ConnectionNotice[]
  /** The question waiting for an answer, or null when none is open. */
  prompt: ConnectionPrompt | null
  /** How the last finished attempt ended, in the flow's own words. */
  failure: string | null
}

/** Page snapshot. */
export interface ConnectionsState {
  /** Whether the directory has been read yet, and whether that read worked. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-directory read failure; per-card failures live in the conversation. */
  error: string | null
  /** Every offered connection, in the order the Host declared them. */
  rows: readonly ConnectionView[]
  /**
   * The running conversation of each connection that has one, keyed by
   * connection id. Mutable because the store edits it through an immer draft;
   * every reader treats a published snapshot as frozen.
   */
  conversations: Record<string, ConnectionConversation>
  /** The connection whose card is expanded, or null when the list is collapsed. */
  expanded: string | null
  /** The connection a confirmation dialog is currently asking about, or null. */
  confirming: string | null
}

/** Initial page state, before the first directory read. */
export const EMPTY_CONNECTIONS_STATE: ConnectionsState = {
  status: 'idle',
  error: null,
  rows: [],
  conversations: {},
  expanded: null,
  confirming: null,
}

/** A conversation with nothing said and nothing asked. */
const EMPTY_CONVERSATION: ConnectionConversation = { running: false, notices: [], prompt: null, failure: null }

/**
 * The conversation of one connection inside a draft, started if this is the
 * first thing its attempt has said.
 * @param draft - the state draft being edited.
 * @param id - connection id.
 * @returns the draft's own conversation object, safe to mutate.
 */
function conversationOf(draft: ConnectionsState, id: string): ConnectionConversation {
  const existing = draft.conversations[id]
  if (existing !== undefined) return existing
  const started = { ...EMPTY_CONVERSATION }
  draft.conversations[id] = started
  return started
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a Host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The card actions both surfaces bind, so neither can drift from the other. */
export interface ConnectionCardActions {
  /** Start a sign-in with the named method. */
  onConnect: (method: string) => void
  /** Answer the open question. */
  onAnswer: (promptId: string, value: string) => void
  /** Withdraw the running sign-in. */
  onCancel: () => void
  /** Write the missing route. */
  onFinishSetup: () => void
  /** Make this connection the one new conversations start with. */
  onActivate: () => void
  /** Ask before forgetting the stored credential. */
  onDisconnect: () => void
  /** Show or hide this card's detail. */
  onExpand: (next: boolean) => void
  /** Store the key this backend is reached by. */
  onSaveKey: (value: string) => void
}

/**
 * Bind one card's actions to the store.
 *
 * The settings page and the first-run step render the same card, so they bind
 * the same actions from one place: a surface that wired its own set could
 * silently offer a different repair for the same state.
 * @param controller - the shared page store.
 * @param id - the connection this card shows.
 * @returns the handlers that card takes.
 */
export function cardActions(controller: ConnectionsStore, id: string): ConnectionCardActions {
  return {
    onConnect: (method) => { void controller.connect(id, method) },
    onAnswer: (promptId, value) => { void controller.answer(id, promptId, value) },
    onCancel: () => { void controller.cancel(id) },
    onFinishSetup: () => { void controller.finishSetup(id) },
    onActivate: () => { void controller.activate(id) },
    onDisconnect: () => { controller.confirm(id) },
    onExpand: (next) => { controller.expand(next ? id : null) },
    onSaveKey: (value) => { void controller.saveKey(id, value) },
  }
}

/**
 * Everything the page does, over the generated Remote namespace.
 *
 * Every method that changes Host state re-reads the directory rather than
 * patching a row: the status of one connection is a join over four owners, and
 * a locally-applied increment would be this page's guess at what that join now
 * says.
 */
export class ConnectionsStore {
  /** Page snapshot, subscribed by the section and the first-run step alike. */
  readonly store: SnapshotStore<ConnectionsState> = createSnapshotStore(EMPTY_CONNECTIONS_STATE)

  constructor(private readonly remote: ClientRemote) {}

  /**
   * Read the whole directory, replacing whatever the page last showed.
   * @returns fulfillment after the snapshot is published.
   */
  async load(): Promise<void> {
    this.store.update((draft) => {
      // A refresh keeps the rows already on screen so a pushed invalidation
      // does not blank the page mid-sign-in.
      draft.status = draft.status === 'ready' ? 'ready' : 'loading'
    })
    const result = await this.remote.connections.list()
    if (!result.ok) {
      this.store.update((draft) => {
        draft.status = 'error'
        draft.error = `${result.error.code}: ${result.error.message}`
      })
      return
    }
    this.store.update((draft) => {
      draft.status = 'ready'
      draft.error = null
      draft.rows = result.value
    })
  }

  /**
   * Start a sign-in and stay with it until it settles.
   *
   * The call is long-lived on purpose — it resolves when the person finishes in
   * their browser — so the conversation frames that arrive meanwhile are what
   * the card renders. A failure is kept on the card rather than thrown: this is
   * a configuration page, and the flow's own words are the useful part.
   * @param id - connection id.
   * @param method - one of the method ids the card offered.
   * @returns fulfillment after the attempt settles and the directory is re-read.
   */
  async connect(id: string, method: string): Promise<void> {
    this.store.update((draft) => {
      draft.expanded = id
      draft.conversations[id] = { ...EMPTY_CONVERSATION, running: true }
    })
    const result = await this.remote.connections.connect(id, method)
    this.store.update((draft) => {
      const conversation = conversationOf(draft, id)
      conversation.running = false
      conversation.prompt = null
      conversation.failure = !result.ok
        ? `${result.error.code}: ${result.error.message}`
        : result.value.status === 'failed' ? result.value.message : null
    })
    await this.load()
  }

  /**
   * Answer the question the running sign-in is showing.
   *
   * The question is cleared before the answer is sent, because a person who has
   * pressed Continue must not be able to send the same answer twice; a refused
   * answer restores nothing, since the flow that refused it has already moved
   * on or ended.
   * @param id - connection id.
   * @param promptId - the id the question carried.
   * @param value - the typed text, or the chosen option's id.
   * @returns fulfillment after the answer is delivered.
   */
  async answer(id: string, promptId: string, value: string): Promise<void> {
    this.store.update((draft) => {
      const conversation = draft.conversations[id]
      if (conversation !== undefined) conversation.prompt = null
    })
    await this.remote.connections.answer(id, promptId, value)
  }

  /**
   * Store the key one backend is reached by, and re-read.
   * @param id - connection id.
   * @param value - the key as the person typed it.
   * @returns fulfillment after the write lands and the directory is re-read.
   */
  async saveKey(id: string, value: string): Promise<void> {
    const result = await this.remote.connections.saveKey(id, value)
    this.recordFailure(id, result)
    await this.load()
  }

  /**
   * Withdraw the running sign-in.
   * @param id - connection id.
   * @returns fulfillment after the withdrawal is delivered and the directory re-read.
   */
  async cancel(id: string): Promise<void> {
    this.store.update((draft) => {
      const conversation = draft.conversations[id]
      if (conversation !== undefined) conversation.prompt = null
    })
    await this.remote.connections.cancel(id)
    await this.load()
  }

  /**
   * Write the model route for a connection whose credential is already stored.
   * @param id - connection id.
   * @returns fulfillment after the directory is re-read.
   */
  async finishSetup(id: string): Promise<void> {
    const result = await this.remote.connections.finishSetup(id)
    this.recordFailure(id, result)
    await this.load()
  }

  /**
   * Make this connection the one new conversations start with.
   * @param id - connection id.
   * @returns fulfillment after the directory is re-read.
   */
  async activate(id: string): Promise<void> {
    const result = await this.remote.connections.activate(id)
    this.recordFailure(id, result)
    await this.load()
  }

  /**
   * Forget what is stored for one connection and close the confirmation.
   * @param id - connection id.
   * @returns fulfillment after the directory is re-read.
   */
  async disconnect(id: string): Promise<void> {
    const result = await this.remote.connections.disconnect(id)
    this.store.update((draft) => { draft.confirming = null })
    this.recordFailure(id, result)
    await this.load()
  }

  /**
   * Show or hide one card's detail.
   * @param id - connection id, or null to collapse whatever is open.
   */
  expand(id: string | null): void {
    this.store.update((draft) => { draft.expanded = id })
  }

  /**
   * Open or close the disconnect confirmation.
   * @param id - connection id, or null to close it.
   */
  confirm(id: string | null): void {
    this.store.update((draft) => { draft.confirming = id })
  }

  /**
   * Record what a running sign-in just said.
   * @param notice - the pushed notice.
   */
  receiveNotice(notice: ConnectionNotice): void {
    this.store.update((draft) => {
      const conversation = conversationOf(draft, notice.id)
      conversation.notices = [...conversation.notices, notice]
      draft.expanded = notice.id
    })
  }

  /**
   * Show the question a running sign-in is waiting on.
   * @param prompt - the pushed question.
   */
  receivePrompt(prompt: ConnectionPrompt): void {
    this.store.update((draft) => {
      conversationOf(draft, prompt.id).prompt = prompt
      draft.expanded = prompt.id
    })
  }

  /**
   * Keep a failed write's words on the card that caused it.
   * @param id - connection id.
   * @param result - the wire answer, whose error branch is the only one recorded.
   */
  private recordFailure(id: string, result: { ok: boolean; error?: { code: string; message: string } }): void {
    if (result.ok) return
    const error = result.error
    this.store.update((draft) => {
      conversationOf(draft, id).failure =
        error === undefined ? 'unknown' : `${error.code}: ${error.message}`
    })
  }
}
