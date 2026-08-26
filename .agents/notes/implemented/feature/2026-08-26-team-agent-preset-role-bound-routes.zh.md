# Agent Note：按角色绑定的分派 preset，因为路由不该由模型选

Status: implemented

[English](2026-08-26-team-agent-preset-role-bound-routes.md) | 中文

## 问题

在同一个任务里让多个 Agent 跑在不同模型上，此前没有任何已组装好的答案。机制其实都在：`AgentOptions` 带 `provider` 与 `model`，`dsh-tool-subagent` 接受 `agentOptions` 配置块，`dsh-llm-pi-ai` 会在原生 DeepSeek 路由之外注册 `openai`、`anthropic`、`google` 路由——但没有任何随包发布的 preset 把它们拼在一起，于是这套组合每次都要重新摸索、手写一遍。

唯一读起来像"团队"的组合 `dsh-experimental-tool-agent-team` 并不能解决它。`SpawnTeammateRequest` 携带 `name`、`description`、`prompt`、`context` 和 `provider`，而这里的 `provider` 选的是**子 Agent 传输方式**（`spawn` 或 `fork`），不是 LLM 路由。`TeamMemberView.model` 只是 roster 回读的展示字段。所以队友只能继承 Lead 的路由，`spawn_teammate` 也没有给模型任何请求另一条路由的途径。

这不是 Agent Teams 的缺陷。按队友分配路由根本就不该是模型可选的参数：模型自己挑评审员的模型没有任何依据，而把它做成工具参数，等于让部署方的成本与厂商决策在运行时可以被谈判。

## 决策

`team` preset 发布三个分派工具，取代单个通用 `subagent`；每个都是独立的 `dsh-tool-subagent` 实例，其配置固定了路由、persona、工具集与深度上限：

| 工具 | 路由 | 后台模式 | 拒绝的工具 |
|---|---|---|---|
| `delegate_engineer` | `openai` / `gpt-5.3-codex` | `continuable` | 三个角色工具、`workflow` |
| `delegate_reviewer` | `anthropic` / `claude-sonnet-4-5` | `one-shot`，禁用后台 | 另加 `write`、`edit` |
| `delegate_researcher` | `google` / `gemini-2.5-pro` | `continuable` | 另加 `write`、`edit` |

于是模型选的是**角色**。角色蕴含的一切都是加载期的部署事实——这正是 `dsh-tool-subagent` 一实例一策略规则已经强制的：其 README 把这条写作限制（"换模型、persona、工具过滤或深度上限都需要另一个名字不同的工具"），而在这个组合里，它恰恰是被依赖的性质。

所有角色都用 `provider: spawn`。全新子 Agent 才让另一家厂商的路由付得起：`fork` 会把 lead 的 DeepSeek 轮次重放给 Anthropic 或 Google，按对方的输入价为一份并非它产出的会话记录付费，同时让双方的前缀缓存复用全部作废。代价是角色 prompt 必须自包含，而 lead 的 persona 正是这么要求的。

`toolFilter` 只用 `deny`，不用 `allow`。`tools.restrict()` 遇到未知名称会显式失败，而 `tool-bash` 在 Windows 上是 `disabled`、`tool-pwsh` 在其他平台上是 `disabled`——所以一个写了 `bash` 的 allow 列表在 Windows 上会挂载失败。用拒绝来表达角色边界，就不必把平台一一列举。

`tool-ralph` 被排除在外。它以固定的 `subagentProvider` 启动全新子 Agent，并沿用父级自己的 options，等于第四个没有名字、没有路由、没有 persona 的角色——正是这个 preset 存在的目的所要防止的东西。`tool-workflow` 保留，且只给 lead：每个角色都拒绝 `workflow`，所以在不该由模型决定顺序时，对角色的确定性编排仍然可用。

路由不随 preset 发布。`dsh-llm-pi-ai` 在 `dsh-base` 中以休眠状态挂载，只有当 `llm-pi-ai:` 设置区块提供 profile 后才注册路由；在部署方配置之前，对未配置角色的分派会失败。想让某个角色跑 lead 自己的路由，就删掉它的 `agentOptions` 块。

这个失败在子 Agent 一侧是显式的，在父级一侧是安静的。子 Agent 的日志里带着 `LlmError('NO_ADAPTER')`——`no adapter registered for provider "anthropic"`；而父级拿到的工具结果只有一行停止原因 `Error: subagent run failed`：对于自身模型请求根本没有发起的子 Agent，进程内 provider 不提供 `SubagentResult.diagnostic`。于是路由名进入了持久日志，却没有进入模型；排查一个未配置的角色要打开子 Agent 的会话记录。

## 考虑过的替代方案

**给 `spawn_teammate` 加 `agentOptions`，把这件事建在 Agent Teams 上。** teams 运行时已经拥有 roster、任务板、同伴信箱和 Lead 权限——这个 preset 全都没有。当前被否决，是因为它把路由选择搬进了模型提供的参数，而这恰是本设计刻意移除的性质。组装好的答案方向相反：让 `ctx.agentTeams` 读取一张**部署方配置**的角色表，于是 Lead 生成 `reviewer`，由该表决定路由。那是对实验包的改动，属于它自己的 PR。

