/** Package-local scripted child boundary for deterministic tool-subagent tests. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, LlmFailure } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentCapabilities,
  SubagentProvider,
  SubagentReportedUsage,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'

const DEFAULT_CAPABILITIES: SubagentCapabilities = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

/** Options for one scripted provider fixture. */
export interface Config {
  /** Registry name to register under. */
  name: string
  /** Final text returned by the scripted child. */
  reply?: string
  /** Terminal result reason. */
  stopReason?: SubagentStopReason
  /** Safe non-assistant detail for a non-completed result. */
  diagnostic?: string
  /** Start-time features advertised by the provider. */
  capabilities?: Partial<SubagentCapabilities>
  /** Whether tool descriptions say the child inherits completed turns. */
  inheritsParentContext?: boolean
  /** Structured value returned when the request asks for one. */
  structured?: unknown
  /** Delegated token usage the scripted child reports, as an out-of-process provider would. */
  usage?: SubagentReportedUsage
  /** Structured failure the scripted child reports for an `error` stop reason. */
  failure?: LlmFailure
  /** Report no output at all, which is what a child refused before acting looks like. */
  emptyOutput?: boolean
  /** Per-start overrides applied in call order, so a fallback attempt can differ from the first. */
  perStart?: readonly Partial<Config>[]
  /** Observes each start; the child's result additionally waits for the returned promise. */
  onStart?: (request: SubagentStartRequest) => Promise<void> | void
}

/** Scripted provider whose result aborts if its signal or disposer wins first. */
export class ScriptedSubagentProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities
  readonly inheritsParentContext: boolean

  /** Starts observed so far, which selects this start's `perStart` overrides. */
  private starts = 0
  /** Agent options each start was asked for, in call order. */
  readonly startedWith: (SubagentStartRequest['agentOptions'])[] = []

  constructor(
    readonly name: string,
    private readonly config: Config,
  ) {
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities }
    this.inheritsParentContext = config.inheritsParentContext ?? false
  }

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    if (request.signal.aborted) throw new Error('scripted subagent start aborted before publication')
    // Overrides are indexed by start, so one script can make the first attempt
    // fail on its route and the second succeed.
    const script: Config = { ...this.config, ...this.config.perStart?.[this.starts] ?? {} }
    this.startedWith.push(request.agentOptions)
    this.starts += 1
    const reply = script.reply ?? 'scripted subagent reply'
    const output: ContentBlock[] = script.stopReason === undefined || script.stopReason === 'completed'
      ? [{ type: 'text', text: reply }]
      : script.emptyOutput === true ? [] : [{ type: 'text', text: reply }]
    const wantsStructured = request.outputSchema !== undefined && this.capabilities.outputSchema
    const stopReason = script.stopReason ?? 'completed'
    const state = { cancelled: false }
    const onAbort = (): void => { state.cancelled = true }
    request.signal.addEventListener('abort', onAbort, { once: true })
    await Promise.resolve()
    if (state.cancelled) {
      request.signal.removeEventListener('abort', onAbort)
      throw new Error('scripted subagent start aborted before publication')
    }

    const resultFor = (): SubagentResult => {
      const terminal = state.cancelled ? 'aborted' : stopReason
      return {
        output,
        ...wantsStructured ? { structured: script.structured ?? { reply } } : {},
        ...script.diagnostic !== undefined && terminal !== 'completed'
          ? { diagnostic: script.diagnostic }
          : {},
        ...script.usage === undefined ? {} : { usage: script.usage },
        ...script.failure !== undefined && terminal === 'error' ? { failure: script.failure } : {},
        stopReason: terminal,
      }
    }
    const gate = Promise.resolve(script.onStart?.(request))
    const result = gate.then(() => new Promise<SubagentResult>((resolve) => {
      setTimeout(() => { resolve(resultFor()) }, 0)
    })).finally(() => {
      request.signal.removeEventListener('abort', onAbort)
    })

    return {
      id: SessionId(`scripted-subagent:${this.name}:${request.parent.id}`),
      localAgent: undefined,
      result,
      dispose(): Promise<void> {
        state.cancelled = true
        request.signal.removeEventListener('abort', onAbort)
        return Promise.resolve()
      },
    }
  }
}

/**
 * Mount one scripted provider through an effect-scoped local plugin.
 * @param ctx - context carrying the real subagent registry.
 * @param config - scripted provider identity and outcome.
 * @returns the fixture plugin's disposable fiber.
 */
export function mountScriptedProvider(ctx: Context, config: Config) {
  return ctx.plugin({
    name: 'scripted-subagent-provider',
    inject: ['subagents'],
    apply(pluginCtx: Context): void {
      pluginCtx.subagents.registerProvider(new ScriptedSubagentProvider(config.name, config))
    },
  })
}

/**
 * Mount the scripted provider and hand back the instance, so a case can read
 * which agent options each start was asked for.
 * @param ctx - context carrying `ctx.subagents`.
 * @param config - the script, including per-start overrides.
 * @returns the mounted provider.
 */
export async function mountObservableScriptedProvider(
  ctx: Context,
  config: Config,
): Promise<ScriptedSubagentProvider> {
  const provider = new ScriptedSubagentProvider(config.name, config)
  await ctx.plugin({
    name: 'scripted-subagent-provider',
    inject: ['subagents'],
    apply(pluginCtx: Context): void {
      pluginCtx.subagents.registerProvider(provider)
    },
  })
  return provider
}
