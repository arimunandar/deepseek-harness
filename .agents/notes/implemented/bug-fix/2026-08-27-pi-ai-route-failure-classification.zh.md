# Agent Note：两种 pi-ai 路由失败带上规范 code，使委派得以被救回

Status: implemented

[English](2026-08-27-pi-ai-route-failure-classification.md) | 中文

## 问题

[委派路由回退](../feature/2026-08-27-delegation-route-fallback.zh.md)会在第一个子智能体因路由原因被拒绝且没有产出任何输出时，启动一个替补子智能体。在真实部署上它从未触发，因为实际发生的两种失败都以 `dsh-llm-pi-ai` 的兜底 code 到达：

- `Provider is not configured: anthropic`——路由已在 settings 中声明，但凭据存储为空。
- ``Project `proj_…` does not have access to model `gpt-5.3-codex` ``——出厂的 engineer 默认路由，落在一个没有 codex 访问权限的 OpenAI 项目上。

`PI_AI_ERROR` 被刻意排除在每一个符合条件的集合之外，因此 `delegate_engineer` 在该部署上直接失败，其配置好的 `deepseek-official` 回退从未被触及。操作者看到的是：worktree 已置备、子智能体被拒绝、worktree 空着退役，以及一句没有点名任何路由的 `Error: subagent run failed`。

这同时了结了 [OAuth-only withholding 笔记](2026-08-13-oauth-only-providers-withheld.zh.md)中记录的一项暂缓——它把「把 `Provider is not configured` 映射成具名错误」列为值得做，并推迟为独立改动。

## 决定

`classifyPiAiError` 识别这两种措辞。第一种复用 `MISSING_CREDENTIAL`——这正是适配器自身凭据解析处已经赋予它的含义：一条解析不到凭据的路由，只是检测点不同。第二种获得一个新的规范 code，`MODEL_NOT_ENTITLED`：凭据有效、模型也在该路由的 catalog 中，但账户无权使用它。

按文本匹配是被迫的，而非首选。pi-ai 抛出 `ModelsError('auth', …)`，随后在错误到达适配器之前把它压平成 `error.message`，丢弃了 code；现存的 `XXX(pi-ai upstream)` 注释记录了这一点，并点名转发原始错误才是持久的修复。

两处检查都位于所有状态码数字测试之上。它们是最具体的措辞且不含数字，而既有的数字测试在两个方向上都是隐患：模型名或 project id 里出现以 5 开头的裸三位数字串会被判成 `SERVER`；而某个上游版本一旦开始给消息加上 HTTP 状态前缀，准入失败会被悄悄挪到 `AUTH`。两个正则都做了整词锚定，理由与拒绝 `/not configured/i`、`/no access/i` 相同——工具错误自身的文本就会命中它们。

### 为什么不是 `AUTH`

两条互相独立的理由。`packages/client/runtime/src/client/sessions/failure-display.ts` 是唯一一处为某个 code 特判显示的消费方，它会把 `AUTH` 的消息替换成固定文案「API key is invalid」——那会把人引去轮换一把本来就好用的密钥。而且 `AUTH` 不在回退集合里，委派无论如何都会死。`MODEL_NOT_ENTITLED` 在那里刻意不做特判，好让提供方自己那句准确的话抵达操作者。

### 为什么不复用 `UNKNOWN_MODEL`

它曾是首选，而且是错的：它会证伪两条已写下的不变量和一条面向用户的建议。包 README 声明路由未配置的模型会*在发起任何提供方请求前*以 `UNKNOWN_MODEL` 失败；`PRE_REQUEST_ROUTE_CODES` 自身的文档声称这样的子智能体从未触网；而 `docs/user/guide/providers.md` 让操作者把缺失的模型加进自定义提供方——当模型明明在场、缺的是账户权限时，这条建议毫无用处。新铸 code 直接沿用 `INVALID_CREDENTIAL_CODE` 的先例：它把「已提供但不可用」从「缺失」中拆出来，理由只有一条——修复方式不同。这里同样不同：申请访问权限或改选模型，而不是编辑路由。code 在 `HarnessError` 上是开放的字符串，因此不会扩宽任何联合类型，代价是文档而非类型。

### 回退集合被扩宽，以及它的代价

`MODEL_NOT_ENTITLED` 必须加入 `PRE_REQUEST_ROUTE_CODES`，否则这次分类将一无所获。该集合原本由一条可机械核验的性质定义——失败发生在任何网络 I/O 之前——而准入拒绝恰恰发生*在*第一次请求上。与其留着一条如今已不成立的声明，不如把该常量重新写成真正成立的内容：这些 code 意味着所配置的路由无法在这个部署上提供服务，它们对该路由是确定性的，在同一条路由上重启永远不会成功，并且不可能在子智能体已产出输出之后出现。

