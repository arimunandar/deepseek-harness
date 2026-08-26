import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationFlow, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import ConnectionsService from '@deepseek-ai/dsh-connections'
import type { Config, ConnectionView } from '@deepseek-ai/dsh-connections'
import { MemoryCredentials, MemoryDefaultModel, MemoryLlm, MemorySettings } from './support.ts'

const CLAUDE_KEY = credentialKey('llm-pi-ai', 'anthropic')
const DEEPSEEK_REF = credentialRef('DEEPSEEK_API_KEY')

/** The two connection kinds the shipped bundle offers: a sign-in and a typed key. */
const CONNECTIONS: Config['connections'] = {
  claude: {
    label: 'Claude',
    description: 'Use Claude models with your Anthropic account.',
    credential: { kind: 'record', scope: 'llm-pi-ai', id: 'anthropic' },
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    settingsNs: 'llm-pi-ai',
    routePath: ['providers', 'anthropic'],
    vendorCli: 'definitely-not-an-installed-command',
  },
  deepseek: {
    label: 'DeepSeek',
    description: 'Use DeepSeek models with an API key.',
    credential: { kind: 'reference', reference: 'DEEPSEEK_API_KEY' },
    provider: 'deepseek-official',
    defaultModel: 'deepseek-v4-flash',
    settingsNs: 'llm-deepseek',
  },
}

interface Harness {
  ctx: Context
  credentials: MemoryCredentials
  llm: MemoryLlm
  defaultModel: MemoryDefaultModel
  settings: MemorySettings
}

/** A tree carrying the four joined owners plus a settings document. */
async function harness(connections: Config['connections'] = CONNECTIONS): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(MemoryLlm)
  await ctx.plugin(MemoryDefaultModel)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(ConnectionsService, { connections })
  return {
    ctx,
    credentials: ctx.get('credentials') as unknown as MemoryCredentials,
    llm: ctx.get('llm') as unknown as MemoryLlm,
    defaultModel: ctx.get('agentDefaultModel') as unknown as MemoryDefaultModel,
    settings: ctx.get('settings') as unknown as MemorySettings,
  }
}

/** Register a flow that commits its record and optionally talks first. */
function signInFlow(ctx: Context, run?: (session: AuthorizationSession) => Promise<void>): AuthorizationFlow {
  return {
    key: CLAUDE_KEY,
    label: 'Claude',
    methods: [{ id: 'oauth', label: 'Sign in with Claude' }],
    async run(session) {
      await run?.(session)
      await ctx.credentials.modifyRecord(CLAUDE_KEY, () =>
        Promise.resolve({ kind: 'grant', payload: { token: 'granted' } }))
    },
  }
}

/** Read one row out of a directory listing. */
function row(views: readonly ConnectionView[], id: string): ConnectionView {
  const found = views.find(view => view.id === id)
  if (found === undefined) throw new Error(`no row for ${id}`)
  return found
}

