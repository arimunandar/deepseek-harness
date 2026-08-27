# Agent Note: the shared example launcher silences Node's experimental warnings

Status: implemented

English | [中文](2026-08-27-example-launch-suppresses-experimental-warnings.zh.md)

## Problem

Snapshot tests assert that a spawned example writes nothing to stderr, because stderr carries no product output and anything on it is a defect. Node writes its own `ExperimentalWarning` there for the built-in modules the product uses — `node:sqlite` at time of writing — so on a Node that emits it, three tests failed with `expected '(node:…) ExperimentalWarning: SQL…' to be ''`: both cases in `examples/acp-agent/tests/goal.snapshot.ts` and the DeepSeek Files case in `acp.snapshot.ts`.

This was host-dependent, not a product fault: the same tests pass on a Node that does not emit the warning, which is why it went unnoticed until Node v22.23.2.

The repository had already decided that suppression is the right answer, but decided it fifteen separate times. `examples/headless-agent/tests/headless.snapshot.ts` repeated `NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ')` at thirteen call sites, `examples/jsonrpc-agent/tests/sdk.snapshot.ts` at one, and `packages/e2b/e2b/tests/composition.e2e.ts` at one. Every suite spawning an example had to know to repeat it, and the ACP suites did not — the asymmetry was the bug.

## Decision

`resolveExampleLaunch` in `@deepseek-ai/dsh-loader-smoke` adds the flag itself, so every spawned example gets it in both `src` and `lib` mode. All three spawn paths already route through that one function — `runLoaderSmoke`, the ACP harness's `launchAcpTestAgent`, and one subprocess test — so the fix reaches the failing suites without either of them naming the warning.

Two boundaries keep it narrow:

- **Only this warning class is silenced.** `--disable-warning=ExperimentalWarning` does not suppress deprecation or any other warning, so a real one still reaches the stderr assertion that exists to catch it.
- **An inherited `NODE_OPTIONS` survives.** The base is the caller's value when it sets one, otherwise the launching environment's, because the spawned environment layers over `process.env` and would otherwise drop it. Appending is skipped when the flag is already present, so a caller that still passes it explicitly gets no duplicate.

The fifteen call sites were removed rather than left in place. Leaving them would preserve the appearance that each suite must opt in, which is the condition that produced the gap.

## Alternatives considered

- **Adding the flag to the two ACP suites.** The one-line fix for the observed failure, and it recreates the defect for the next suite that spawns an example. The repetition was the cause, not the missing line.
- **Normalizing the warning out of captured stderr.** Rejected: the repository's rule is to fix fixtures rather than normalizers, and a normalizer that strips warning text from stderr would also hide a warning worth seeing. The assertion is meant to be `toBe('')`.
- **Suppressing all warnings.** A larger hammer that would swallow deprecation notices the product should act on.
- **Pinning a Node version that does not emit it.** Not a fix; the warning is correct and will outlive the pin.

## Consequences

`ExampleLaunch.env` now always carries `NODE_OPTIONS`, which `packages/test-support/loader-smoke/tests/example-launch.spec.ts` pins for both modes, for a caller value preserved beside the flag, and for the no-duplicate case. Any future example spawner inherits the behavior without knowing it exists.

A test that genuinely wants to observe an experimental warning would have to spawn outside this helper. None does, and a test asserting on Node's own experimental-module notice would be pinning a Node implementation detail rather than product behavior.

## Testing

`pnpm run test:snapshot` goes from 3 failed / 123 passed to 126 passed with 13 files green, which is the whole point of the change; the three cases are the ones named above. `pnpm run test` and `pnpm run typecheck` are unchanged, and `pnpm run doc-sync` stays at 28 passed.
