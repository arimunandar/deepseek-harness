# Agent Note: a role-bound delegation preset, because a model cannot choose a route

Status: implemented

English | [中文](2026-08-26-team-agent-preset-role-bound-routes.zh.md)

## Problem

Running several agents on different models within one task had no composed answer. Every mechanism existed — `AgentOptions` carries `provider` and `model`, `dsh-tool-subagent` accepts an `agentOptions` block, and `dsh-llm-pi-ai` registers `openai`, `anthropic`, and `google` routes beside the native DeepSeek one — but no shipped preset put them together, so the arrangement had to be rediscovered and hand-written each time.

The one composition that reads like a team, `dsh-experimental-tool-agent-team`, does not solve it. `SpawnTeammateRequest` carries `name`, `description`, `prompt`, `context`, and `provider`, where `provider` selects a *subagent transport* (`spawn` or `fork`), not an LLM route. `TeamMemberView.model` is a display field the roster reads back. So a teammate inherits the Lead's route, and `spawn_teammate` gives the model no way to ask for another one.

That is not a defect of Agent Teams. Per-teammate routing cannot be a model-chosen argument at all: a model picking its own reviewer's model has no basis for the choice, and a tool argument makes the deployment's cost and vendor decisions runtime-negotiable.

## Decision

The `team` preset ships three delegation tools instead of one generic `subagent`, each a separate `dsh-tool-subagent` instance whose config fixes the route, persona, tool set, and depth cap:

| Tool | Route | Background mode | Denies |
|---|---|---|---|
| `delegate_engineer` | `openai` / `gpt-5.3-codex` | `continuable` | the three role tools, `workflow` |
| `delegate_reviewer` | `anthropic` / `claude-sonnet-4-5` | `one-shot`, background disabled | also `write`, `edit` |
| `delegate_researcher` | `google` / `gemini-2.5-pro` | `continuable` | also `write`, `edit` |

The model therefore chooses a *role*. Everything a role implies is a load-time deployment fact, which is exactly what `dsh-tool-subagent`'s one-policy-per-instance rule already enforces — the README states it as a limitation ("another model, persona, tool filter, or depth cap requires another distinctly named tool"), and for this composition it is the property being relied on.

Every role uses `provider: spawn`. A fresh child is what makes another vendor's route affordable: `fork` would replay the lead's DeepSeek turns to Anthropic or Google, paying that vendor's input rate for a transcript it did not produce and discarding prefix-cache reuse on both sides. The cost is that role prompts must be self-contained, which the lead persona asks for directly.

`toolFilter` uses `deny`, never `allow`. `tools.restrict()` rejects unknown names loud, and `tool-bash` is `disabled` on Windows while `tool-pwsh` is disabled elsewhere — so an allow list naming `bash` fails to mount on Windows. Denial states the role boundary without enumerating the platform.

`tool-ralph` is left out. It starts fresh children on a fixed `subagentProvider` with the parent's own options, which is a fourth role with no name, route, or persona — the one thing the preset exists to prevent. `tool-workflow` stays, for the lead alone: every role denies `workflow`, so deterministic orchestration of the roles remains available where the model should not be choosing the order.

Routes are not shipped with the preset. `dsh-llm-pi-ai` mounts dormant in `dsh-base` and registers routes only once a `llm-pi-ai:` settings section supplies profiles, so a delegation against an unconfigured role fails until the deployment supplies one. A role meant to run the lead's own route drops its `agentOptions` block.

That failure is loud in the child and quiet in the parent. The child's log carries `LlmError('NO_ADAPTER')` — `no adapter registered for provider "anthropic"` — while the parent's tool result is the stop-reason headline alone, `Error: subagent run failed`: the in-process provider supplies no `SubagentResult.diagnostic` for a child whose own model request never started. So the route name reaches the durable log and not the model, and diagnosing an unconfigured role means opening the child transcript.

## Alternatives considered

