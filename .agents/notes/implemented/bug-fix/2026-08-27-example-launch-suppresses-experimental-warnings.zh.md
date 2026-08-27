# Agent Note：共享示例启动器统一消除 Node 的实验性警告

Status: implemented

[English](2026-08-27-example-launch-suppresses-experimental-warnings.md) | 中文

## 问题

快照测试断言被 spawn 的示例不向 stderr 写入任何内容，因为 stderr 不承载产品输出，出现在那里的任何东西都是缺陷。Node 会把它自己的 `ExperimentalWarning` 写到那里——针对产品使用的内置模块，撰写时是 `node:sqlite`——因此在会发出该警告的 Node 上，有三个测试以 `expected '(node:…) ExperimentalWarning: SQL…' to be ''` 失败：`examples/acp-agent/tests/goal.snapshot.ts` 的两个用例，以及 `acp.snapshot.ts` 中的 DeepSeek Files 用例。

这取决于宿主，而非产品故障：同样的测试在不发出该警告的 Node 上通过，这也是它直到 Node v22.23.2 才暴露的原因。

仓库其实早已认定抑制是正确答案，只不过分十五次各自认定了一遍。`examples/headless-agent/tests/headless.snapshot.ts` 在十三个调用点重复 `NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ')`，`examples/jsonrpc-agent/tests/sdk.snapshot.ts` 一处，`packages/e2b/e2b/tests/composition.e2e.ts` 一处。每个 spawn 示例的测试套件都必须知道要重复这一行，而 ACP 套件并不知道——这种不对称本身就是缺陷。

## 决定

`@deepseek-ai/dsh-loader-smoke` 中的 `resolveExampleLaunch` 自己追加该 flag，因此每个被 spawn 的示例在 `src` 与 `lib` 两种 mode 下都会获得它。三条 spawn 路径本就都经过这一个函数——`runLoaderSmoke`、ACP harness 的 `launchAcpTestAgent`，以及一个 subprocess 测试——所以修复能抵达失败的套件，而这两个套件都不必提及该警告。

两条边界让它保持收窄：

- **只消除这一类警告。** `--disable-warning=ExperimentalWarning` 不会抑制 deprecation 或任何其他警告，因此真正的警告仍会抵达那条为捕获它而存在的 stderr 断言。
- **继承而来的 `NODE_OPTIONS` 得以保留。** 调用方设置了值时以其为基底，否则以启动环境的值为基底，因为 spawn 出的环境覆盖在 `process.env` 之上，否则会把它丢掉。当该 flag 已存在时跳过追加，因此仍显式传入它的调用方不会得到重复项。

那十五个调用点被删除而非留下。留着它们会维持「每个套件都必须自行选择加入」的表象，而这正是产生缺口的条件。

## 考虑过的替代方案

- **给两个 ACP 套件各加一行。** 针对已观察到失败的一行式修复，并会为下一个 spawn 示例的套件重新制造同一缺陷。重复才是原因，缺失的那一行不是。
- **在捕获的 stderr 中把该警告规范化掉。** 否决：仓库的规则是修 fixture 而不是修 normalizer，而一个从 stderr 中剥除警告文本的 normalizer 也会掩盖值得被看见的警告。该断言本就应当是 `toBe('')`。
- **抑制全部警告。** 更大的锤子，会连产品应当响应的 deprecation 提示一并吞掉。
- **锁定一个不发出该警告的 Node 版本。** 这不是修复；该警告是正确的，并且会比这个锁定活得更久。

## 影响

`ExampleLaunch.env` 现在始终携带 `NODE_OPTIONS`，`packages/test-support/loader-smoke/tests/example-launch.spec.ts` 为两种 mode、为调用方值与该 flag 并存、以及为不重复这三点各自钉住了行为。今后任何 spawn 示例的调用方都会继承该行为，而无需知道它的存在。

若某个测试确实想观察实验性警告，就必须在这个 helper 之外 spawn。目前没有这样的测试，而一个针对 Node 自身实验性模块提示做断言的测试，钉住的是 Node 的实现细节而非产品行为。

## 测试

`pnpm run test:snapshot` 从 3 失败 / 123 通过变为 126 通过、13 个文件全绿，这正是本次改动的目的；那三个用例即上文点名的三个。`pnpm run test` 与 `pnpm run typecheck` 不变，`pnpm run doc-sync` 保持 28 通过。
