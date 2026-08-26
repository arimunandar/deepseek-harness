# Agent Note: connect-your-AI directory

Status: implemented

[English](2026-08-26-connect-your-ai-directory.md) | 中文

## Problem

没有人能登录任何东西。

`@deepseek-ai/dsh-llm-pi-ai` 会为每个随附登录的已安装目录提供方注册一条授权流程——Anthropic 的 Claude Pro/Max 订阅、ChatGPT 的 Codex，以及其余各家——但它是在 `ctx.inject(['authorization'], …)` 里注册的。没有任何随附 bundle 挂载 `ctx.authorization`，所以在任何一个人真正能运行的组合里，那些流程从来没有注册过。接缝在，流程也在，而唯一的调用方是一个必须自己插入接缝行的示例覆盖层。

即便能登录，"这个后端我现在能用了吗"也没有归属。这个问题的答案是四个服务的联接结果，而每个服务都在正确回答另一个问题：`ctx.authorization` 上的流程、`ctx.credentials` 里的凭据、`ctx.llm` 上已注册的路由，以及 `ctx.agentDefaultModel` 持有的默认选择。模型页做的是这个联接的一个更窄的版本，并且把它渲染成提供方 profile——API 密钥字段、端点、模型目录，以及一个同时充当设置键的路由 id。那个页面适合调优部署的人，不适合只想用 Claude 的人。

## Decision

`@deepseek-ai/dsh-authorization` 挂进 base bundle，于是每个组合了 pi-ai 的 profile 都有它的登录流程。

新增的 `@deepseek-ai/dsh-connections` 拥有这次联接，并把它发布为 `ctx.connections`：`list`、`connect`、`answer`、`cancel`、`finishSetup`、`activate`、`disconnect`。每个方法都是 Typert `@Remote`，因此一份实现同时服务进程内调用方与经由 Gateway 的浏览器，无需手写任何 wire schema。

联接产出徽标能承载的四个词，每个词恰好指明一个修复动作：

| 状态 | 联接 | 修复动作 |
|---|---|---|
| `connected` | 已存凭据**且**有路由读取它 | 无 |
| `setup-required` | 已存凭据，没有路由 | `finishSetup()` 写入路由 |
| `needs-attention` | 路由已注册，凭据缺失或只读 | 重新登录，或修改启动环境 |
| `not-connected` | 什么都没存 | `connect()` |

有哪些后端是 `Config.connections`，不是代码。base bundle 列出 Claude、Codex 和 DeepSeek；另一种组合列出自己的，而 Web e2e 场景列出它自己的两个，这样开发者机器上真实存在的 `DEEPSEEK_API_KEY` 就无法改变页面所说的内容。

`@deepseek-ai/dsh-client-ui-settings-connections` 把每个条目渲染成一张卡片，注册到 `settings.section`，order 为 5——排在模型页前面，因为连接账号才是人一进来就带着的问题，而编辑提供方 profile 是他们后来才走到的问题。它不贡献 `settings.onboarding` 步骤；原因见下。

### 对话走事件，而不是第二条 wire 象限

流程要跟人说话：先通知，再提问。显而易见的接法是一个可应答的服务端发起请求，而载体已经为审批和提问准备了这套机制——待答表、`/api/respond` 路由，以及按方法静态区分的"可应答/纯推送"二分。

这里改成：`connect()` 保持为一次长驻的一元调用，在尝试结束时 resolve；通知与提问作为普通的转发事件（`connections/notice`、`connections/prompt`）发出；答案通过另一个一元的 `answer()` 返回。载体没有增加任何东西：没有新象限、没有待答表、没有新路由。观察同一个连接的第二个标签页看到同一场对话，并且可以回答它——因为这条传输是一次广播，而不是与某一个调用方的通信。

`promptId` 是让这件事安全的东西。一个指向已不再打开的问题的答案会被拒绝，而不是被套用到它的后继上——这正是"你的验证码过期了，这是新的"与一个验证码悄悄回答了另一个问题之间的差别。

`connections/changed` 不携带载荷。联接跨越四个所有者，没有任何单个所有者的增量能描述最终状态，所以服务把 `credentials/reference-updated`、`credentials/record-updated`、`llm/adapters-updated` 和 `authorization/settled` 折叠成一个信号，而每个消费者重新读取整个目录。

### 登录成功会写入路由

