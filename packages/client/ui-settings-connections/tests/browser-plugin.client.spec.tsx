// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { ConnectionsSection } from '../src/client/ConnectionsSection.tsx'
import type { ConnectionsSectionInjected } from '../src/client/ConnectionsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

/** A client tree with the locale, slots, and Remote faces this plugin injects. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)

  const list = vi.fn().mockResolvedValue({ ok: true, value: [] })
  const listeners = new Map<string, (...args: never[]) => void>()
  class RemoteService extends Service {
    readonly connections = { list }
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $on(event: string, listener: (...args: never[]) => void): () => void {
      listeners.set(event, listener)
      return () => { listeners.delete(event) }
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.connections', { list })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, listeners }
}

/** Declare the two slots the settings shell owns, so the registrations land. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-connections browser plugin', () => {
  it('declares only the services the page and its Remote namespace need', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.connections'])
  })

  it('registers a localized page ahead of Models, and no first-run step', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(ConnectionsSection)
    expect(section.options).toMatchObject({ id: 'connections', order: 5 })
    expect(resolveSlotLabel(section.options.label)).toBe('连接')
    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe('Connections')

    // No takeover: the official-DeepSeek credential step already owns first
    // run, and a second one would make it two takeovers deep.
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)

    await b.ctx.fiber.dispose()
  })

  it('reads nothing until a surface renders', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.list).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('binds one store, so every activation of the page reads the same directory', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const section = b.slots.entries('settings.section')[0]!
    const first = (section.inject as unknown as () => ConnectionsSectionInjected)()
    const second = (section.inject as unknown as () => ConnectionsSectionInjected)()
    expect(second.controller).toBe(first.controller)
    expect(second.hooks.snapshot).toBe(first.hooks.snapshot)

    await b.ctx.fiber.dispose()
  })

  it('converges on every pushed signal and stops when the fiber goes', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    b.listeners.get('connections/changed')?.()
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalled() })

    const face = (b.slots.entries('settings.section')[0]!.inject as unknown as () => ConnectionsSectionInjected)()
    b.listeners.get('connections/notice')?.({ id: 'claude', message: 'Opening your browser' } as never)
    expect(face.hooks.snapshot.getSnapshot().conversations['claude']?.notices).toHaveLength(1)
    b.listeners.get('connections/prompt')?.(
      { id: 'claude', promptId: '0', kind: 'text', message: 'Paste the code' } as never)
    expect(face.hooks.snapshot.getSnapshot().conversations['claude']?.prompt).toMatchObject({ promptId: '0' })

    // A reconnected transport re-reads, since anything could have moved while
    // the page was not listening.
    const before = b.list.mock.calls.length
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.list.mock.calls.length).toBeGreaterThan(before) })

    await fiber.dispose()
    expect(b.listeners.size).toBe(0)
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
