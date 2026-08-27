# @deepseek-ai/dsh-subagent-worktree-in-process

[English](README.md) | 中文

worktree provider 在当前进程中创建一个全新的子 `Agent`，并给它一个属于自己的 git worktree。它就是[spawn provider](../subagent-spawn-in-process/README.zh.md)，只改了一件事——子 Agent 的工作区——于是同时干活的两个子 Agent 不可能写同一个文件。

## 工作区边界

`start(request)` 把分派会话的 cwd 解析到它的仓库根，读取该仓库的 `HEAD`，然后在该提交上以一个新分支添加 worktree。子 Agent 的会话头部携带这个 worktree 路径，而会话 cwd 正是每个执行性能力所读取的东西：[`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/README.zh.md) 以它作为 `workspace-write` 边界，文件系统工具以它解析相对路径，shell 也从它启动。

因此隔离的强度等于会话权限模式的强度，不会更强。在 `workspace-write` 下边界是被强制的：拿到自己 worktree 之外绝对路径的子 Agent 会被拒绝。在 bypass 模式下不存在边界，于是一个被告知了另一个目录路径的子 Agent——最可能是它自己的分派方告知的——可以 `cd` 过去并写入。worktree 仍然决定子 Agent 从哪里*开始*、它的相对工作落在哪里；它不约束一个其部署已经关掉约束的子 Agent。

在 `HEAD` 上开分支（而不是复制父级目录）带来两个后果。子 Agent **看不到**父级未提交的工作，所以依赖那些内容的任务必须把它们写进 prompt。子 Agent 的成果落在一个分支上，而不是父级的工作树里，所以想要这份工作的调用方需要 merge 或 cherry-pick。

分支与目录都以一个按子 Agent 分配的 UUID 命名（`dsh/subagent/<id>`），这既是并发子 Agent 互不冲突的原因，也是事后识别一个被保留 worktree 的依据。

## 拆除会保住工作

释放 run 会先释放子 Agent——在 git 触碰该目录之前先达到静默——然后再退役 worktree。只有在 worktree **为空**时，退役才会移除它并删除其分支：`git status --porcelain` 什么都没报告，并且相对分支创建时那个提交没有新增任何提交。否则 worktree 会被保留，且 Host 日志会写出它的路径与分支。

一次无法产出结果的 `git status` 也算作有工作。拒绝移除一个状态未知的目录是唯一安全的方向，所以读不出状态的 worktree 会被保留而不是删除。

在完成配置之后失败的启动会移除 worktree——里面什么都没跑过，因此不会丢任何东西——而且这次移除绝不会取代调用方真正需要的那个启动失败。

## 能力与 continuable 路径

worktree 声明 `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }`，与 spawn 相同的四项：它构造子 Agent，所以能强制全部四项。工作区隔离不在其中，因为它没有改变任何调用方可以请求或被拒绝的请求字段。

`prepareContinuable` 被刻意**省略**，这正是一个 provider 拒绝 continuable 路径的方式——它的存在本身就是延续管理器用来收窄类型的那项能力。continuable 子 Agent 由该管理器组装，其寿命超过本 provider 所包装的任何 run，包括在后续进程中的冷恢复，因此这里没有任何东西能拥有其 worktree 的移除责任。一个拆除无人负责的 worktree，比不做隔离更糟。

## 依赖与拒绝

`ctx.subprocess` 是必需注入，而不是可选读取：没有它就无法配置任何 worktree，而一个仍然注册的 provider 会接受它无法服务的分派。每次 git 调用都经由该 seam，输出有界收集；本包自己不 spawn 任何进程。

三种拒绝都是显式的。没有 cwd 的分派会话没有可供开分支的东西。位于 git 工作树之外的 cwd 以 `WorktreeError('NOT_A_REPOSITORY')` 失败并点名该目录。没有任何提交的仓库，或被 git 拒绝的 `git worktree add`，以 `WorktreeError('GIT_FAILED')` 失败并点名分支与路径。

## 配置

| 键 | 含义 |
|---|---|
| `providerName` | `ctx.subagents` 上的注册名（默认 `worktree`）。 |
| `root`（必填） | 每个子 Agent 的 worktree 所创建于的绝对目录。没有默认值：worktree 该放在仓库旁边、另一个卷上，还是某个排除备份的路径下，是部署方的选择。相对值会让挂载失败。 |
| `gitGraceMs` | 每次 git 调用的 SIGTERM 到 SIGKILL 宽限期，默认 5000。 |

## Model Experience

### 子 Agent 的工作区

#### 模型看到什么

全新的子 Agent 逐字收到独立自包含的任务内容，并在未被覆盖时继承父级模型，这与 spawn 完全一致。不同之处在于其运行时上下文中声明的工作区：是 worktree 路径，而不是父级的目录。列目录、读文件或写文件的子 Agent 看到的是它自己的检出，其 `workspace-write` 拒绝也点名该路径。

#### Token 影响

与 spawn 相同：一份独立的新上下文与历史，不重复任何父级历史的 token。运行时上下文中的工作区那一行只在路径长度上有差别。

#### KV Cache 影响

与父级请求缓存无关。工作区路径属于子 Agent 运行时上下文的一部分，所以每个子 Agent 建立自己的前缀——同一父级的两个子 Agent 从不共享同一个。

### 父级的工具结果（间接）

#### 模型看到什么

经由 [`dsh-tool-subagent`](../tool-subagent/README.zh.md)，父级只收到子 Agent 的最终输出或停止原因错误。worktree 路径与分支不属于该结果：子 Agent 自己的报告才是面向父级、说明它做了什么以及落在哪里的通道。

#### Token 影响

父级输入增加一份依赖数据的结果，保留至压缩为止。

#### KV Cache 影响

仅追加；新可见内容位于可复用的请求前缀之后，不会使已有 KV 缓存条目失效。

## Known Limitations and Deferred Work

- **分支不经由 seam 上报** —— 被保留的 worktree 会在 Host 日志中被点名，也可用 `git worktree list` 发现，但没有任何结果字段携带它，所以必须 merge 这份工作的父级只能依赖子 Agent 自己说清它落在哪里。
- **被保留的 worktree 会堆积** —— 这里没有任何东西去回收一个曾持有工作的 worktree。由评审或 merge 该分支的人来移除它；大量分派的部署应当预期所配置的 `root` 会增长。
- **仅支持 one-shot** —— 出于上文的归属原因，continuable 子 Agent 无法获得 worktree 隔离。同时需要隔离与 continuable 对话的角色，今天没有可用的组合。
- **bypass 权限模式会击穿它** —— worktree 就是会话 cwd，而让一个 cwd 成为边界的是沙箱策略。已验证：在 `Full access` 下，一个子 Agent 在任务里被告知了分派方工作区的绝对路径，通过 `bash` 执行 `cd <path> && …` 并写入了那里。想要隔离被强制的部署，应让其分派会话运行在 `workspace-write` 下。
- **父级未提交的工作不可见** —— 在 `HEAD` 上开分支正是配置得以廉价、子 Agent 的基线得以可复现的原因，但关于进行中工作的任务必须把它写进 prompt。