一份没有任何路由读取的已存凭据，不是任何人能用的连接；为此让人再按一个按钮，等于在问他们管道的事。因此 `connect()` 在尝试获得授权之后紧接着写入路由，路由已存在时跳过，这样重新登录绝不覆盖别人调好的 profile。

对于适配器自己注册路由的连接（`llm-deepseek`），`routePath` 是空而不是缺省。设置路径语法把空路径读作 section **根**，写在那里会用本包的 profile 替换掉整个命名空间文档；因此本包绝不能写的那一个地址，正是它用来表示"什么都不写"的那一个。单元测试固定了这一点，而且正是它抓到了缺陷：schemastery 会把缺省的数组物化成 `[]`，于是 `=== undefined` 的判断从来不成立，DeepSeek 条目把 `{}` 写到了它整个 section 上。

### 失败只呈现一行，且有上限

提供方库拥有自己的 `Error.message`，而 pi-ai 的 OAuth 兑换往里面塞了一条带绝对文件系统路径的 `stack=` 链。逐字渲染出来，那就是在唯一一个为"把这类东西挡在屏幕之外"而建的页面上倾倒日志——而这正是第一次浏览器实测所呈现的。因此 `connect()` 只保留首行中第一个 `stack=`/`details=` 标记之前的部分，限制在 200 个字符以内，并在什么都不剩时给出一句平实的陈述。这是一条可读性上限，不是脱敏：如果提供方把机密放在第一个子句里，它仍会露出来，而这不是任何消费端规则能够阻止的。

它创建的路由带上这个连接自己的名字，而缺少名字的既有路由会在下一次尝试时补上。路由键是适配器的词汇，也是 profile 未另行命名时配置界面所显示的东西——否则以"Claude"完成连接的人，在模型页上遇到的会是"anthropic"，而无从知道两者是同一样东西。已经带名字的路由保持不变：文档里的名字是某个人选的，而这正是产品标签与刻意覆盖相撞的那一个字段。

### 探测读 `PATH`，绝不读其他产品的凭据

`vendorCliInstalled` 回答 `claude` 或 `codex` 是否在 `PATH` 上，它的存在只为一句文案——"你已经在用它了"。这里不打开、不解析、也不复制那些工具存储中的任何凭据。探测也从不执行该命令，因此一个存在但已损坏、或者一启动就要求输入的厂商工具，不可能影响一个配置页面。

## Alternatives considered

**从厂商自己的凭据文件里把已有登录取出来。** Claude Code 存着一份 Claude Pro/Max 授权，Codex 存着一份 ChatGPT 的；读取它们会让已经装了那些工具的人"连接"变成瞬间完成。基于两条各自独立的理由否决。那些文件格式没有兼容性承诺，所以任一厂商一发布变更，这个功能就会静默损坏，而故障看起来像凭据问题而不是解析问题。并且，签发给某一个客户端的订阅令牌不是本应用可以拿来复用的——不论那些字节是怎么拿到的，在这里使用它都超出了那些订阅的条款。用同一个账号重新登录只花一次点击，产出的授权属于本应用。探测留下了；提取没有。

**把连接流程放进模型页。** 它已经联接了提供方、设置和凭据，也已经拥有一个首次运行的凭据步骤。否决，因为这两个界面在为不同的人回答不同的问题。模型页是一个提供方 profile 编辑器——路由 id、端点、协议、模型目录——而其中每一样都是本页面存在的意义所要挡在屏幕之外的概念。在一个页面里做模式切换，会让技术那一半可以被误触到；而那个页面已经是仓库里最大的客户端插件。

**把整件事建模成 wire 上一层薄薄的 `ctx.authorization` 镜像，联接放在浏览器里做。** 否决，因为四个输入里有三个只在宿主端（`ctx.llm` 的已注册路由、设置文档，以及 `PATH`），浏览器每次渲染要多发三次 wire 读取，而且会算出与终端调用方不同的答案。联接属于它的输入所在之处；BFF 不持有其他领域的知识，所以它落在自己的插件里，而不是 `apiproxy` 里。

**用可应答的服务端请求承载提问。** 载体已有的审批/提问机制本来能用。否决，因为那会为一场并非会话作用域的对话，在一个 157 KB 的文件里再加一张待答表；而事件路径让第二个标签页免费获得同一场对话。