**Add `agentOptions` to `spawn_teammate` and build this on Agent Teams.** The teams runtime already owns a roster, a task board, peer mail, and Lead authority — everything this preset does without. Rejected for now because it moves route selection into a model-supplied argument, which is the property this design deliberately removes. The composed answer is the reverse: teach `ctx.agentTeams` to read a *deployment-configured* role table, so a Lead spawns `reviewer` and the table decides the route. That is a change to the experimental package and belongs in its own PR.

**One `subagent` tool plus a `role` argument.** Keeps the catalog small and reads naturally, but it is the same defect in a smaller space: the route becomes model-chosen, the config grows a role dict that duplicates what a second plugin instance already expresses, and `SubagentCapabilities` checks would have to move from mount time to call time.

**Allow lists instead of deny lists.** Reads as a tighter boundary and is how a reviewer's read-only role wants to be written. It cannot be spelled portably: the shell tool's name differs by platform and `read_image` registers only with `ctx.attachments`, so a correct allow list is either platform-conditional `!!js` or a mount failure on some host.

**Worktree isolation per role.** The real fix for concurrent workspace effects, and the reason only `delegate_engineer` may mutate files here — a single writer sidesteps the conflict rather than solving it. Nothing in the repo isolates a child's workspace today; adding a provider or driver option that does is the natural next change and is not in this preset.

## Consequences

`ctx.agentPresets.list()` now returns five presets. The `cordis` preset's `order` moves from `4` to `5` so `team` sorts before the authoring preset, and the roster snapshots under `apps/web/tests/snapshots/agent-preset-authoring/` gain its row.

Shipping a preset means shipping its Web display copy too. `presetDisplayText` localizes a `system` row only when `BUILT_IN_PRESET_KEYS` in `packages/client/ui-agent-preset/src/client/locales.ts` maps its id; an unmapped shipped id falls through to the file's own `preset.yml` metadata, which for every preset here is Chinese — so it renders untranslated in the English UI rather than failing. `team` adds `presetTeamName` and `presetTeamDescription` to both bundles and the key table.

The tool filters buy visibility, not authority — the agent-scope Agent Note names that a [security non-goal](../architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals). A reviewer denied `write` and `edit` still holds the shell, so what keeps it from editing is its persona. What the filters do guarantee is that no role can re-delegate or start a workflow, which together with `maxDepth: 1` makes a grandchild unreachable by two independent means.

Token accounting is complete here only because every role is in-process: `ctx.tokenMeter` folds each child's usage by Session. A deployment that swaps a role onto `provider: codex` or `claude-code` loses that — those children report no usage through the seam — so the meter would under-report rather than showing a gap.

## Testing

`apps/cli/tests/web-agent-presets.e2e.ts` boots the real shipped Web composition and pins the exact tool catalog `team` composes, for the reason the `standard` case gives: a row that registers into the wrong layer mounts cleanly and contributes nothing, so an omission is this design's quietest failure. The assertion is written around three absences — no `subagent`, no `subagent_fork`, no `ralph` — because an unrouted delegation path is what would defeat the preset. The same file's roster case now expects five preset ids.

`packages/client/ui-agent-preset/tests/locales.client.spec.ts` covers the new locale rows, but the surface that caught the omission is `apps/web/tests/agent-preset-selection.e2e.ts`: its menu golden renders the English UI, so an unmapped id shows up there as Chinese text next to four English rows. Web goldens must be refreshed against a BUILT client — a refresh over stale `dist` re-records the old copy and reads as a passing test.

The refreshed authoring goldens also pick up a `连接` settings-navigation row that was already missing from them on `master`; those three cases fail identically at `25f2f9cc42` without this change.

No automated test covers a delegation call: the three routes are dormant until a deployment supplies `llm-pi-ai:` profiles, and a keyed test would assert the pi-ai adapter's behavior rather than this composition's. The route wiring was instead verified by hand against a running `dsh web` on a real DeepSeek key — the lead listed all three `delegate_*` tools and none of `subagent`, `subagent_fork`, or `ralph`, and a `delegate_reviewer` call produced the `NO_ADAPTER` failure above naming `anthropic`, which is what proves `agentOptions` reaches the child.
