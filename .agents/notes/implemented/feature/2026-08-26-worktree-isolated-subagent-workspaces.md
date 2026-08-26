# Agent Note: worktree isolation is a child's session cwd, and only as strong as the permission mode

Status: implemented

English | [中文](2026-08-26-worktree-isolated-subagent-workspaces.zh.md)

## Problem

Concurrent in-process children shared one workspace. `childSessionMeta` copies the parent header's `cwd` to every child, so two children started from one parent wrote the same files, and `dsh-tool-subagent`'s README states the consequence plainly: *"Coordinating sibling workspace effects belongs to the model."*

That is not a coordination problem a prompt can solve. Whether two agents clobber each other depends on which files they touch, which neither can predict before touching them, and the loser's work is already gone by the time either notices. The [team preset](2026-08-26-team-agent-preset-role-bound-routes.md) sidestepped it by letting exactly one role write, which is a real constraint on what a team can do rather than a fix.

## Decision

`dsh-subagent-worktree-in-process` registers a `worktree` provider: the spawn provider with the child's workspace changed. `start()` resolves the delegating session's cwd to its repository root, reads that repository's `HEAD`, adds a worktree on a fresh `dsh/subagent/<uuid>` branch at that commit, and hands the path to the shared driver as the child's session cwd.

The session cwd is the whole mechanism. `ctx.sandboxPolicy` already derives its `workspace-write` boundary from `session.header.cwd`, and the filesystem tools and shell spawns resolve against the same per-call policy, so isolation follows from one durable session fact. The driver change is correspondingly small: `InProcessRunOptions` gains a `cwd` that shadows the inherited parent cwd for that child alone.

That also fixes the limit: isolation is exactly as strong as the permission mode. Under `workspace-write` the boundary is enforced. Under a bypass mode nothing enforces a cwd, and a live run confirmed the consequence — a child handed the delegating workspace's absolute path in its task ran `cd <path> && …` through `bash` and wrote there. The lead persona now forbids putting an absolute path in a delegated task and the engineer persona forbids following one, because the agent most likely to hand a child the wrong tree is its own lead.

Teardown keeps work. Disposal disposes the child first, then retires the worktree only when it is empty: `git status --porcelain` silent and no commit added past the base commit. Otherwise the worktree is retained and the Host log names its path and branch. A `git status` that could not be produced counts as work, because refusing to remove a directory whose state is unknown is the only safe direction.

`prepareContinuable` is absent, which is how a provider declines that path — its presence is the capability the continuation manager narrows on. A continuable child is composed by that manager and outlives every run this provider wraps, including cold resume in a later process, so nothing here could own its worktree's removal.

`root` has no default. Whether worktrees belong beside the repository, on another volume, or under a backup-excluded path is a deployment choice; the `dsh-base` bundle names one under the harness home and a deployment overrides it there. A relative value fails the mount rather than resolving against whatever directory the host was started from.

## Alternatives considered

**A `workspace` option on the spawn provider.** Fewer files, and it is genuinely one option's worth of behavior. Rejected because `subagent-fork-in-process` is the precedent: it also differs from spawn by one argument to the shared driver and is still its own provider. Keeping the axis in the registry name means a preset selects isolation by naming a provider, and two roles can differ without a second config dialect.

**Copy the parent directory instead of branching.** Would give the child the parent's uncommitted work, which is what a task about work in progress wants. Rejected because the result is then a directory with no identity — nothing to merge, nothing to review, and no cheap way to tell what the child changed. A branch answers all three, and the cost is that such a task must carry the work in its prompt.

**Report the branch through `SubagentResult`.** The parent needs to know where the work landed, and a result field would say so without depending on the child. Deferred rather than rejected: `SubagentResult.diagnostic` is the failure channel, and adding a success-path field to the seam for one provider's benefit is a change to the Service Definition that every other provider would have to mean something by. Today the child's own report is the parent-facing channel.

**Collect retained worktrees on a later start.** Tempting, and wrong in the same way an automatic removal is: the retained ones are exactly those holding work nobody has looked at yet.

## Consequences

The `team` preset's `delegate_engineer` now uses `provider: worktree`, so the one role that writes cannot reach the lead's files, and it is `one-shot` because a worktree child cannot be continuable. Its result lands on a branch, which changes what the lead must do with it: read the report, then merge or review the branch.

`ctx.subagents` gains a fourth in-process provider name, and `dsh-base` mounts it, so any deployment on that bundle can point a delegation tool at `worktree` without installing anything.

Retained worktrees accumulate under the configured `root`. Nothing collects them, by design, so a deployment that delegates heavily should expect that directory to grow until someone reviews the branches.

## Testing

`packages/subagent/subagent-worktree-in-process/tests/subagent-worktree-in-process.spec.ts` drives the real backend against real git — a temporary repository per case, the real local subprocess provider, a real loop, a scripted model. Nothing stubs git, because what this package owns is exactly the sequence of git invocations and the decision they feed. It pins the child's session cwd inside the configured root and as a checkout of the parent's HEAD; removal when clean; retention on an uncommitted edit; retention on a commit with a clean status, which is the case only the base-commit count distinguishes; refusal without a repository and without any cwd; no worktree left behind when the start aborts; the continuable path refused; and provider withdrawal on fiber disposal.

Both halves of the permission-mode limit were verified by hand against a running `dsh web` with a real Claude Sonnet 4.5 engineer and a throwaway repository. Under `workspace-write` the engineer's edit landed in its worktree, the delegating tree was untouched, and the worktree was retained on its branch because it held work. Under `Full access` the same delegation wrote to the delegating tree, which is what the corrected README and personas now address.

`tests/loader-composition.e2e.ts` boots the headless app through the real Loader over a test-only `cordis.yml`, with the isolated cwd prepared as a real repository. It asserts the persisted child session header's `cwd`, not model text: the workspace decision is durable in the session log, while a mock's answer would only report what it was told to say.