describe('connection directory', () => {
  it('reports a connection with neither credential nor route as not connected', async () => {
    const { ctx } = await harness()
    const claude = row(await ctx.connections.list(), 'claude')
    expect(claude.status).toBe('not-connected')
    expect(claude.attention).toBeUndefined()
    expect(claude.disconnectable).toBe(false)
    expect(claude.active).toBe(false)
  })

  it('reports a stored credential with no route as setup-required', async () => {
    const { ctx, credentials } = await harness()
    credentials.records.set(CLAUDE_KEY, { kind: 'grant', payload: {} })
    const claude = row(await ctx.connections.list(), 'claude')
    expect(claude.status).toBe('setup-required')
    expect(claude.attention).toBe('route-missing')
    expect(claude.disconnectable).toBe(true)
  })

  it('reports a stored credential whose route is live as connected', async () => {
    const { ctx, credentials, llm } = await harness()
    credentials.records.set(CLAUDE_KEY, { kind: 'grant', payload: {} })
    llm.live.add('anthropic')
    const claude = row(await ctx.connections.list(), 'claude')
    expect(claude.status).toBe('connected')
    expect(claude.attention).toBeUndefined()
  })

  it('reports a live route whose credential is gone as needing attention', async () => {
    const { ctx, llm } = await harness()
    llm.live.add('anthropic')
    const claude = row(await ctx.connections.list(), 'claude')
    expect(claude.status).toBe('needs-attention')
    expect(claude.attention).toBe('credential-missing')
  })

  it('reports a credential a read-only source supplies as needing attention and refuses to remove it', async () => {
    const { ctx, credentials, llm } = await harness()
    credentials.refs.set(DEEPSEEK_REF, 'sk-from-the-environment')
    credentials.readOnly.add(DEEPSEEK_REF)
    llm.live.add('deepseek-official')
    const deepseek = row(await ctx.connections.list(), 'deepseek')
    // The credential IS configured, so the join's connected branch would claim
    // it works; what makes it an attention state is that this deployment
    // cannot write the reference, so no repair offered here can change it.
    expect(deepseek.status).toBe('connected')
    expect(deepseek.disconnectable).toBe(false)
  })

  it('reports the read-only attention state when nothing is stored and nothing is writable', async () => {
    const { ctx, credentials } = await harness()
    credentials.readOnly.add(DEEPSEEK_REF)
    const deepseek = row(await ctx.connections.list(), 'deepseek')
    expect(deepseek.status).toBe('needs-attention')
    expect(deepseek.attention).toBe('credential-read-only')
  })

  it('offers no method for a connection with no registered sign-in flow', async () => {
    const { ctx } = await harness()
    expect(row(await ctx.connections.list(), 'claude').methods).toEqual([])
  })

  it('offers the flow methods and its in-flight state once a flow is registered', async () => {
    const { ctx } = await harness()
    ctx.authorization.registerFlow(signInFlow(ctx))
    const claude = row(await ctx.connections.list(), 'claude')
    expect(claude.methods).toEqual([{ id: 'oauth', label: 'Sign in with Claude' }])
    expect(claude.connecting).toBe(false)
  })

  it('marks the connection supplying the default model as active', async () => {
    const { ctx, defaultModel } = await harness()
    defaultModel.selection = { provider: 'anthropic', model: 'claude-sonnet-5' }
    expect(row(await ctx.connections.list(), 'claude').active).toBe(true)
    expect(row(await ctx.connections.list(), 'deepseek').active).toBe(false)
  })

  it('reports a vendor command that is not installed as absent', async () => {
    const { ctx } = await harness()
    expect(row(await ctx.connections.list(), 'claude').vendorCliInstalled).toBe(false)
    // A connection that declares no vendor command answers the same way
    // without looking anything up.
    expect(row(await ctx.connections.list(), 'deepseek').vendorCliInstalled).toBe(false)
  })

  it('refuses every method that names a connection this deployment does not offer', async () => {
    const { ctx } = await harness()
    await expect(ctx.connections.connect('nope', 'oauth')).rejects.toThrow('no connection named "nope"')
    expect(() => { ctx.connections.cancel('nope') }).toThrow('no connection named "nope"')
    await expect(ctx.connections.activate('nope')).rejects.toThrow('no connection named "nope"')
    await expect(ctx.connections.disconnect('nope')).rejects.toThrow('no connection named "nope"')
    await expect(ctx.connections.finishSetup('nope')).rejects.toThrow('no connection named "nope"')
  })
})

