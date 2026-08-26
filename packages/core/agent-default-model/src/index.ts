/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-default-model')

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
  /**
   * Model each provider route starts from when it becomes the selection,
   * keyed by route.
   *
   * A catalog lists models in its own order — alphabetical, for every adapter
   * shipped here — so nothing derivable says which of a provider's models a
   * person wants by default. This map is that answer, stated per route rather
   * than guessed, and an absent entry leaves the choice to whoever is
   * switching.
   */
  perProvider?: Record<string, string>
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
  perProvider: z.dict(z.string()),
})

/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: AgentDefaultModelSettings): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private source: () => AgentDefaultModelSettings

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    const entry: AgentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    installSettingsSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { this.source = current },
      // Every consumer reads through currentSelection(), so no registration-level fact
      // needs rebuilding when the settings document changes.
      onChange: () => {},
    })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    // The per-provider map rides along because this is a complete-section
    // write: clearing a stored effort the new model does not have is the point,
    // and dropping every provider default with it would not be. The test is
    // emptiness rather than absence — the schema materializes the dict, so it
    // is never absent here — which also keeps an empty map out of the document.
    const perProvider = this.source().perProvider ?? {}
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
      ...Object.keys(perProvider).length === 0 ? {} : { perProvider },
    })
  }

  /**
   * The model one provider route starts from when it becomes the selection.
   * @param provider - registered provider route.
   * @returns the stored model id, or undefined when this route has no default.
   */
  modelFor(provider: string): string | undefined {
    return this.source().perProvider?.[provider]
  }

  /**
   * Record the model one provider route starts from.
   *
   * A path write rather than a section write, so setting one route's default
   * cannot disturb the current selection or another route's entry.
   * @param provider - registered provider route.
   * @param model - provider-owned model id.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveProviderDefault(provider: string, model: string): Promise<void> {
    await this.ctx.get('settings')?.mutate(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, [
      { op: 'set', path: ['perProvider', provider], value: model },
    ])
  }

  /**
   * Forget one provider route's default, leaving the choice to whoever switches.
   * @param provider - registered provider route.
   * @returns fulfillment after the optional settings write settles.
   */
  async clearProviderDefault(provider: string): Promise<void> {
    await this.ctx.get('settings')?.mutate(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, [
      { op: 'unset', path: ['perProvider', provider] },
    ])
  }
}

export default AgentDefaultModelConfig
