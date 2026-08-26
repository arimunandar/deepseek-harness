/**
 * Drives the REAL worktree backend against REAL git: a temporary repository per
 * case, the real local subprocess provider, a real agent loop, and a scripted
 * mock model. Nothing here stubs git, because what this package owns is exactly
 * the sequence of git invocations and the decision they feed.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import SubagentRuntime, { type SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as worktree from '../src/index.ts'

const execFileAsync = promisify(execFile)

type Script = ConstructorParameters<typeof MockAdapter>[0]

/** Run one git command in a directory, failing the test on a nonzero exit. */
async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout.trim()
}

/** A temporary directory removed when the case finishes. */
async function scratch(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-worktree-${label}-`))
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

/** A repository with one commit, which is the minimum a worktree can branch from. */
async function repository(): Promise<string> {
  const dir = await scratch('repo')
  await git(dir, ['init', '--initial-branch=main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await writeFile(join(dir, 'tracked.txt'), 'original\n')
  await git(dir, ['add', 'tracked.txt'])
  await git(dir, ['commit', '-m', 'initial'])
  return dir
}

function start(
  ctx: Context,
  provider: string,
  request: Omit<SubagentStartRequest, 'signal'> & { signal?: AbortSignal },
) {
  return ctx.subagents.start(provider, { signal: request.signal ?? new AbortController().signal, ...request })
}

/** Mount the real backend over a real subprocess provider and a scripted model. */
async function setup(script: Script, parentCwd: string | undefined, root: string) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(SubagentRuntime)
  const fiber = await ctx.plugin(worktree, { providerName: 'worktree', root, gitGraceMs: 5000 })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const parent = ctx.agentLoop.create(
    SessionId('parent'),
    { provider: 'mock', model: 'mock' },
    parentCwd === undefined ? {} : { cwd: parentCwd },
  )
  return { ctx, parent, fiber }
}

describe('dsh-subagent-worktree-in-process', () => {
  it('gives the child its own worktree as its session cwd', async () => {
    const repo = await repository()
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], repo, root)

    const run = await start(ctx, 'worktree', { prompt: [{ type: 'text', text: 'task' }], parent })
    const child = ctx.agents.get(run.id)!
    const childCwd = child.session.header.cwd!

    // The isolation this package exists for: a different directory from the
    // parent's, inside the configured root, and a real checkout of the commit
    // the parent is on.
    expect(childCwd).not.toBe(repo)
    expect(childCwd.startsWith(root)).toBe(true)
    expect(await readFile(join(childCwd, 'tracked.txt'), 'utf8')).toBe('original\n')
    expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(await git(childCwd, ['rev-parse', 'HEAD']))

    await run.result
    await run.dispose()
  })

  it('removes the worktree and its branch when the child left it clean', async () => {
    const repo = await repository()
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], repo, root)

    const run = await start(ctx, 'worktree', { prompt: [{ type: 'text', text: 'task' }], parent })
    const childCwd = ctx.agents.get(run.id)!.session.header.cwd!
    await run.result
    await run.dispose()

    expect(await git(repo, ['worktree', 'list'])).not.toContain(childCwd)
    expect(await git(repo, ['branch', '--list', 'dsh/subagent/*'])).toBe('')
  })

  it('retains a worktree the child wrote into, rather than destroying the work', async () => {
    const repo = await repository()
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], repo, root)

    const run = await start(ctx, 'worktree', { prompt: [{ type: 'text', text: 'task' }], parent })
    const childCwd = ctx.agents.get(run.id)!.session.header.cwd!
    await run.result
    // Stand in for the engineer's edit: the decision is about the directory's
    // state at teardown, not about who changed it.
    await writeFile(join(childCwd, 'tracked.txt'), 'edited by the child\n')
    await run.dispose()

    expect(await git(repo, ['worktree', 'list'])).toContain(childCwd)
    expect(await readFile(join(childCwd, 'tracked.txt'), 'utf8')).toBe('edited by the child\n')
    // The retained branch is what a caller collects the work from.
    expect(await git(repo, ['branch', '--list', 'dsh/subagent/*'])).not.toBe('')
  })

  it('retains a worktree whose child committed, even with a clean status', async () => {
    const repo = await repository()
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], repo, root)

    const run = await start(ctx, 'worktree', { prompt: [{ type: 'text', text: 'task' }], parent })
    const childCwd = ctx.agents.get(run.id)!.session.header.cwd!
    await run.result
    await writeFile(join(childCwd, 'tracked.txt'), 'committed by the child\n')
    await git(childCwd, ['config', 'user.email', 'test@example.com'])
    await git(childCwd, ['config', 'user.name', 'Test'])
    await git(childCwd, ['commit', '-am', 'child work'])
    // `git status --porcelain` is now empty; only the commit count past the
    // base commit distinguishes this from an untouched worktree.
    expect(await git(childCwd, ['status', '--porcelain'])).toBe('')
    await run.dispose()

    expect(await git(repo, ['worktree', 'list'])).toContain(childCwd)
  })

  it('refuses a parent workspace that is not a git repository', async () => {
    const plain = await scratch('plain')
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], plain, root)

    await expect(start(ctx, 'worktree', { prompt: [{ type: 'text', text: 'task' }], parent }))
      .rejects.toThrow(/not inside a work tree/)
  })

  it('refuses a delegating session that has no workspace at all', async () => {
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], undefined, root)

    await expect(start(ctx, 'worktree', { prompt: [{ type: 'text', text: 'task' }], parent }))
      .rejects.toThrow(/no cwd to branch from/)
  })

  it('leaves no worktree behind when the child fails to start', async () => {
    const repo = await repository()
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], repo, root)
    const aborted = AbortSignal.abort()

    await expect(start(ctx, 'worktree', { prompt: [{ type: 'text', text: 'task' }], parent, signal: aborted }))
      .rejects.toThrow()

    expect(await git(repo, ['branch', '--list', 'dsh/subagent/*'])).toBe('')
  })

  it('declines continuable children instead of provisioning one it cannot retire', async () => {
    const repo = await repository()
    const root = await scratch('root')
    const { ctx, parent } = await setup([textResponse('done')], repo, root)

    // Presence of `prepareContinuable` IS the capability, so the seam must see
    // this provider as one-shot only.
    await expect(ctx.subagents.startContinuable({
      provider: 'worktree',
      label: 'task',
      request: { prompt: [{ type: 'text', text: 'task' }], parent },
      signal: new AbortController().signal,
    })).rejects.toThrow()

    expect(await git(repo, ['branch', '--list', 'dsh/subagent/*'])).toBe('')
  })

  it('withdraws the provider when its fiber is disposed', async () => {
    const repo = await repository()
    const root = await scratch('root')
    const { ctx, fiber } = await setup([textResponse('done')], repo, root)

    expect(ctx.subagents.list()).toContain('worktree')
    await fiber.dispose()
    expect(ctx.subagents.list()).not.toContain('worktree')
  })

  it('refuses a relative worktree root at load', async () => {
    // The check lives in `apply`, so both injections must resolve before it can
    // run; a relative root then fails the mount rather than resolving against
    // whatever directory the host happens to be started from.
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SubprocessLocal)
    await ctx.plugin(SubagentRuntime)

    await expect(ctx.plugin(worktree, { providerName: 'worktree', root: 'relative/root', gitGraceMs: 5000 }))
      .rejects.toThrow(/must be an absolute path/)
  })
})
