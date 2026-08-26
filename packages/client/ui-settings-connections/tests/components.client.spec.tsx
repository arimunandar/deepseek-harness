// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConnectionView } from '@deepseek-ai/dsh-api-remotes/client'
import { ConnectionCard } from '../src/client/ConnectionCard.tsx'
import { ConnectionsSection } from '../src/client/ConnectionsSection.tsx'
import { EMPTY_CONNECTIONS_STATE } from '../src/client/store.ts'
import type { ConnectionsState, ConnectionsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import type { ConnectionsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: ConnectionsLocaleKey): string => en[key]

/** A row in one of the four states, with the fields that state implies. */
function view(overrides: Partial<ConnectionView> = {}): ConnectionView {
  return {
    id: 'claude',
    label: 'Claude',
    description: 'Use Claude models with your Anthropic account.',
    status: 'not-connected',
    methods: [{ id: 'oauth', label: 'Sign in with Claude' }],
    connecting: false,
    active: false,
    vendorCliInstalled: false,
    disconnectable: false,
    ...overrides,
  }
}

/** Every card action, so a test asserts which one a button reached. */
function actions() {
  return {
    onConnect: vi.fn(),
    onAnswer: vi.fn(),
    onCancel: vi.fn(),
    onFinishSetup: vi.fn(),
    onActivate: vi.fn(),
    onDisconnect: vi.fn(),
    onExpand: vi.fn(),
  }
}

describe('one card', () => {
  it('offers Connect for a backend nobody has chosen', () => {
    const handlers = actions()
    render(<ConnectionCard row={view()} conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.getByText('Not connected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(handlers.onConnect).toHaveBeenCalledWith('oauth')
  })

  it('says so when the vendor tool is already installed, and never before connecting', () => {
    const handlers = actions()
    const { rerender } = render(
      <ConnectionCard row={view({ vendorCliInstalled: true })} conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.getByText(en.alreadyInstalled)).toBeTruthy()
    rerender(
      <ConnectionCard
        row={view({ vendorCliInstalled: true, status: 'connected', disconnectable: true })}
        conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.queryByText(en.alreadyInstalled)).toBeNull()
  })

  it('offers Finish setup, and says what is missing, when only the route is', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ status: 'setup-required', attention: 'route-missing', disconnectable: true })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.getByText(en.whyRouteMissing)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(handlers.onFinishSetup).toHaveBeenCalled()
  })

  it('offers a fresh sign-in when the stored one stopped working', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ status: 'needs-attention', attention: 'credential-missing' })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.getByText(en.whyCredentialMissing)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(handlers.onConnect).toHaveBeenCalledWith('oauth')
  })

  it('names the Models page, not a sign-in, for a key backend with no stored key', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ status: 'needs-attention', attention: 'credential-missing', methods: [] })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    // There is no button here, so the sentence has to be the instruction.
    expect(screen.getByText(en.whyKeyMissing)).toBeTruthy()
    expect(screen.queryByText(en.whyCredentialMissing)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull()
  })

  it('offers no button for a credential this app cannot write', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ status: 'needs-attention', attention: 'credential-read-only' })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.getByText(en.whyCredentialReadOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull()
  })

  it('offers use-for-new-chats once connected, and says so once it is in use', () => {
    const handlers = actions()
    const { rerender } = render(<ConnectionCard
      row={view({ status: 'connected', disconnectable: true })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use for new chats' }))
    expect(handlers.onActivate).toHaveBeenCalled()

    rerender(<ConnectionCard
      row={view({ status: 'connected', active: true, disconnectable: true })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.getByText('In use')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use for new chats' })).toBeNull()
  })

  it('offers Disconnect only for something this app stored', () => {
    const handlers = actions()
    const { rerender } = render(<ConnectionCard
      row={view({ status: 'connected', disconnectable: true })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(handlers.onDisconnect).toHaveBeenCalled()

    rerender(<ConnectionCard
      row={view({ status: 'connected', disconnectable: false })}
      conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('says a backend cannot be connected rather than showing a dead button', () => {
    const handlers = actions()
    render(<ConnectionCard row={view({ methods: [] })} conversation={undefined} expanded={false} t={t} {...handlers} />)
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })
})

describe('a running sign-in', () => {
  it('shows the latest notice, its page, its code, and the keep-open warning', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ connecting: true })}
      conversation={{
        running: true,
        notices: [
          { id: 'claude', message: 'Opening your browser' },
          { id: 'claude', message: 'Finish in your browser', url: 'https://auth.example', code: 'AB-CD' },
        ],
        prompt: null,
        failure: null,
      }}
      expanded={false} t={t} {...handlers} />)

    expect(screen.getByText(en.keepTabOpen)).toBeTruthy()
    expect(screen.getByText('Finish in your browser')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.openPage }).getAttribute('href')).toBe('https://auth.example')
    expect(screen.getByText('AB-CD')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(handlers.onCancel).toHaveBeenCalled()
  })

  it('asks a text question and sends the typed answer once', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ connecting: true })}
      conversation={{
        running: true,
        notices: [],
        prompt: { id: 'claude', promptId: '7', kind: 'text', message: 'Paste the code', placeholder: 'AB-CD' },
        failure: null,
      }}
      expanded={false} t={t} {...handlers} />)

    const field = screen.getByLabelText('Paste the code') as HTMLInputElement
    expect(field.type).toBe('text')
    expect(field.placeholder).toBe('AB-CD')
    // Continue stays inert until there is something to send.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(true)

    fireEvent.change(field, { target: { value: 'AB-CD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(handlers.onAnswer).toHaveBeenCalledWith('7', 'AB-CD')
  })

  it('sends nothing when the field is empty and the form is submitted anyway', () => {
    const handlers = actions()
    const { container } = render(<ConnectionCard
      row={view({ connecting: true })}
      conversation={{
        running: true,
        notices: [],
        prompt: { id: 'claude', promptId: '8', kind: 'text', message: 'Paste the code' },
        failure: null,
      }}
      expanded={false} t={t} {...handlers} />)
    // Enter in an empty field reaches submit past the disabled button.
    fireEvent.submit(container.querySelector('form')!)
    expect(handlers.onAnswer).not.toHaveBeenCalled()
  })

  it('copies the code the flow showed', () => {
    const handlers = actions()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ConnectionCard
      row={view({ connecting: true })}
      conversation={{
        running: true,
        notices: [{ id: 'claude', message: 'Enter this code', code: 'AB-CD' }],
        prompt: null,
        failure: null,
      }}
      expanded={false} t={t} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: en.copyCode }))
    expect(writeText).toHaveBeenCalledWith('AB-CD')
  })

  it('masks a secret question', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ connecting: true })}
      conversation={{
        running: true,
        notices: [],
        prompt: { id: 'claude', promptId: '1', kind: 'secret', message: 'Paste your key' },
        failure: null,
      }}
      expanded={false} t={t} {...handlers} />)
    expect(screen.getByLabelText<HTMLInputElement>('Paste your key').type).toBe('password')
  })

  it('answers a select question with the chosen option', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ connecting: true })}
      conversation={{
        running: true,
        notices: [],
        prompt: {
          id: 'claude',
          promptId: '2',
          kind: 'select',
          message: 'Which account?',
          options: [{ id: 'work', label: 'Work' }, { id: 'personal', label: 'Personal' }],
        },
        failure: null,
      }}
      expanded={false} t={t} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }))
    expect(handlers.onAnswer).toHaveBeenCalledWith('2', 'personal')
  })

  it('shows a select question with no options as an empty choice list rather than crashing', () => {
    const handlers = actions()
    render(<ConnectionCard
      row={view({ connecting: true })}
      conversation={{
        running: true,
        notices: [],
        prompt: { id: 'claude', promptId: '3', kind: 'select', message: 'Which account?' },
        failure: null,
      }}
      expanded={false} t={t} {...handlers} />)
    expect(screen.getByText('Which account?')).toBeTruthy()
  })

  it('reports a failure once the attempt is over, and offers the notice history', () => {
    const handlers = actions()
    const { rerender } = render(<ConnectionCard
      row={view()}
      conversation={{
        running: false,
        notices: [{ id: 'claude', message: 'Opening your browser' }],
        prompt: null,
        failure: 'the sign-in service is unavailable',
      }}
      expanded={false} t={t} {...handlers} />)

    expect(screen.getByRole('alert').textContent).toBe('the sign-in service is unavailable')
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(handlers.onExpand).toHaveBeenCalledWith(true)

    rerender(<ConnectionCard
      row={view()}
      conversation={{ running: false, notices: [{ id: 'claude', message: 'Opening your browser' }], prompt: null, failure: null }}
      expanded t={t} {...handlers} />)
    expect(screen.getByText('Opening your browser')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '−' }))
    expect(handlers.onExpand).toHaveBeenLastCalledWith(false)
  })
})

