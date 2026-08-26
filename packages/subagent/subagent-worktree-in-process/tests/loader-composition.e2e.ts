import { realpathSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/**
 * Keyless REAL-composition coverage for worktree isolation: a test-only
 * cordis.yml boots the headless app through the Loader, the scripted lead
 * delegates once, and the assertion reads the PERSISTED child session header —
 * the workspace decision is durable there, while model text would only report
 * what a mock was told to say. Mock-only composition, so only this keyless
 * tier applies.
 */

const driver = fileURLToPath(new URL(
  '../../../../examples/acp-agent/tests/fixtures/subagent/subagent-worktree/driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/acp-agent/tests/fixtures/subagent/subagent-worktree/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

const execFileAsync = promisify(execFile)

/** Run one git command in a directory. */
async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout.trim()
}

/** Every persisted session log under a directory. */
async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

/** The `cwd` recorded on one session log's header line, the log's first event. */
async function headerCwd(path: string): Promise<string | undefined> {
  const first = (await readFile(path, 'utf8')).split('\n').find(line => line !== '')
  if (first === undefined) return undefined
  const header = JSON.parse(first) as { type?: string; cwd?: string }
  return header.type === 'session' ? header.cwd : undefined
}

describe('worktree subagent isolation through a real cordis.yml', () => {
  it('runs the child in its own worktree of the parent workspace, and retires it', async () => {
    let parentCwd = ''
    let childCwd: string | undefined
    let worktreesAfter = ''

    await runLoaderSmoke({
      label: 'worktree-subagent composition smoke',
      tempDirPrefix: 'worktree-subagent-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      prepare: async (cwd) => {
        // The provider refuses a workspace outside a work tree, so the isolated
        // cwd has to be a real repository with one commit to branch from.
        await git(cwd, ['init', '--initial-branch=main'])
        await git(cwd, ['config', 'user.email', 'test@example.com'])
        await git(cwd, ['config', 'user.name', 'Test'])
        await git(cwd, ['commit', '--allow-empty', '-m', 'initial'])
      },
      inspect: async (cwd) => {
        // Session headers record realpaths; the smoke's temp cwd is a symlink
        // on macOS, so canonicalize before comparing.
        parentCwd = realpathSync(cwd)
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        const cwds = await Promise.all(logs.map(headerCwd))
        childCwd = cwds.find(value => value !== undefined && value !== parentCwd)
        worktreesAfter = await git(cwd, ['worktree', 'list'])
      },
    })

    // The child ran somewhere else, under the configured root, and it was a
    // real worktree of the parent repository rather than a copied directory.
    expect(childCwd).toBeDefined()
    expect(childCwd).not.toBe(parentCwd)
    expect(childCwd?.startsWith(join(parentCwd, '.worktrees'))).toBe(true)
    // The role child wrote nothing, so teardown retired its worktree and the
    // repository is back to holding only its own.
    expect(worktreesAfter.split('\n').filter(line => line !== '')).toHaveLength(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