describe('signing in', () => {
  it('announces the attempt as soon as it starts, so another surface can render it', async () => {
    const { ctx } = await harness()
    const seen: boolean[] = []
    ctx.on('connections/changed', () => {
      // A watcher re-reads the directory on every announcement; the one made
      // at the start is what tells it the connection is busy.
      void ctx.connections.list().then((views) => {
        const claude = views.find(view => view.id === 'claude')
        if (claude !== undefined) seen.push(claude.connecting)
      })
    })
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow(signInFlow(ctx, async () => {
      started.resolve(undefined)
      await release.promise
    }))

    const attempt = ctx.connections.connect('claude', 'oauth')
    await started.promise
    expect(row(await ctx.connections.list(), 'claude').connecting).toBe(true)
    release.resolve(undefined)
    await attempt
    expect(row(await ctx.connections.list(), 'claude').connecting).toBe(false)
  })

  it('commits the credential, writes the missing route, and announces the change', async () => {
    const { ctx, credentials, settings } = await harness()
    ctx.authorization.registerFlow(signInFlow(ctx))
    const changed = vi.fn()
    ctx.on('connections/changed', changed)

    const outcome = await ctx.connections.connect('claude', 'oauth')

    expect(outcome).toEqual({ status: 'connected' })
    expect(credentials.records.has(CLAUDE_KEY)).toBe(true)
    expect(settings.sections.get('llm-pi-ai')).toEqual({ providers: { anthropic: {} } })
    expect(changed).toHaveBeenCalled()
  })

  it('leaves an existing route exactly as it was', async () => {
    const { ctx, settings } = await harness()
    settings.sections.set('llm-pi-ai', { providers: { anthropic: { baseURL: 'https://tuned.example' } } })
    ctx.authorization.registerFlow(signInFlow(ctx))

    await ctx.connections.connect('claude', 'oauth')

    expect(settings.writes).toEqual([])
    expect(settings.sections.get('llm-pi-ai'))
      .toEqual({ providers: { anthropic: { baseURL: 'https://tuned.example' } } })
  })

  it('writes no route for a connection whose adapter registers its own', async () => {
    const { ctx, settings } = await harness()
    await ctx.connections.finishSetup('deepseek')
    expect(settings.writes).toEqual([])
  })

  it('pushes the flow notices and questions, and takes the answer back', async () => {
    const { ctx } = await harness()
    const notices: unknown[] = []
    const prompts: { id: string; promptId: string; message: string }[] = []
    ctx.on('connections/notice', (notice) => { notices.push(notice) })
    ctx.on('connections/prompt', (prompt) => {
      prompts.push(prompt)
      // The surface answers the moment it renders the question, which is what
      // a person pressing Continue does.
      ctx.connections.answer(prompt.id, prompt.promptId, 'PASTED-CODE')
    })
    ctx.authorization.registerFlow(signInFlow(ctx, async (session) => {
      session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start', code: 'AB-CD' })
      const typed = await session.prompt({ kind: 'text', message: 'Paste the code' })
      expect(typed).toBe('PASTED-CODE')
    }))

    const outcome = await ctx.connections.connect('claude', 'oauth')

    expect(outcome).toEqual({ status: 'connected' })
    expect(notices).toEqual([
      { id: 'claude', message: 'Continue in your browser', url: 'https://auth.example/start', code: 'AB-CD' },
    ])
    expect(prompts[0]).toMatchObject({ id: 'claude', kind: 'text', message: 'Paste the code' })
  })

  it('restates a select question with its options and answers with the chosen id', async () => {
    const { ctx } = await harness()
    ctx.on('connections/prompt', (prompt) => {
      expect(prompt.kind).toBe('select')
      expect(prompt.options).toEqual([{ id: 'work', label: 'Work' }, { id: 'personal', label: 'Personal' }])
      ctx.connections.answer(prompt.id, prompt.promptId, 'personal')
    })
    ctx.authorization.registerFlow(signInFlow(ctx, async (session) => {
      const chosen = await session.prompt({
        kind: 'select',
        message: 'Which account?',
        options: [{ id: 'work', label: 'Work' }, { id: 'personal', label: 'Personal' }],
      })
      expect(chosen).toBe('personal')
    }))

    expect(await ctx.connections.connect('claude', 'oauth')).toEqual({ status: 'connected' })
  })

  it('carries a placeholder through on a secret question', async () => {
    const { ctx } = await harness()
    const seen: { kind: string; placeholder?: string }[] = []
    ctx.on('connections/prompt', (prompt) => {
      seen.push(prompt)
      ctx.connections.answer(prompt.id, prompt.promptId, 'sk-typed')
    })
    ctx.authorization.registerFlow(signInFlow(ctx, async (session) => {
      await session.prompt({ kind: 'secret', message: 'Paste your key', placeholder: 'sk-…' })
    }))

    await ctx.connections.connect('claude', 'oauth')

    expect(seen[0]).toMatchObject({ kind: 'secret', placeholder: 'sk-…' })
  })

  it('refuses an answer that names no open question and one that names a superseded one', async () => {
    const { ctx } = await harness()
    let openId = ''
    ctx.on('connections/prompt', (prompt) => { openId = prompt.promptId })
    ctx.authorization.registerFlow(signInFlow(ctx, async (session) => {
      const answered = ctx.connections.answer('claude', `${openId}-stale`, 'wrong')
      expect(answered).toBe(false)
      expect(ctx.connections.answer('claude', openId, 'right')).toBe(true)
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    }))

    // Nothing is open before an attempt starts.
    expect(ctx.connections.answer('claude', '0', 'early')).toBe(false)
    await ctx.connections.connect('claude', 'oauth')
  })

  it('settles as cancelled when the surface declines the question', async () => {
    const { ctx, credentials } = await harness()
    ctx.on('connections/prompt', () => { ctx.connections.cancel('claude') })
    ctx.authorization.registerFlow(signInFlow(ctx, async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    }))

    expect(await ctx.connections.connect('claude', 'oauth')).toEqual({ status: 'cancelled' })
    expect(credentials.records.has(CLAUDE_KEY)).toBe(false)
  })

  it('reports a broken flow in its own words rather than throwing at the surface', async () => {
    const { ctx } = await harness()
    ctx.authorization.registerFlow({
      key: CLAUDE_KEY,
      label: 'Claude',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => Promise.reject(new Error('the sign-in service is unavailable')),
    })

    expect(await ctx.connections.connect('claude', 'oauth'))
      .toEqual({ status: 'failed', message: 'the sign-in service is unavailable' })
  })

  it('cuts a provider stack chain out of what a person reads', async () => {
    const { ctx } = await harness()
    ctx.authorization.registerFlow({
      key: CLAUDE_KEY,
      label: 'Claude',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      // pi-ai's own OAuth exchange failure: one readable clause, then a
      // `details=`/`stack=` chain carrying absolute filesystem paths.
      run: () => Promise.reject(new Error(
        'Token exchange request failed. url=https://example.test/token;'
        + ' details=Error: HTTP request failed. status=400;'
        + ' stack=Error: at postJson (/Users/someone/checkout/node_modules/provider/oauth.js:155:15)')),
    })

    const outcome = await ctx.connections.connect('claude', 'oauth')

    expect(outcome).toEqual({
      status: 'failed',
      message: 'Token exchange request failed. url=https://example.test/token',
    })
  })

  it('bounds a failure with no machine-detail marker at all', async () => {
    const { ctx } = await harness()
    ctx.authorization.registerFlow({
      key: CLAUDE_KEY,
      label: 'Claude',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => Promise.reject(new Error(`the provider explained itself at length ${'x'.repeat(400)}`)),
    })

    const outcome = await ctx.connections.connect('claude', 'oauth')

    if (outcome.status !== 'failed') throw new Error('expected a failed outcome')
    expect(outcome.message.length).toBe(200)
    expect(outcome.message.endsWith('…')).toBe(true)
  })

  it('keeps only the first line of a multi-line failure', async () => {
    const { ctx } = await harness()
    ctx.authorization.registerFlow({
      key: CLAUDE_KEY,
      label: 'Claude',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => Promise.reject(new Error('the sign-in service is unavailable\n    at somewhere (/abs/path.js:1:1)')),
    })

    expect(await ctx.connections.connect('claude', 'oauth'))
      .toEqual({ status: 'failed', message: 'the sign-in service is unavailable' })
  })

  it('states a plain failure when the message carries nothing readable', async () => {
    const { ctx } = await harness()
    ctx.authorization.registerFlow({
      key: CLAUDE_KEY,
      label: 'Claude',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => Promise.reject(new Error('stack=Error: at postJson (/abs/path.js:155:15)')),
    })

    expect(await ctx.connections.connect('claude', 'oauth'))
      .toEqual({ status: 'failed', message: 'The sign-in did not complete.' })
  })

  it('reports a non-Error rejection as text', async () => {
    const { ctx } = await harness()
    ctx.authorization.registerFlow({
      key: CLAUDE_KEY,
      label: 'Claude',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      // eslint-disable-next-line prefer-promise-reject-errors -- the point is a non-Error rejection
      run: () => Promise.reject('upstream said no'),
    })

    expect(await ctx.connections.connect('claude', 'oauth'))
      .toEqual({ status: 'failed', message: 'upstream said no' })
  })

  it('refuses to run a sign-in for a connection that authenticates with a typed key', async () => {
    const { ctx } = await harness()
    await expect(ctx.connections.connect('deepseek', 'oauth'))
      .rejects.toThrow('"deepseek" authenticates with a stored key and has no sign-in to run')
  })

  it('cancels nothing for a typed-key connection and leaves no open question behind', async () => {
    const { ctx } = await harness()
    ctx.connections.cancel('deepseek')
    expect(ctx.connections.orphanedPrompts()).toEqual([])
  })

  it('holds an open question against a running attempt, never orphaned', async () => {
    const { ctx } = await harness()
    const duringPrompt: string[][] = []
    ctx.on('connections/prompt', (prompt) => {
      // The one moment the table is non-empty: a question is open and its
      // attempt is running, which is exactly the pairing the invariant checks.
      duringPrompt.push(ctx.connections.orphanedPrompts())
      ctx.connections.answer(prompt.id, prompt.promptId, 'code')
    })
    ctx.authorization.registerFlow(signInFlow(ctx, async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    }))

    await ctx.connections.connect('claude', 'oauth')

    expect(duringPrompt).toEqual([[]])
    expect(ctx.connections.orphanedPrompts()).toEqual([])
  })
})