**它自己的首次运行接管界面。** 做出来了，落地前又移除了。`settings.onboarding` 已经有占用者——官方 DeepSeek 凭据步骤——把它注册在前面，会让推迟了第一个的人把首次运行走成两层接管；现有的 `onboarding-deepseek-config` 与 `onboarding-usable-provider` 场景立刻抓到了这一点：这个步骤抢在凭据对话框前面，并且在其中一个场景断言"不绘制接管界面"的那次重载里，把应用根节点保持为 inert。那些失败是设计问题，不是测试问题：哪个步骤拥有首次运行，是关于那条流程的决定，而把它折进一个页面，正是首次运行被意外重新设计的方式。在那个决定被慎重做出之前，这个页面通过设置页抵达；代价被记录为限制而不是被藏起来——没有凭据的人依然遇到的是更窄的 DeepSeek 问题，要走到 Claude 或 Codex 得先找到设置页。

**在同一次变更里做 `dsh login` 命令。** 推迟，而非否决。启动器的各个模式启动的是一个具名 profile，而随附一个 `login` profile 是关于安装时如何搭建 profile 的决定——比这个功能自己该做的决定更大。`examples/anthropic-login` 仍然覆盖终端场景，而且它在这里变小了：它过去要插入的接缝行现在来自 base bundle。

## Testing

两个包的单元覆盖率都是逐文件 100%：跨两个键空间的四状态真值表、包含被拒绝的过期 `promptId` 的对话、被拒绝与失败的两种结束、幂等的路由写入、无设置提供方的路径，以及包含 Windows `PATHEXT` 规则的 `PATH` 探测（纯函数，因此在 macOS 与 Linux 上都能跑）。

`apps/web/tests/connections-settings.e2e.ts` 在浏览器里、针对一棵真实启动的树、零模型调用地驱动真实页面：只有存在流程的地方才提供"连接"、通过接缝写入的凭据把打开着的页面收敛到 `setup-required`、"完成设置"写入路由并把卡片翻到已连接、激活手势落到 `agent-default-model`，以及指名确认框在取消时保留凭据。它会先把随附的首次运行步骤走完才抵达设置页，这正是今天一个人要做的事。

组合本身固定在 `packages/bundle/base/tests/base.spec.ts`：挂载 `llm-pi-ai` 却不挂载 `authorization` 接缝，组合出的是一棵任何提供方都永远无法登录的树，而运行时不会报告这一点——那些流程只是从来没有注册。

## Consequences

设置页现在有了一个页面，用产品术语列出三个后端、每个一个按钮，而人在那里读到的词汇从不包含凭据、引用、记录、路由、提供方或命名空间。首次运行仍然属于更窄的 DeepSeek 步骤，所以这个页面是他们找到的东西，而不是他们撞见的东西。

代价是第五个知道后端存在的地方。`Config.connections` 重述了每个后端的路由键、默认模型、设置地址和凭据地址，而这些适配器和它的设置 schema 都已经用自己的词汇知道了。没有任何一方是从另一方推导出来的，因此往随附 bundle 里加一个后端是两个文件的配置改动，而适配器里被改名的路由会让一个连接条目指向不存在的东西，直到有人发现。

把接缝挂进 base bundle，会与任何已经插入过它的用户层相撞。所有照 `anthropic-login` 示例早先说明操作过的人，`$DSH_HOME/cordis.patch.yml` 里都有一行 `- id: authorization`，而他们的每个 profile 现在都会以 `duplicate loader entry id: authorization` 启动失败。预发布立场选择硬失败而不是兼容垫片，所以删除那一行的说明写在示例的 README 里；没有任何东西会检测这次相撞并自动改写它。

有两条限制是继承来的，不是引入的。一次授权尝试只活在发起它的进程里，所以登录途中刷新就会放弃它，卡片只能给出提示。以及 `disconnect()` 只在本地忘记，不通知签发方，因为这里没有任何接缝有地方声明吊销。

## Related

- [capability seams](../architecture/2026-06-13-capability-seams.zh.md) —— 本服务刻意不主张的 Service Definition / Provider / Consumer 三分：它是一个跨四条接缝、产品形状的联接，只有一份实现。
- [web config plane](../architecture/2026-07-30-web-config-plane.zh.md) —— 本页面存在的意义就是不去沾它那套词汇的模型页。
