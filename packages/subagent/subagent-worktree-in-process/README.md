# @deepseek-ai/dsh-subagent-worktree-in-process

English | [中文](README.zh.md)

The worktree provider creates a fresh child `Agent` in the current process, in a git worktree of its own. It is the [spawn provider](../subagent-spawn-in-process/README.md) with one thing changed — the child's workspace — so two children working at once cannot write the same file.

## Workspace boundary

`start(request)` resolves the delegating session's cwd to its repository root, reads that repository's `HEAD`, and adds a worktree on a fresh branch at that commit. The child's session header carries the worktree path, and the session cwd is what every enforcing capability reads: [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/README.md) makes it the `workspace-write` boundary, the filesystem tools resolve relative paths against it, and shell spawns start there.

Isolation is therefore as strong as the session's permission mode, and no stronger. Under `workspace-write` the boundary is enforced: a child handed an absolute path outside its worktree is refused. Under a bypass mode there is no boundary, so a child that is told another directory's path — by its own delegating agent, most likely — can `cd` there and write. The worktree still decides where the child *starts* and where its relative work lands; it does not confine a child whose deployment has switched confinement off.

Two facts follow from branching at `HEAD` rather than copying the parent's directory. The child does **not** see the parent's uncommitted work, so a task that depends on it must carry it in the prompt. And the child's result lands on a branch, not in the parent's tree, so a caller that wants the work merges or cherry-picks it.

Branch and directory are both named from a per-child UUID (`dsh/subagent/<id>`), which is what keeps concurrent children apart and what identifies a retained worktree afterwards.

## Teardown keeps work

Disposing the run disposes the child first — quiescence before git touches the directory — and then retires the worktree. Retirement removes the worktree and deletes its branch only when the worktree is **empty**: `git status --porcelain` reports nothing and no commit was added past the commit the branch was created at. Otherwise the worktree is retained and the Host log names its path and branch.

A `git status` that could not be produced counts as work. Refusing to remove a directory whose state is unknown is the only safe direction, so an unreadable worktree is retained rather than deleted.

A start that fails after provisioning removes the worktree — nothing ran in it, so nothing can be lost — and the removal never replaces the start failure the caller needs.

## Capabilities and the continuable path

Worktree advertises `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }`, the same four as spawn: it constructs the child, so it can enforce all of them. Workspace isolation is not among them because it changes no request field a caller can ask for or be refused.

`prepareContinuable` is deliberately **absent**, which is how a provider declines the continuable path — its presence is the capability the continuation manager narrows on. A continuable child is composed by that manager and outlives every run this provider wraps, including cold resume in a later process, so nothing here could own its worktree's removal. A worktree whose teardown nothing owns is worse than no isolation.

## Requirements and refusals

`ctx.subprocess` is a required injection rather than an optional read: without it no worktree can be provisioned, and a provider that registered anyway would accept delegations it cannot serve. Every git invocation goes through that seam with bounded collected output; this package spawns nothing itself.

Three refusals are loud. A delegating session with no cwd has nothing to branch from. A cwd outside a git work tree fails `WorktreeError('NOT_A_REPOSITORY')` naming the directory. A repository with no commit, or a `git worktree add` that git rejects, fails `WorktreeError('GIT_FAILED')` naming the branch and path.

## Config

| Key | Meaning |
|---|---|
| `providerName` | Registry name on `ctx.subagents` (default `worktree`). |
| `root` (required) | Absolute directory each child's worktree is created under. No default: whether worktrees belong beside the repository, on another volume, or under a backup-excluded path is a deployment choice. A relative value fails the mount. |
| `gitGraceMs` | SIGTERM-to-SIGKILL grace for each git invocation, default 5000. |

## Model Experience

### Child-agent workspace

#### What the model sees

The fresh child receives the standalone task content verbatim and inherits the parent model unless overridden, exactly as with spawn. What differs is the workspace stated in its runtime context: the worktree path, not the parent's directory. A child that lists, reads, or writes files sees its own checkout, and its `workspace-write` refusals name that path.

#### Token effect

Identical to spawn: a new independent context and history, with no parent-history tokens duplicated. The runtime-context workspace line differs by path length alone.

#### KV Cache effect

Independent of the parent request cache. The workspace path is part of the child's runtime context, so each child establishes its own prefix — two children of the same parent never share one.

### Parent tool result, indirectly

#### What the model sees

Through [`dsh-tool-subagent`](../tool-subagent/README.md), the parent receives only the child's final output or stop-reason error. The worktree path and branch are not part of that result: the child's own report is the parent-facing channel for what it did and where.

#### Token effect

Parent input grows by one data-dependent result retained until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The branch is not reported through the seam** — a retained worktree is named in the Host log and discoverable with `git worktree list`, but no result field carries it, so a parent that must merge the work depends on the child stating where it landed.
- **Retained worktrees accumulate** — nothing here collects a worktree that held work. Whoever reviews or merges the branch removes it; a deployment that delegates heavily should expect the configured `root` to grow.
- **One-shot only** — continuable children cannot be worktree-isolated, for the ownership reason above. A role that needs both isolation and a continuable conversation has no composition today.
- **A bypass permission mode defeats it** — the worktree is the session cwd, and the sandbox policy is what makes a cwd a boundary. Verified: under `Full access` a child was handed the delegating workspace's absolute path in its task, ran `cd <path> && …` through `bash`, and wrote there. A deployment that wants isolation enforced runs its delegating sessions under `workspace-write`.
- **The parent's uncommitted work is invisible** — branching at `HEAD` is what makes provisioning cheap and the child's base reproducible, but a task about work in progress must carry it in the prompt.