describe('repairs', () => {
  it('writes the missing route on its own and is idempotent', async () => {
    const { ctx, settings } = await harness()
    await ctx.connections.finishSetup('claude')
    await ctx.connections.finishSetup('claude')
    expect(settings.writes).toHaveLength(1)
    expect(settings.sections.get('llm-pi-ai')).toEqual({ providers: { anthropic: {} } })
  })

  it('makes one connection the default for new conversations', async () => {
    const { ctx, defaultModel } = await harness()
    await ctx.connections.activate('claude')
    expect(defaultModel.selection).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' })
  })

  it('starts from the route default a person set, over the one configuration ships', async () => {
    const { ctx, defaultModel } = await harness()
    defaultModel.perProvider.set('anthropic', 'claude-opus-5')
    await ctx.connections.activate('claude')
    expect(defaultModel.selection).toEqual({ provider: 'anthropic', model: 'claude-opus-5' })
  })

  it('forgets a stored sign-in without telling the issuer', async () => {
    const { ctx, credentials } = await harness()
    credentials.records.set(CLAUDE_KEY, { kind: 'grant', payload: {} })
    await ctx.connections.disconnect('claude')
    expect(credentials.records.has(CLAUDE_KEY)).toBe(false)
  })

  it('forgets a typed key through the reference half', async () => {
    const { ctx, credentials } = await harness()
    credentials.refs.set(DEEPSEEK_REF, 'sk-stored')
    await ctx.connections.disconnect('deepseek')
    expect(credentials.refs.has(DEEPSEEK_REF)).toBe(false)
  })

  it('composes routes in cordis.yml when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(MemoryLlm)
    await ctx.plugin(MemoryDefaultModel)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(ConnectionsService, { connections: CONNECTIONS })
    // Nothing to write and nothing to fail: the route is whatever composition says.
    await expect(ctx.connections.finishSetup('claude')).resolves.toBeUndefined()
  })
})

