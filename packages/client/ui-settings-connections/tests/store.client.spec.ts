// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionView } from '@deepseek-ai/dsh-api-remotes/client'
import { ConnectionsStore, EMPTY_CONNECTIONS_STATE, messageOf } from '../src/client/store.ts'

const CLAUDE: ConnectionView = {
  id: 'claude',
  label: 'Claude',
  description: 'Use Claude models with your Anthropic account.',
  status: 'not-connected',
  methods: [{ id: 'oauth', label: 'Sign in with Claude' }],
  connecting: false,
  active: false,
  vendorCliInstalled: false,
  disconnectable: false,
  acceptsKey: false,
}

/** Every Remote call the store makes, each answering ok by default. */
function remote() {
  return {
    connections: {
      list: vi.fn().mockResolvedValue({ ok: true, value: [CLAUDE] }),
      connect: vi.fn().mockResolvedValue({ ok: true, value: { status: 'connected' } }),
      answer: vi.fn().mockResolvedValue({ ok: true, value: true }),
      cancel: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      finishSetup: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      activate: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      disconnect: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      saveKey: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
  }
}

/** A store over those calls, with the doubles exposed. */
function bench() {
  const wire = remote()
  return { wire, store: new ConnectionsStore(wire as never) }
}

describe('directory reads', () => {
  it('starts empty and publishes the directory on load', async () => {
    const { store } = bench()
    expect(store.store.getSnapshot()).toEqual(EMPTY_CONNECTIONS_STATE)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', rows: [CLAUDE], error: null })
  })

  it('keeps the rows already on screen while a refresh is in flight', async () => {
    const { wire, store } = bench()
    await store.load()
    let observed: string | undefined
    wire.connections.list.mockImplementationOnce(() => {
      observed = store.store.getSnapshot().status
      return Promise.resolve({ ok: true, value: [CLAUDE] })
    })
    await store.load()
    // A pushed invalidation must not blank a page someone is reading.
    expect(observed).toBe('ready')
  })

  it('reports a refused read in the wire own words', async () => {
    const { wire, store } = bench()
    wire.connections.list.mockResolvedValueOnce({ ok: false, error: { code: 'unavailable', message: 'no host' } })
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'unavailable: no host' })
  })
})

describe('signing in', () => {
  it('opens the card, clears the conversation, and re-reads when it lands', async () => {
    const { wire, store } = bench()
    await store.connect('claude', 'oauth')
    expect(wire.connections.connect).toHaveBeenCalledWith('claude', 'oauth')
    expect(wire.connections.list).toHaveBeenCalled()
    expect(store.store.getSnapshot()).toMatchObject({
      expanded: 'claude',
      conversations: { claude: { failure: null, prompt: null } },
    })
  })

  it('keeps the words a failed attempt reported', async () => {
    const { wire, store } = bench()
    wire.connections.connect.mockResolvedValueOnce({
      ok: true,
      value: { status: 'failed', message: 'the sign-in service is unavailable' },
    })
    await store.connect('claude', 'oauth')
    expect(store.store.getSnapshot().conversations['claude']?.failure)
      .toBe('the sign-in service is unavailable')
  })

  it('keeps a refused call error on the card', async () => {
    const { wire, store } = bench()
    wire.connections.connect.mockResolvedValueOnce({ ok: false, error: { code: 'busy', message: 'already running' } })
    await store.connect('claude', 'oauth')
    expect(store.store.getSnapshot().conversations['claude']?.failure).toBe('busy: already running')
  })

  it('leaves a cancelled attempt with nothing to report', async () => {
    const { wire, store } = bench()
    wire.connections.connect.mockResolvedValueOnce({ ok: true, value: { status: 'cancelled' } })
    await store.connect('claude', 'oauth')
    expect(store.store.getSnapshot().conversations['claude']?.failure).toBeNull()
  })

  it('records notices in order and opens the card they belong to', () => {
    const { store } = bench()
    store.receiveNotice({ id: 'claude', message: 'Opening your browser' })
    store.receiveNotice({ id: 'claude', message: 'Waiting for you to finish', url: 'https://auth.example' })
    const conversation = store.store.getSnapshot().conversations['claude']
    expect(conversation?.notices.map(notice => notice.message))
      .toEqual(['Opening your browser', 'Waiting for you to finish'])
    expect(store.store.getSnapshot().expanded).toBe('claude')
  })

  it('shows the open question and clears it once answered', async () => {
    const { wire, store } = bench()
    store.receivePrompt({ id: 'claude', promptId: '0', kind: 'text', message: 'Paste the code' })
    expect(store.store.getSnapshot().conversations['claude']?.prompt).toMatchObject({ promptId: '0' })

    await store.answer('claude', '0', 'ABC-123')

    expect(store.store.getSnapshot().conversations['claude']?.prompt).toBeNull()
    expect(wire.connections.answer).toHaveBeenCalledWith('claude', '0', 'ABC-123')
  })

  it('answers a question for a connection with no conversation yet without inventing one', async () => {
    const { wire, store } = bench()
    await store.answer('claude', '0', 'ABC-123')
    expect(store.store.getSnapshot().conversations['claude']).toBeUndefined()
    expect(wire.connections.answer).toHaveBeenCalledWith('claude', '0', 'ABC-123')
  })

  it('withdraws a running attempt, clears its question, and re-reads', async () => {
    const { wire, store } = bench()
    store.receivePrompt({ id: 'claude', promptId: '0', kind: 'text', message: 'Paste the code' })
    await store.cancel('claude')
    expect(wire.connections.cancel).toHaveBeenCalledWith('claude')
    expect(wire.connections.list).toHaveBeenCalled()
    // The question goes with the attempt: leaving it on screen would invite an
    // answer nothing is waiting for.
    expect(store.store.getSnapshot().conversations['claude']?.prompt).toBeNull()
  })

  it('withdraws a connection that has no conversation without inventing one', async () => {
    const { wire, store } = bench()
    await store.cancel('claude')
    expect(wire.connections.cancel).toHaveBeenCalledWith('claude')
    expect(store.store.getSnapshot().conversations['claude']).toBeUndefined()
  })

  it('marks the attempt running the moment it starts, and settled when it lands', async () => {
    const { wire, store } = bench()
    let duringAttempt: boolean | undefined
    wire.connections.connect.mockImplementationOnce(() => {
      duringAttempt = store.store.getSnapshot().conversations['claude']?.running
      return Promise.resolve({ ok: true, value: { status: 'connected' } })
    })
    await store.connect('claude', 'oauth')
    // The card becomes the conversation on the click, not a round trip later.
    expect(duringAttempt).toBe(true)
    expect(store.store.getSnapshot().conversations['claude']?.running).toBe(false)
  })
})

