/**
 * Git worktree provisioning for isolated child workspaces. Every git
 * invocation goes through `ctx.subprocess` with collected output, so this
 * module owns no process handling of its own.
 * @module @deepseek-ai/dsh-subagent-worktree-in-process/worktree
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: resolves `ctx.subprocess` through the seam's declaration merge.
import type {} from '@deepseek-ai/dsh-subprocess'

/**
 * In-memory cap for one git invocation's output. Not a deployment choice: the
 * commands here print a repository path, a porcelain status, or a commit
 * count, and nothing this module does with that output benefits from a larger
 * window — an oversized status is already decisive on its first byte.
 */
const GIT_OUTPUT_MAX_BYTES = 65536

/** One provisioned workspace and the facts its teardown decision needs. */
export interface ProvisionedWorktree {
  /** Absolute path handed to the child as its session cwd. */
  readonly path: string
  /** Branch the worktree checked out, created at the repository's HEAD. */
  readonly branch: string
  /** Repository the worktree belongs to; every teardown command runs here. */
  readonly repository: string
  /** The commit the branch was created at, for the retain-or-remove decision. */
  readonly baseCommit: string
}

/** Why provisioning refused, stated in terms an operator can act on. */
export class WorktreeError extends Error {
  /**
   * @param message - operator-facing description naming the directory or branch.
   * @param code - stable classification for callers that branch on the reason.
   */
  constructor(message: string, readonly code: 'NOT_A_REPOSITORY' | 'GIT_FAILED') {
    super(message)
    this.name = 'WorktreeError'
  }
}

/** One git invocation's collected result. */
interface GitResult {
  /** Exit code; null when a signal killed git. */
  readonly exitCode: number | null
  /** Trimmed stdout. */
  readonly stdout: string
}

/**
 * Run one git command in a directory and read its collected stdout.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param cwd - absolute directory the command runs in.
 * @param args - git arguments; never shell-interpreted.
 * @param graceMs - termination grace for this invocation.
 * @param signal - cancellation for the spawn and the run.
 * @returns the exit code and trimmed stdout.
 */
async function git(
  ctx: Context,
  cwd: string,
  args: readonly string[],
  graceMs: number,
  signal: AbortSignal,
): Promise<GitResult> {
  const handle = ctx.subprocess.spawn({
    argv: ['git', ...args],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: GIT_OUTPUT_MAX_BYTES },
      stderr: { maxBytes: GIT_OUTPUT_MAX_BYTES },
    },
    graceMs,
    signal,
  })
  const outcome = await handle.done
  return { exitCode: outcome.exitCode, stdout: (handle.collected.stdout?.readFrom(0).text ?? '').trim() }
}

/**
 * Resolve the repository root that owns a directory.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param cwd - absolute directory to resolve from.
 * @param graceMs - termination grace for the probe.
 * @param signal - cancellation for the probe.
 * @returns the absolute repository root.
 * @throws WorktreeError when the directory is not inside a git work tree.
 */
export async function resolveRepository(
  ctx: Context,
  cwd: string,
  graceMs: number,
  signal: AbortSignal,
): Promise<string> {
  const probe = await git(ctx, cwd, ['rev-parse', '--show-toplevel'], graceMs, signal)
  if (probe.exitCode !== 0 || probe.stdout === '') {
    throw new WorktreeError(
      `worktree isolation needs a git repository: "${cwd}" is not inside a work tree`,
      'NOT_A_REPOSITORY',
    )
  }
  return probe.stdout
}

/**
 * Create one worktree for a child, on a fresh branch at the repository's
 * current HEAD. Branch and directory are named from the child's session id, so
 * two children never collide and a retained worktree names its owner.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param repository - absolute repository root the worktree belongs to.
 * @param root - absolute directory the worktree directory is created under.
 * @param childId - the child session the worktree belongs to.
 * @param graceMs - termination grace for each git invocation.
 * @param signal - cancellation for provisioning.
 * @returns the provisioned worktree.
 * @throws WorktreeError when git refuses to resolve HEAD or add the worktree.
 */
export async function addWorktree(
  ctx: Context,
  repository: string,
  root: string,
  childId: SessionId,
  graceMs: number,
  signal: AbortSignal,
): Promise<ProvisionedWorktree> {
  const head = await git(ctx, repository, ['rev-parse', 'HEAD'], graceMs, signal)
  if (head.exitCode !== 0 || head.stdout === '') {
    throw new WorktreeError(
      `git rev-parse HEAD failed in "${repository}": a repository with no commit cannot be branched from`,
      'GIT_FAILED',
    )
  }
  const branch = `dsh/subagent/${childId}`
  const path = join(root, childId)
  const added = await git(ctx, repository, ['worktree', 'add', '-b', branch, path, head.stdout], graceMs, signal)
  if (added.exitCode !== 0) {
    throw new WorktreeError(
      `git worktree add failed for branch "${branch}" at "${path}" (exit ${String(added.exitCode)})`,
      'GIT_FAILED',
    )
  }
  return { path, branch, repository, baseCommit: head.stdout }
}

/**
 * Whether a worktree holds work that removing it would destroy: an uncommitted
 * change, or a commit the branch added past the commit it was created at.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param worktree - the provisioned worktree to inspect.
 * @param graceMs - termination grace for each git invocation.
 * @param signal - cancellation for the inspection.
 * @returns true when the worktree must be retained.
 */
export async function holdsWork(
  ctx: Context,
  worktree: ProvisionedWorktree,
  graceMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const status = await git(ctx, worktree.path, ['status', '--porcelain'], graceMs, signal)
  // A status this command could not produce counts as work: refusing to remove
  // a directory whose state is unknown is the only safe direction.
  if (status.exitCode !== 0) return true
  if (status.stdout !== '') return true
  const ahead = await git(
    ctx,
    worktree.path,
    ['rev-list', '--count', `${worktree.baseCommit}..HEAD`],
    graceMs,
    signal,
  )
  return ahead.exitCode !== 0 || ahead.stdout !== '0'
}

/**
 * Remove one worktree and delete its branch. Only called for a worktree
 * {@link holdsWork} reported as empty.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param worktree - the provisioned worktree to remove.
 * @param graceMs - termination grace for each git invocation.
 * @param signal - cancellation for the removal.
 * @returns the first git failure's description, or undefined when both succeeded.
 */
export async function removeWorktree(
  ctx: Context,
  worktree: ProvisionedWorktree,
  graceMs: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  const removed = await git(ctx, worktree.repository, ['worktree', 'remove', worktree.path], graceMs, signal)
  if (removed.exitCode !== 0) {
    return `git worktree remove failed for "${worktree.path}" (exit ${String(removed.exitCode)})`
  }
  const deleted = await git(ctx, worktree.repository, ['branch', '-D', worktree.branch], graceMs, signal)
  if (deleted.exitCode !== 0) {
    return `git branch -D failed for "${worktree.branch}" (exit ${String(deleted.exitCode)})`
  }
  return undefined
}