describe('change announcements', () => {
  it('folds every owner that can move the join into one signal', async () => {
    const { ctx, credentials } = await harness()
    const changed = vi.fn()
    ctx.on('connections/changed', changed)

    await credentials.set(DEEPSEEK_REF, 'sk-typed')
    expect(changed).toHaveBeenCalledTimes(1)

    await credentials.modifyRecord(CLAUDE_KEY, () => Promise.resolve({ kind: 'grant', payload: {} }))
    expect(changed).toHaveBeenCalledTimes(2)

    ctx.emit('llm/adapters-updated')
    expect(changed).toHaveBeenCalledTimes(3)

    ctx.emit('authorization/settled', CLAUDE_KEY, 'authorized')
    expect(changed).toHaveBeenCalledTimes(4)
  })
})

describe('configuration', () => {
  it('serves an empty directory when a deployment offers nothing', async () => {
    const { ctx } = await harness({})
    expect(await ctx.connections.list()).toEqual([])
  })

  it('refuses a record credential missing either half of its key', async () => {
    await expect(harness({
      broken: { ...CONNECTIONS['claude'], credential: { kind: 'record', scope: 'llm-pi-ai' } },
    } as Config['connections'])).rejects.toThrow('without both scope and id')
  })

  it('refuses a record credential outside the key grammar', async () => {
    await expect(harness({
      broken: { ...CONNECTIONS['claude'], credential: { kind: 'record', scope: 'llm-pi-ai', id: 'NOT.A.SEGMENT' } },
    } as Config['connections'])).rejects.toThrow('outside the key grammar')
  })

  it('refuses a reference credential without a reference', async () => {
    await expect(harness({
      broken: { ...CONNECTIONS['deepseek'], credential: { kind: 'reference' } },
    } as Config['connections'])).rejects.toThrow('without a reference')
  })
})