**单个 `subagent` 工具加一个 `role` 参数。** 目录更小、读起来也自然，但那是同一个缺陷换了个更小的场地：路由变成模型可选，配置长出一个角色字典去重复第二个插件实例本已表达的东西，而 `SubagentCapabilities` 检查也必须从挂载期推迟到调用期。

**用 allow 列表取代 deny 列表。** 读起来边界更紧，评审员的只读角色也确实想这么写。但它无法可移植地拼写：shell 工具的名字随平台而变，`read_image` 只在有 `ctx.attachments` 时注册，所以一份正确的 allow 列表要么是带条件的 `!!js`，要么在某些宿主上直接挂载失败。

**按角色做 worktree 隔离。** 这才是并发工作区效应的真正修法，也是这里只有 `delegate_engineer` 可以改文件的原因——单一写者是绕开冲突，而非解决冲突。仓库中目前没有任何东西隔离子 Agent 的工作区；补一个具备该能力的 provider 或 driver 选项是顺理成章的下一步改动，不在本 preset 内。

## 后果

`ctx.agentPresets.list()` 现在返回五个 preset。`cordis` preset 的 `order` 从 `4` 移到 `5`，使 `team` 排在创作用 preset 之前，`apps/web/tests/snapshots/agent-preset-authoring/` 下的 roster 快照也多出它那一行。

发布一个 preset 也意味着要发布它的 Web 展示文案。`presetDisplayText` 只有在 `packages/client/ui-agent-preset/src/client/locales.ts` 的 `BUILT_IN_PRESET_KEYS` 映射了某个 id 时，才会本地化该 `system` 行；未被映射的随附 id 会落回该 preset 自己 `preset.yml` 里的元数据，而这里每个 preset 的元数据都是中文——于是它在英文界面中显示为未翻译文本，而不是报错。`team` 为两套 locale 包和这张 key 表补上了 `presetTeamName` 与 `presetTeamDescription`。

工具过滤买到的是可见性，不是权限——agent-scope Agent Note 把这一点写为[安全非目标](../architecture/2026-07-08-agent-scope-contexts.zh.md#security-and-authority-are-non-goals)。被拒绝 `write` 和 `edit` 的评审员仍然握有 shell，所以真正阻止它编辑的是它的 persona。这些过滤确实保证的是：没有任何角色能再次分派或启动工作流，这一点与 `maxDepth: 1` 一起，让孙代 Agent 由两条独立途径同时不可达。

Token 计量在这里之所以完整，只因为每个角色都在进程内：`ctx.tokenMeter` 按 Session 折算每个子 Agent 的用量。把某个角色换到 `provider: codex` 或 `claude-code` 的部署会失去这一点——那类子 Agent 不通过该 seam 报告任何用量——所以计量会少报，而不是显示一个缺口。

## 测试

`apps/cli/tests/web-agent-presets.e2e.ts` 启动真实的随包 Web 组合，并钉住 `team` 组装出的精确工具目录，理由与 `standard` 那个用例给出的相同：注册进错误层的行会干净地挂载却什么也不贡献，所以遗漏是本设计最安静的失败方式。断言围绕三个"缺席"来写——没有 `subagent`、没有 `subagent_fork`、没有 `ralph`——因为能击溃这个 preset 的正是一条无路由的分派通路。同一文件的 roster 用例现在期望五个 preset id。

`packages/client/ui-agent-preset/tests/locales.client.spec.ts` 覆盖了新增的 locale 行，但真正抓出这处遗漏的是 `apps/web/tests/agent-preset-selection.e2e.ts`：它的菜单 golden 渲染英文界面，所以一个未被映射的 id 会以中文文本的形式出现在四行英文之间。Web golden 必须针对**已构建**的客户端刷新——在过期 `dist` 上刷新会把旧文案重新记录下来，读起来像是一个通过的测试。

刷新后的 authoring golden 同时补上了一行 `连接` 设置导航，而它在 `master` 上就已经从 golden 中缺失；不带本次改动，这三个用例在 `25f2f9cc42` 上以完全相同的方式失败。

没有自动化测试覆盖分派调用：路由在部署方提供 `llm-pi-ai:` profile 之前都处于休眠，而一个带密钥的测试断言的会是 pi-ai 适配器的行为，不是这个组合的行为。接线改为手工验证，分两部分。

在没有 `llm-pi-ai:` 区块的部署上，一次 `delegate_reviewer` 调用产生了上文那个点名 `anthropic` 的 `NO_ADAPTER` 失败。在其区块声明了 `anthropic`（一条无密钥的目录路由，交由 pi-ai 自己的凭据库处理）的部署上，同一次调用从一个跑着另一家厂商模型的 lead 成功发出，且子 Agent 会话的 `request/header` 五次记录了 `provider: anthropic` 与 `model: claude-sonnet-4-5`，旁边是 `provider: spawn`、`origin: subagent` 和 `delegationDepth: 1`。

该子 Agent 自己的回答声称的模型与它实际运行的并不相同。路由要从 `request/header` 读，绝不要从子 Agent 自称的身份读：模型的自我报告不是关于其路由的证据，而这次它就是错的。
