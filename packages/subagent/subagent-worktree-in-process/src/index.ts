/**
 * The in-process WORKTREE subagent backend: registers a {@link SubagentProvider}
 * on `ctx.subagents` that runs each child as a fresh child {@link Agent} in its
 * own git worktree. Same transport as the spawn provider; what differs is the
 * child's workspace, so two children working at once cannot write the same
 * file.
 * @module @deepseek-ai/dsh-subagent-worktree-in-process
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import {
  addWorktree,
  holdsWork,
  removeWorktree,
  resolveRepository,
  type ProvisionedWorktree,
} from './worktree.ts'

export { WorktreeError } from './worktree.ts'

export const name = 'subagent-worktree-in-process'
// `subprocess` is required, not optional: without it no worktree can be
// provisioned, and a provider that registers anyway would accept delegations
// it cannot serve.
export const inject = ['subagents', 'subprocess']

/** Default SIGTERM to SIGKILL grace for a git invocation. */
const DEFAULT_GIT_GRACE_MS = 5000

/** Config: registry name, where worktrees live, and the git termination grace. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `worktree`). */
  providerName: string
  /**
   * Absolute directory each child's worktree is created under. Deployments
   * differ on whether that belongs beside the repository, on another volume,
   * or under a path their backup excludes, so there is no default.
   */
  root: string
  /** Termination grace in milliseconds for each git invocation. */
  gitGraceMs: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('worktree'),
  root: z.string(),
  gitGraceMs: z.number().default(DEFAULT_GIT_GRACE_MS),
})

/**
 * The worktree provider. Advertises the same start-time capabilities as spawn
 * — it constructs the child, so it can enforce all four — and adds workspace
 * isolation, which is not a {@link SubagentCapabilities} flag because it
 * changes no request field the caller can ask for or be refused.
 */
class WorktreeInProcessProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  // Context contract: like spawn, a worktree child starts fresh. Its prompt
  // must be self-contained, and now so must its workspace expectations: the
  // child sees a checkout of the parent's HEAD, not the parent's uncommitted
  // work.
  readonly inheritsParentContext = false

  /**
   * @param name - registry name this instance registers under.
   * @param ctx - context carrying `ctx.subprocess` for git invocations.
   * @param config - the resolved worktree root and git grace.
   */
  constructor(readonly name: string, private readonly ctx: Context, private readonly config: Config) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        `subagent provider "${this.name}" needs a session workspace: the delegating session has no cwd to branch from`,
      )
    }
    const repository = await resolveRepository(this.ctx, parentCwd, this.config.gitGraceMs, request.signal)
    // The child session id the driver mints is not visible to this provider, so
    // the worktree carries its own id. It names the directory and branch, which
    // is what keeps two concurrent children apart and what a retained worktree
    // is identified by.
    const worktree = await addWorktree(
      this.ctx,
      repository,
      this.config.root,
      SessionId(randomUUID()),
      this.config.gitGraceMs,
      request.signal,
    )
    let run: SubagentRun
    try {
      run = await startInProcessRun(request, { cwd: worktree.path })
    } catch (error) {
      // Nothing ran in it, so nothing can be lost by removing it. A removal
      // failure must not replace the start failure the caller needs.
      await this.retire(worktree, request.signal).catch(() => {})
      throw error
    }
    return this.withWorktreeTeardown(run, worktree)
  }

  // `prepareContinuable` is deliberately ABSENT, which is how a provider
  // declines the continuable path: its presence is the capability the
  // continuation manager narrows on. A continuable child is composed by that
  // manager and outlives every run this provider wraps — including cold resume
  // in a later process — so nothing here could own its worktree's removal, and
  // a worktree whose teardown nothing owns is worse than no isolation.

  /** Wrap a published run so its disposal also retires the worktree. */
  private withWorktreeTeardown(run: SubagentRun, worktree: ProvisionedWorktree): SubagentRun {
    return {
      ...run,
      dispose: async (): Promise<void> => {
        // The run's own disposal owns child quiescence and must complete before
        // git touches the directory the child was working in.
        const settlements = await Promise.allSettled([run.dispose()])
        const retirement = await this.retire(worktree, undefined).then(
          () => undefined,
          (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
        )
        const disposal = settlements[0]
        if (disposal.status === 'rejected') throw disposal.reason
        if (retirement !== undefined) throw retirement
      },
    }
  }

  /**
   * Remove the worktree when it is empty; keep it, and say where, when it is
   * not. Losing a child's committed or uncommitted work to a teardown is worse
   * than leaving a directory behind for someone to collect.
   */
  private async retire(worktree: ProvisionedWorktree, signal: AbortSignal | undefined): Promise<void> {
    const abort = signal ?? new AbortController().signal
    if (await holdsWork(this.ctx, worktree, this.config.gitGraceMs, abort)) {
      this.ctx.logger.info(
        'retaining worktree %s on branch %s: it holds work',
        worktree.path,
        worktree.branch,
      )
      return
    }
    const failure = await removeWorktree(this.ctx, worktree, this.config.gitGraceMs, abort)
    if (failure !== undefined) this.ctx.logger.warn(failure)
  }
}

/**
 * Register the worktree provider.
 * @param ctx - Cordis context carrying `ctx.subagents` and `ctx.subprocess`.
 * @param config - the resolved provider name, worktree root, and git grace.
 * @returns nothing; the registration unwinds with the plugin fiber.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.root)) {
    throw new Error(`subagent-worktree-in-process "root" must be an absolute path, received "${config.root}"`)
  }
  ctx.subagents.registerProvider(new WorktreeInProcessProvider(config.providerName, ctx, config))
}
