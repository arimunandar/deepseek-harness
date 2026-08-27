# Agent Note：分派子 Agent 的花费是一个会话事件，而它的缺席意味着未测量

Status: implemented

[English](2026-08-27-delegated-token-usage.md) | 中文

## 问题

`ctx.tokenMeter` 从持久会话日志折算用量。进程内子 Agent 拥有一个 Session，所以它的花费在那里已经被计入。进程外子 Agent——Codex、Claude Code、某个 ACP 对端——在本 harness 中不拥有 Session：它的模型请求发生在另一个 harness 里，而这里没有任何东西记录它们。

结果是一个读起来完整、却漏掉了不设上限的一部分的总数。把某个角色从 `spawn` 换到 `claude-code` 的部署会看到其已测量花费**下降**，因为工作搬到了计量器看不见的地方。这比一个可见的缺口更糟：它看起来像是省钱了。

## 决策

`subagent/usage` 是一个仅记录日志的会话事件，在前台 run 结算时追加到**分派方**会话，携带子 Agent 的 token 分桶、其子 Agent id，以及上报它的 provider。分派方会话是进程外子 Agent 的花费唯一能落下的持久位置，因为该子 Agent 在这里没有自己的日志。

seam 按各角色实际知道什么来切分。Service Provider 上报 `SubagentReportedUsage`——四个互不重叠的 token 分桶，以及当其协议只点名一个模型时的该模型——因为在它读取子 Agent 协议的那一点上，它知道数字，却对 run 身份一无所知。Consumer 补上它持有而 provider 不持有的 `childId` 与 `reportedBy`。因此 `SubagentResult.usage` 不携带任何 id。

这些分桶就是 `ctx.tokenMeter` 本就在求和的那四个（`uncachedInputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`outputTokens`），于是分派花费可以直接加到已测量花费上，无需协调两套词汇。

**缺席意味着未测量，而不是零。** 协议里不携带用量的 provider 什么都不追加，而 `reportedBy` 点名该 provider，让读取方能说出它缺了哪一次分派，而不是报出一个更小的数。记录发生在失败结果抛出之前，所以一个花了 token 然后失败的 run 仍然被计入——那正是最值得注意的那类 run。

`subagent-claude-code` 今天就上报它：官方 SDK 的 `result` 消息携带 `usage` 与 `modelUsage`，恰好就在 provider 已经读取的位置。该值以 JSON 形式穿过了进程边界，所以它被校验而非被信任——缺失的对象或读不出的分桶不产生任何上报，因为把一次解码缺口变成零，等于声称该子 Agent 是免费的。为 null 的缓存分桶是真正的零，并被当作零保留。

`subagent-codex` 不上报任何东西。它的 `turn/completed` 通知也许携带用量，但安装的 `@openai/codex` 包只发布一个二进制、不带任何 schema，因此本仓库里没有关于那些字段叫什么的证据。猜一个 wire 字段来填一个数字，正是一个错误数字变成持久事实的方式。

## 考虑过的替代方案

**加上金额。** Claude SDK 上报 `total_cost_usd`，而成本才是这个缺口真正关心的东西。被否决：harness 不拥有任何定价 seam，因此一个货币数字会成为日志中唯一的计价事实，且没有任何东西能与之核对；而它还是厂商对厂商账户的报价，不是 harness 能验证的任何东西。

**经由服务调用把用量折进 `ctx.tokenMeter`。** 该计量器按构造就是重放驱动的——它按会话从持久日志推进一份彼此隔离的折算——所以一个推送式 API 会给它第二个无法重放的事实来源。写下事件、让折算自己发现它，才保持单一来源。

**记录到子 Agent 自己的会话里。** 对进程内子 Agent 是正确的，而它们本来就这么做。对本机制存在的理由——那些子 Agent——则不可能：它们在这里没有会话，这正是问题所在。

**把未测量的分派报为零并在界面上加注。** 出于"缺席"存在的同一理由被否决：零是一个数字，而数字会被求和。一个缺失的事件不可能被不小心加进去。

## 后果

`SessionEventMap` 多了一个成员。它仅记录日志——没有 `surfaceOp`、从不进入模型历史、经受压缩——而模型什么也看不到：分派工具的结果在两种情况下逐字节相同。

`SubagentResult` 多了一个可选字段，所以每个既有 provider 都因"不上报"而保持正确。四个此前以相等性钉住整个结果的真实产品 Claude Code 用例，现在断言不含 `usage` 的结果，并单独检查上报的分桶，因为真实 CLI 的 token 计数不会在产品版本与缓存状态之间保持稳定。

后台 one-shot 与 continuable 分派目前不记录任何东西。后台 run 的结果经由通用任务面收集，而 continuable 子 Agent 的结果根本不经由该工具返回，所以两者都不在这个 Consumer 能看到的地方结算。这个缺口比本次关闭的那个窄，但它是真实的。

目前还没有任何 projection 读取该事件。事实已经持久且有名字，这正是一个总数不再错误所需要的；把分派花费与已测量花费并列呈现，是对 `token-meter` 及其 projection 单元的另一次改动。

## 测试

`packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts` 针对进程边界可能交付的形态覆盖了读取器：带单一计费模型的四个分桶、多个计费模型时不归属任何模型、为 null 的缓存分桶作为真正的零，以及四种读不出的上报各自不产生任何结果而非零。另有两个用例让读取器经过 `consumeClaudeQuery`，使结果的 `usage` 就是 provider 实际返回的东西。

`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` 以一个会话会记录追加内容的父级，经由发布代码路径覆盖记录行为：一条归属到子 Agent id 与 provider 的 `subagent/usage`、provider 不上报时不追加任何东西，以及为一个花费后失败的 run 记录一条。它同时钉住面向模型的工具结果保持不变。

`packages/subagent/subagent-claude-code/tests/real-product.spec.ts` 让读取器面对真实分发的 Claude Code CLI，这是 SDK 字段名正确的唯一证据。