残留的缺口，直说：运行中途被撤销准入、且子智能体已调用过工具但没有产出任何助手文本时，会重复那一次工具调用。`output.length === 0` 这道守卫把它限定在恰好这一种情形，并且未被改动。

## 考虑过的替代方案

- **再加一个 `DETERMINISTIC_ROUTE_REFUSAL_CODES` 集合，用并集充当默认值。** 它保留了原集合那条可机械核验的不变量，而不是放松它。因不成比例而被否决——为一个成员单开一个常量——但记录在此，好让下一个要加进这个单一集合的 code 必须自证，而不能援引本次改动作为先例。

- **改掉 preset 的 engineer 路由。** 这是「根本不做分类」的替代路线。`openai-codex` 只服务 `gpt-5.3-codex-spark` 且需要 ChatGPT OAuth 授权，因此会在只有 API key 的部署上失败：拿一个不可用的默认值换另一个。每条厂商路由都会在某些部署上不可用，而回退正是为此而生的机制，所以 preset 保留 `openai`/`gpt-5.3-codex`。

- **把 pi-ai 的每种失败措辞都映射一遍。** 只映射在真实账户上观察到的两种，因此没有任何正则出自猜测。

- **让 `PI_AI_ERROR` 变成可重试。** [传输截断笔记](2026-07-22-pi-ai-transport-truncation-classification.zh.md)已因模糊化兜底而否决过；并且这些 code 都不该可重试：准入拒绝是账户的性质，每次尝试都会同样失败。

## 影响

没有任何一个 code 在 `DEFAULT_RETRYABLE_CODES` 中，因此本次改动影响的是诊断与回退资格，绝不触及重试行为。分类依赖提供方措辞：pi-ai 或提供方的某个版本一旦改写其中任一消息，它会悄悄退回 `PI_AI_ERROR`——仍然可诊断，但不再能让被委派的子智能体符合回退路由的条件。这一点记录在包 README 的已知限制中，而向上游转发 `ModelsError.code` 仍是持久的答案。

## 测试

`packages/llm/llm-pi-ai/tests/convert.spec.ts` 逐字钉住来自实机运行的两种措辞，外加促成这一放置位置的两条顺序守卫——点名 `gpt-500-codex` 的准入消息仍为 `MODEL_NOT_ENTITLED` 而非 `SERVER`，同一条消息加上 `403:` 前缀后仍为 `MODEL_NOT_ENTITLED` 而非 `AUTH`——以及两条负例（`tool configuration is not valid`、`no access to /etc/hosts`），用以在更宽的正则面前守住兜底。`adapter.spec.ts` 驱动真实插件访问其本地 mock server，由后者回答一个真正的 403 准入响应体，这才说明措辞挺过了 pi-ai 的压平，而不只是分类器对某个字符串判断正确。`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` 钉住新 code 配合空输出在默认集合下符合回退条件。

`examples/headless-agent/tests/headless.snapshot.ts` 以无密钥方式、通过组装后的应用钉住凭据这一半：`pi-ai-keyless.cordis.snapshot.yml` 禁用 DeepSeek 适配器，挂载一条不指定 `apiKeyEnv` 的 pi-ai 路由，并把 agent 重新指向它，因此在端点被拨通之前，pi-ai 自己的鉴权解析就会拒绝该路由。录制下来的 transcript 携带 `MISSING_CREDENTIAL`；同一组合在改动前的分类器上运行会得到 `PI_AI_ERROR`，正是这一点让该录制成为测试而非描述。

`pi-ai-entitlement.cordis.yml` 以同样方式钉住另一半。该套件本就会启动本地 HTTP 服务器并把某个组合的 `baseURL` 指向它，因此准入拒绝无需任何新的 harness 支持：服务器以 403 返回该措辞，路由携带有效凭据，transcript 记录下 `MODEL_NOT_ENTITLED`。有两个事实只有组装后的运行才能确立：pi-ai 会在压平后的消息前加上字面的状态码前缀（`403: {…}`），因此上文的顺序决定是承重的而非防御性的；以及同一场景在改动前的分类器上记录为 `AUTH`——正是那个会把操作者引去轮换一把好用密钥的结果。该拒绝恰好只消耗一次请求，这由记录下来的服务器请求计数钉住，因为该 code 不在可重试集合内。

单元测试断言的是这套映射本身，而不是映射与现实相符；两种措辞都来自针对真实 OpenAI 与 Anthropic 账户的实机运行。
