# Agent Note：只有在子 Agent 还没来得及动手就被拒绝时，分派才回退

Status: implemented

[English](2026-08-27-delegation-route-fallback.md) | 中文

## 问题

[team preset](2026-08-26-team-agent-preset-role-bound-routes.zh.md) 把每个角色钉在一条路由上，这正是让角色成为部署决策、而不是模型选择的原因。代价是：部署无法服务其路由的角色每次都失败，而真实运行测试在真实账号上连续产生了三种这样的失败：

- `NO_ADAPTER` —— `no adapter registered for provider "anthropic"`，出现在没有 `llm-pi-ai:` 区块的部署上。
- `Provider is not configured: anthropic` —— 路由声明了，但其凭据库是空的。
- `Project proj_… does not have access to model gpt-5.3-codex` —— 随包发布的 engineer 默认模型，出现在没有 codex 访问权的 OpenAI project 上。

每一种都杀掉了一次 lead 本可以在另一条路由上完成的分派。更糟的是，父级的工具结果是不带路由名的 `Error: subagent run failed`，于是运维不打开子 Agent 会话记录，连哪个角色路由配错了都看不到。

## 决策

`dsh-tool-subagent` 新增 `fallbackAgentOptions`：一条第二路由，用于**再**启动一个子 Agent。不做链式——回退再失败就是最终结果。

两个条件共同把关，且都是必要的。

失败必须点名一个合格的 `failure.code`。这要求把该码暴露出来：`SubagentResult` 新增可选的 `failure`，携带该轮次的结构化 `LlmFailure`，由进程内 driver 从它的 `turn/end` 原因中读出。基于 `diagnostic` 做路由判断本来不需要改 seam，但被否决了——那个字段是安全的展示文本，而仓库自己的规则就是按码路由、绝不解析消息。

该子 Agent 必须什么都没产出。`output.length === 0` 是本 seam 能提供的、关于失败之前什么都没发生的唯一证据，也正是它让"再启动"成为对同一任务的第二次尝试，而不是对已完成工作的重复。

`fallbackOnCodes` 默认为路由在**任何** provider 请求之前就会抛出的那些码：`NO_ADAPTER`、`UNKNOWN_MODEL`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`UNSUPPORTED_REASONING_EFFORT`。被其中之一拒绝的子 Agent 从未触及网络，所以再启动不可能重复任何效应。`QUOTA`、`AUTH` 与 `RATE_LIMIT` 被刻意**排除**在默认集合之外：它们可能在运行中到来，而空 `output` 无法区分"什么都没做"的子 Agent 与"调用了工具但没产出助手文本"的子 Agent。部署方可以把它们加上，而配置文档说明了这样做等于接受什么。

每次替换都会在替换子 Agent 启动之前向分派方会话追加一条 `subagent/fallback`，点名被拒绝的子 Agent、失败码，以及两条路由。没有它，日志对第一次尝试一无所述：替换者自己的 `request/header` 只记录它实际运行的那条路由，于是拿角色配置路由与实际运行做对比的读者，会看不到任何需要解释的差异。

## 考虑过的替代方案

**在 agent 循环里、于 `agent/request-error` 上回退。** 这是实现之前提出的设计，而它行不通。`installModelSelection`——`api-proxy` 与 headless bundle 都会安装它——注册了一个 `agent/request` 监听器，先调用 `next()` 再用自己的快照覆写 `provider` 与 `model`，所以在链条更深处设置的路由会被覆盖掉。它的 `current` getter 读取最近一次记录的 `request/header`，而 selection ref 本身对每个入口点是私有的，因此没有插件能影响它。要让它成立，需要一个由每个入口点发布的 `modelSelection` 服务——那是根会话回退的正确终局，不属于一次分派失败的范围。

**对任何失败都回退。** 更简单，而且错在花钱和重复副作用的那个方向。`SERVER` 或 `TIMEOUT` 失败在同一条路由上就可重试，而这已由 `dsh-llm-retry` 拥有；替换路由等于为一次瞬时故障向另一家厂商计费，并把它藏起来。

**串联多条路由。** 作为臆测被否决。一条回退已覆盖"所配置的路由无法服务这个部署"这个被观察到的失败；而链式会招致一次分派在报告之前悄悄花掉三家厂商的钱。

**把替换告知模型。** 模型调用了一个工具、想要一个答案；结果由哪条路由产出是部署事实，不是与任务相关的内容，把它放进结果会改变模型可见文本却对模型毫无好处。

## 后果

`SubagentResult` 多了一个可选字段，所以每个 provider 都因"省略"而保持正确。今天只有进程内 driver 会填充它；进程外 provider 上报 `diagnostic` 文本而没有码，所以它们的子 Agent 永远不符合回退条件。这是一个真实的、也是诚实的缺口——那些 provider 的协议并不携带 harness 的失败码。

`settleForegroundRun` 拆成了 `collectForegroundRun`（结算并释放，即使结果是错误也返回）与 `toForegroundToolResult`（抛出或转换）。旧的单一函数在调用方能检视失败之前就抛出，而这恰恰是该决策所需要的。

team preset 的 `delegate_engineer` 现在回退到 `deepseek-official`。它的 `openai` 默认正是真实运行中失败的那条路由，而 lead 自己的厂商是一个 DeepSeek Harness 部署可以被假定拥有的唯一路由。

后台与 continuable 分派不回退。后台 run 经由通用任务面结算，而 continuable 子 Agent 从不经由该工具返回结果，所以两者都到不了做决定的那段代码。

## 测试

`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` 在一个按启动次序索引脚本的 scripted provider 之上驱动发布代码路径，于是一个用例可以让第一次尝试被拒绝、第二次得到服务。它钉住：成功的替换，以及第二次启动点名的是回退路由；追加的 `subagent/fallback` 及其两条路由与失败码；对不合格码（`SERVER`）、对失败前已有产出的子 Agent、以及未配置回退时都不回退；回退自身失败即为最终；以及显式 `fallbackOnCodes` 列表接纳 `QUOTA`。

问题一节中的三种路由失败来自针对真实 OpenAI 与 Anthropic 账号的实际运行，默认码集合正是由此而来，而不是靠猜哪些失败重要。
