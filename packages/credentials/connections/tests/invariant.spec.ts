import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import ConnectionsService from '@deepseek-ai/dsh-connections'
import * as ConnectionsInvariant from '../src/invariant.ts'
import { MemoryCredentials, MemoryDefaultModel, MemoryLlm } from './support.ts'

/** A tree carrying the companion beside the service it checks. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ConnectionsInvariant)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(MemoryLlm)
  await ctx.plugin(MemoryDefaultModel)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(ConnectionsService, {
    connections: {
      claude: {
        label: 'Claude',
        description: 'Use Claude models with your Anthropic account.',
        credential: { kind: 'record', scope: 'llm-pi-ai', id: 'anthropic' },
        provider: 'anthropic',
        defaultModel: 'claude-sonnet-5',
        settingsNs: 'llm-pi-ai',
        routePath: ['providers', 'anthropic'],
      },
    },
  })
  return ctx
}

describe('connections invariant companion', () => {
  it('accepts a directory change with no question left waiting', async () => {
    const ctx = await harness()
    expect(() => { ctx.emit('connections/changed') }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('accepts a change emitted after the service is gone', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ConnectionsInvariant)
    // The disposer-time emit a whole-context teardown produces: the listener
    // outlives the service-store entry and must read that as "nothing to
    // check" rather than as a violation.
    expect(() => { ctx.emit('connections/changed') }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('reserves package ownership and releases it on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(ConnectionsInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(ConnectionsInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