/** A store double whose snapshot a test drives directly. */
function controllerFor(state: ConnectionsState) {
  const calls = {
    load: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    answer: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    finishSetup: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    expand: vi.fn(),
    confirm: vi.fn(),
  }
  return {
    calls,
    controller: calls as unknown as ConnectionsStore,
    useSnapshot: ((select: (snapshot: ConnectionsState) => unknown) => select(state)) as never,
  }
}

describe('the page', () => {
  it('renders nothing until the slot delivers its dependencies', () => {
    const { container } = render(<ConnectionsSection />)
    expect(container.firstChild).toBeNull()
  })

  it('loads the directory once on first render', () => {
    const bench = controllerFor(EMPTY_CONNECTIONS_STATE)
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    expect(bench.calls.load).toHaveBeenCalledOnce()
  })

  it('offers a retry when the directory cannot be read', () => {
    const bench = controllerFor({ ...EMPTY_CONNECTIONS_STATE, status: 'error', error: 'no host' })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(bench.calls.load).toHaveBeenCalled()
  })

  it('says it is loading before the first answer arrives', () => {
    const bench = controllerFor({ ...EMPTY_CONNECTIONS_STATE, status: 'loading' })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    expect(screen.getByText(en.loading)).toBeTruthy()
  })

  it('routes every card action to the store', () => {
    const bench = controllerFor({
      ...EMPTY_CONNECTIONS_STATE,
      status: 'ready',
      rows: [view({ status: 'connected', disconnectable: true })],
    })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use for new chats' }))
    expect(bench.calls.activate).toHaveBeenCalledWith('claude')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(bench.calls.confirm).toHaveBeenCalledWith('claude')
  })

  it('names the connection in the disconnect confirmation and only removes on confirm', () => {
    const bench = controllerFor({
      ...EMPTY_CONNECTIONS_STATE,
      status: 'ready',
      rows: [view({ status: 'connected', disconnectable: true })],
      confirming: 'claude',
    })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    expect(screen.getByText('Disconnect Claude?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.disconnectCancel }))
    expect(bench.calls.confirm).toHaveBeenCalledWith(null)
    expect(bench.calls.disconnect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.disconnectConfirm }))
    expect(bench.calls.disconnect).toHaveBeenCalledWith('claude')
  })

  it('closes the confirmation when the dialog itself is dismissed', () => {
    const bench = controllerFor({
      ...EMPTY_CONNECTIONS_STATE,
      status: 'ready',
      rows: [view({ status: 'connected', disconnectable: true })],
      confirming: 'claude',
    })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(bench.calls.confirm).toHaveBeenCalledWith(null)
  })

  it('collapses an already expanded card', () => {
    const bench = controllerFor({
      ...EMPTY_CONNECTIONS_STATE,
      status: 'ready',
      rows: [view()],
      conversations: { claude: { running: false, notices: [{ id: 'claude', message: 'said something' }], prompt: null, failure: null } },
      expanded: 'claude',
    })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '−' }))
    expect(bench.calls.expand).toHaveBeenCalledWith(null)
  })

  it('starts and answers a sign-in from the page', () => {
    const bench = controllerFor({
      ...EMPTY_CONNECTIONS_STATE,
      status: 'ready',
      rows: [view({ connecting: true })],
      conversations: {
        claude: {
          running: true,
          notices: [],
          prompt: { id: 'claude', promptId: '9', kind: 'text', message: 'Paste the code' },
          failure: null,
        },
      },
      expanded: 'claude',
    })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    fireEvent.change(screen.getByLabelText('Paste the code'), { target: { value: 'AB-CD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(bench.calls.answer).toHaveBeenCalledWith('claude', '9', 'AB-CD')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(bench.calls.cancel).toHaveBeenCalledWith('claude')
  })

  it('reaches Connect, Finish setup, and expand from the page', () => {
    const bench = controllerFor({
      ...EMPTY_CONNECTIONS_STATE,
      status: 'ready',
      rows: [
        view(),
        view({ id: 'codex', label: 'Codex', status: 'setup-required', attention: 'route-missing' }),
      ],
      conversations: { claude: { running: false, notices: [{ id: 'claude', message: 'said something' }], prompt: null, failure: null } },
    })
    render(<ConnectionsSection controller={bench.controller} useSnapshot={bench.useSnapshot} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(bench.calls.connect).toHaveBeenCalledWith('claude', 'oauth')
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(bench.calls.finishSetup).toHaveBeenCalledWith('codex')
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(bench.calls.expand).toHaveBeenCalledWith('claude')
  })
})