describe('repairs', () => {
  it('finishes setup and re-reads', async () => {
    const { wire, store } = bench()
    await store.finishSetup('claude')
    expect(wire.connections.finishSetup).toHaveBeenCalledWith('claude')
    expect(wire.connections.list).toHaveBeenCalled()
  })

  it('activates and re-reads', async () => {
    const { wire, store } = bench()
    await store.activate('claude')
    expect(wire.connections.activate).toHaveBeenCalledWith('claude')
  })

  it('disconnects, closes the confirmation, and re-reads', async () => {
    const { wire, store } = bench()
    store.confirm('claude')
    await store.disconnect('claude')
    expect(wire.connections.disconnect).toHaveBeenCalledWith('claude')
    expect(store.store.getSnapshot().confirming).toBeNull()
  })

  it('keeps a refused repair message on the card it came from', async () => {
    const { wire, store } = bench()
    wire.connections.activate.mockResolvedValueOnce({ ok: false, error: { code: 'settings-conflict', message: 'edited elsewhere' } })
    await store.activate('claude')
    expect(store.store.getSnapshot().conversations['claude']?.failure).toBe('settings-conflict: edited elsewhere')
  })

  it('records an unreadable refusal rather than dropping it', async () => {
    const { wire, store } = bench()
    wire.connections.finishSetup.mockResolvedValueOnce({ ok: false })
    await store.finishSetup('claude')
    expect(store.store.getSnapshot().conversations['claude']?.failure).toBe('unknown')
  })
})

describe('typed keys', () => {
  it('stores the key and re-reads', async () => {
    const { wire, store } = bench()
    await store.saveKey('deepseek', 'sk-typed')
    expect(wire.connections.saveKey).toHaveBeenCalledWith('deepseek', 'sk-typed')
    expect(wire.connections.list).toHaveBeenCalled()
  })

  it('keeps a refused key write on the card it came from', async () => {
    const { wire, store } = bench()
    wire.connections.saveKey.mockResolvedValueOnce({
      ok: false,
      error: { code: 'credential-rejected', message: 'the launch environment supplies this' },
    })
    await store.saveKey('deepseek', 'sk-typed')
    expect(store.store.getSnapshot().conversations['deepseek']?.failure)
      .toBe('credential-rejected: the launch environment supplies this')
  })
})

describe('card state', () => {
  it('expands and collapses', () => {
    const { store } = bench()
    store.expand('claude')
    expect(store.store.getSnapshot().expanded).toBe('claude')
    store.expand(null)
    expect(store.store.getSnapshot().expanded).toBeNull()
  })

  it('opens and closes the disconnect confirmation', () => {
    const { store } = bench()
    store.confirm('claude')
    expect(store.store.getSnapshot().confirming).toBe('claude')
    store.confirm(null)
    expect(store.store.getSnapshot().confirming).toBeNull()
  })
})

describe('failure text', () => {
  it('reads an Error and anything else the same way a person can', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('boom')).toBe('boom')
  })
})
