/** Default Agent model settings layered over a real settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentDefaultModelConfig, { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '../src/index.ts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<{
  ctx: Context
  settingsFiber: Context['fiber']
  defaultModel: AgentDefaultModelConfig
  settings: MemorySettings
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
  return { ctx, settingsFiber, defaultModel: ctx.agentDefaultModel, settings: ctx.get('settings') as unknown as MemorySettings }
}

describe('AgentDefaultModelConfig', () => {
  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })

    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: 'high',
    })
    await bench.ctx.fiber.dispose()
  })

  it('clears a stored effort when the saved selection has none', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-plain' })
    expect(bench.defaultModel.currentSelection()).toEqual({ provider: 'acme-gateway', model: 'acme-plain' })
    await bench.ctx.fiber.dispose()
  })

  it('layers a hand-written partial section over the entry', async () => {
    const bench = await boot()
    await bench.settingsFiber.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      model: 'deepseek-reasoner',
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-reasoner',
    })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-large' })
    expect(bench.defaultModel.currentSelection().provider).toBe('acme-gateway')
    await bench.settingsFiber.dispose()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.agentDefaultModel.saveSelection({ provider: 'other', model: 'other' })
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'p', model: 'm' })
    await ctx.fiber.dispose()
  })
})

describe('per-provider defaults', () => {
  it('answers nothing for a route with no default', async () => {
    const { defaultModel } = await boot()
    expect(defaultModel.modelFor('anthropic')).toBeUndefined()
  })

  it('records one route default without disturbing the current selection', async () => {
    const { defaultModel } = await boot()
    await defaultModel.saveProviderDefault('anthropic', 'claude-sonnet-5')
    expect(defaultModel.modelFor('anthropic')).toBe('claude-sonnet-5')
    expect(defaultModel.currentSelection()).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
  })

  it('keeps one route default when another is written', async () => {
    const { defaultModel } = await boot()
    await defaultModel.saveProviderDefault('anthropic', 'claude-sonnet-5')
    await defaultModel.saveProviderDefault('openai-codex', 'gpt-5.6-terra')
    expect(defaultModel.modelFor('anthropic')).toBe('claude-sonnet-5')
    expect(defaultModel.modelFor('openai-codex')).toBe('gpt-5.6-terra')
  })

  it('keeps every route default across a complete-section selection write', async () => {
    const { defaultModel } = await boot()
    await defaultModel.saveProviderDefault('anthropic', 'claude-sonnet-5')
    // saveSelection replaces the whole section so a stale effort cannot
    // survive; the per-route map must ride along rather than be cleared.
    await defaultModel.saveSelection({ provider: 'anthropic', model: 'claude-opus-5' })
    expect(defaultModel.modelFor('anthropic')).toBe('claude-sonnet-5')
    expect(defaultModel.currentSelection()).toMatchObject({ model: 'claude-opus-5' })
  })

  it('forgets one route default and leaves the rest', async () => {
    const { defaultModel } = await boot()
    await defaultModel.saveProviderDefault('anthropic', 'claude-sonnet-5')
    await defaultModel.saveProviderDefault('xiaomi', 'mimo-v2.5-pro')
    await defaultModel.clearProviderDefault('anthropic')
    expect(defaultModel.modelFor('anthropic')).toBeUndefined()
    expect(defaultModel.modelFor('xiaomi')).toBe('mimo-v2.5-pro')
  })

  it('writes a selection unchanged while no route default exists', async () => {
    const { defaultModel, settings } = await boot()
    await defaultModel.saveSelection({ provider: 'anthropic', model: 'claude-opus-5' })
    // Nothing to carry: the section holds the selection alone.
    expect(settings.doc[AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE]).not.toHaveProperty('perProvider')
  })

  it('keeps its composition entry usable with no settings provider mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    await expect(ctx.agentDefaultModel.saveProviderDefault('anthropic', 'claude-sonnet-5')).resolves.toBeUndefined()
    await expect(ctx.agentDefaultModel.clearProviderDefault('anthropic')).resolves.toBeUndefined()
    expect(ctx.agentDefaultModel.modelFor('anthropic')).toBeUndefined()
  })
})
