/**
 * Client-safe type surface of the connection directory: the four states a
 * surface renders, the per-connection view it renders them from, and the
 * conversation frames a running sign-in pushes. Types only — nothing here
 * reaches a Host-only symbol, so a browser compilation face reads exactly the
 * signature the Host emits.
 *
 * @module @deepseek-ai/dsh-connections/types
 */

/**
 * What a person can do about one connection right now, as the four words a
 * surface puts on a badge.
 *
 * The states are ordered by how much is missing, and each names one repair:
 * `connected` needs nothing, `setup-required` needs the route this package can
 * write, `needs-attention` needs a credential whose absence or read-only
 * source this package cannot resolve alone, and `not-connected` needs a
 * sign-in.
 */
export type ConnectionStatus = 'connected' | 'setup-required' | 'needs-attention' | 'not-connected'

/** Why a connection is not simply `connected`, in terms a surface can render without translating. */
export type ConnectionAttention =
  /** A credential is stored but no model route reads it yet; `finishSetup` writes one. */
  | 'route-missing'
  /** A route is registered but the credential it names resolves to nothing. */
  | 'credential-missing'
  /**
   * The credential is supplied by a source this deployment cannot write — a
   * value in the launch environment. Signing in would appear to succeed while
   * resolution kept returning the shadowing value, so the seam refuses the
   * write and the repair is outside the app.
   */
  | 'credential-read-only'

/** One way to connect, named by the flow that offers it. */
export interface ConnectionMethod {
  /** Flow-owned identifier, echoed back when a surface picks this method. */
  id: string
  /** User-facing label for a button. */
  label: string
}

/** One connectable backend as a surface sees it. Never carries a credential value. */
export interface ConnectionView {
  /** Configuration key of this connection; also what every method here names. */
  id: string
  /** Product name of the backend, as a person knows it. */
  label: string
  /** One plain sentence about what connecting gets them. */
  description: string
  /** What a person can do about it right now. */
  status: ConnectionStatus
  /** Present whenever `status` is not `connected`, naming which repair applies. */
  attention?: ConnectionAttention
  /**
   * The ways this backend can be connected, most preferred first. Empty when
   * no sign-in flow is registered for it, which is what a surface renders as
   * an unavailable card rather than a dead button.
   */
  methods: readonly ConnectionMethod[]
  /** Whether a sign-in for this connection is running right now, here or in another tab. */
  connecting: boolean
  /**
   * Whether this connection currently supplies the model new conversations
   * start with.
   */
  active: boolean
  /**
   * The vendor's own command-line tool was found on this machine. A surface
   * uses it to say "you already use this" — it is never a credential and
   * nothing is read out of that tool's own files.
   */
  vendorCliInstalled: boolean
  /**
   * Whether `disconnect` can remove what is stored. False for a credential a
   * read-only source supplies, which this app did not write and cannot remove.
   */
  disconnectable: boolean
  /**
   * Whether this backend is reached by typing a key rather than signing in.
   *
   * True only where a key would actually take effect: a reference credential
   * this deployment can write. A backend authenticated by a sign-in answers
   * false, and so does one whose reference a read-only source already supplies,
   * because storing a key there would appear to work while resolution kept
   * returning the shadowing value.
   */
  acceptsKey: boolean
}

/** A running sign-in's report to whoever is watching it. Never carries a secret. */
export interface ConnectionNotice {
  /** Connection this notice belongs to. */
  id: string
  /** What is happening, or what the person must do next. */
  message: string
  /** A page the person must open to continue. */
  url?: string
  /** A short code the person must enter on that page. */
  code?: string
}

/** One choice offered by a `select` question. */
export interface ConnectionPromptOption {
  /** Value answered when this option is chosen. */
  id: string
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable surfaces. */
  description?: string
}

/**
 * A question a running sign-in cannot answer for itself. `secret` differs from
 * `text` only in presentation — a surface masks it and keeps it out of logs —
 * and `select` is answered with the chosen option's `id`.
 */
export interface ConnectionPrompt {
  /** Connection this question belongs to. */
  id: string
  /**
   * Identifies this question within its attempt. An answer naming a question
   * that is no longer open is refused rather than applied to its successor.
   */
  promptId: string
  /** How to render the question. */
  kind: 'text' | 'secret' | 'select'
  /** The question itself. */
  message: string
  /** Rendered inside an empty `text` or `secret` field. */
  placeholder?: string
  /** The choices, for `select` alone. */
  options?: readonly ConnectionPromptOption[]
}

/** How one connect attempt ended, as its own caller sees it. */
export type ConnectionOutcome =
  /** The credential is committed and the route reads it. */
  | { status: 'connected' }
  /** The person, or another tab, withdrew. */
  | { status: 'cancelled' }
  /**
   * The attempt broke. `message` is the flow's own words: it is shown to a
   * person, so it must stay free of stack traces and credential material.
   */
  | { status: 'failed'; message: string }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A running sign-in has something to tell the person waiting on it. Push
     * only — nothing answers a notice, and a surface that cannot render one
     * loses the notice rather than the attempt.
     * @mode emit
     * @param notice - what is happening, and where to go if anywhere.
     */
    'connections/notice'(notice: ConnectionNotice): void

    /**
     * A running sign-in needs an answer before it can continue. The surface
     * that renders it answers through `ctx.connections.answer()`; an attempt
     * whose question is never answered ends when its caller cancels.
     * @mode emit
     * @param prompt - the question, and the id an answer must echo.
     */
    'connections/prompt'(prompt: ConnectionPrompt): void

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
  }
}
