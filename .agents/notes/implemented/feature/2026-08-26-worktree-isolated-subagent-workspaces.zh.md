# Agent Note：隔离是子 Agent 的会话 cwd，不是它提示词里的一条规则

Status: implemented

[English](2026-08-26-worktree-isolated-subagent-workspaces.md) | 中文

## 问题

并发的进程内子 Agent 共享同一个工作区。`childSessionMeta` 把父级头部的 `cwd` 复制给每一个子 Agent，于是从一个父级启动的两个子 Agent 会写同一批文件，而 `dsh-tool-subagent` 的 README 把后果写得很直白：*"协调同辈的工作区效应属于模型。"*

这不是提示词能解决的协调问题。两个 Agent 会不会互相踩掉，取决于它们各自动到哪些文件，而这在动之前谁都预测不了；等任何一方察觉时，输的那一方的工作已经没了。[team preset](2026-08-26-team-agent-preset-role-bound-routes.zh.md) 通过只允许一个角色写来绕开它，那是对一个团队能做什么的真实约束，不是修复。

## 决策

`dsh-subagent-worktree-in-process` 注册一个 `worktree` provider：就是 spawn provider，只改了子 Agent 的工作区。`start()` 把分派会话的 cwd 解析到它的仓库根，读取该仓库的 `HEAD`，在该提交上以新分支 `dsh/subagent/<uuid>` 添加 worktree，并把该路径作为子 Agent 的会话 cwd 交给共享 driver。

会话 cwd 就是全部机制。`ctx.sandboxPolicy` 本来就从 `session.header.cwd` 推导它的 `workspace-write` 边界，而文件系统工具与 shell 也按同一份每次调用的策略解析——于是隔离出自一个持久的会话事实，而不是出自任何要求子 Agent 去遵守的东西。driver 的改动因此很小：`InProcessRunOptions` 新增一个 `cwd`，仅对该子 Agent 遮蔽其继承来的父级 cwd。

拆除会保住工作。释放会先释放子 Agent，然后仅在 worktree 为空时退役它：`git status --porcelain` 无输出，且相对基线提交没有新增提交。否则 worktree 被保留，且 Host 日志点名其路径与分支。一次无法产出结果的 `git status` 也算作有工作，因为拒绝移除一个状态未知的目录是唯一安全的方向。

`prepareContinuable` 缺席，这正是一个 provider 拒绝该路径的方式——它的存在本身就是延续管理器用来收窄类型的那项能力。continuable 子 Agent 由该管理器组装，其寿命超过本 provider 包装的任何 run，包括在后续进程中的冷恢复，因此这里没有任何东西能拥有其 worktree 的移除责任。

`root` 没有默认值。worktree 该放在仓库旁边、另一个卷上，还是某个排除备份的路径下，是部署方的选择；`dsh-base` bundle 在 harness home 下指定一个，部署方在那里覆盖它。相对值会让挂载失败，而不是相对宿主恰好从哪个目录启动去解析。

## 考虑过的替代方案

**在 spawn provider 上加一个 `workspace` 选项。** 文件更少，而且这确实只值一个选项的行为量。被否决是因为 `subagent-fork-in-process` 就是先例：它同样只以传给共享 driver 的一个参数区别于 spawn，却仍然是自己的 provider。把这个维度留在注册名里，意味着 preset 通过点名一个 provider 来选择隔离，而两个角色可以在不引入第二套配置方言的情况下各不相同。

**复制父级目录而不是开分支。** 那会把父级未提交的工作给到子 Agent，而这正是关于进行中工作的任务想要的。被否决是因为结果会是一个没有身份的目录——没有东西可 merge、没有东西可评审，也没有便宜的办法看出子 Agent 改了什么。分支同时回答这三点，代价是这类任务必须把工作写进 prompt。

**经由 `SubagentResult` 上报分支。** 父级需要知道工作落在哪里，而一个结果字段能在不依赖子 Agent 的前提下说出来。这是推迟而非否决：`SubagentResult.diagnostic` 是失败通道，而为一个 provider 的便利给 seam 增加一个成功路径字段，是对 Service Definition 的改动，其他每个 provider 都得为它赋予某种含义。今天，子 Agent 自己的报告就是面向父级的通道。

**在后续启动时回收被保留的 worktree。** 很诱人，而且错在与自动移除相同的地方：被保留的那些恰恰是持有着还没人看过的工作的那些。

## 后果

`team` preset 的 `delegate_engineer` 现在使用 `provider: worktree`，于是唯一会写的那个角色触不到 lead 的文件；它是 `one-shot`，因为 worktree 子 Agent 不能是 continuable。它的成果落在一个分支上，这改变了 lead 拿它做什么：读报告，然后 merge 或评审该分支。

`ctx.subagents` 多了第四个进程内 provider 名，且 `dsh-base` 会挂载它，因此任何基于该 bundle 的部署都可以把一个分派工具指向 `worktree`，无需另装任何东西。

被保留的 worktree 会在所配置的 `root` 下堆积。按设计没有任何东西回收它们，因此大量分派的部署应当预期该目录会一直增长，直到有人评审那些分支。

## 测试

`packages/subagent/subagent-worktree-in-process/tests/subagent-worktree-in-process.spec.ts` 用真实 git 驱动真实后端——每个用例一个临时仓库、真实的本地 subprocess provider、真实的循环、一个脚本化模型。没有任何东西 stub git，因为本包所拥有的恰恰就是那串 git 调用及其所喂养的决策。它钉住：子 Agent 的会话 cwd 位于所配置的 root 之内、且是父级 HEAD 的检出；干净时被移除；有未提交改动时被保留；有提交但状态干净时被保留——这正是只有基线提交计数才能区分的那种情形；没有仓库、以及完全没有 cwd 时的拒绝；启动被中止时不留下任何 worktree；continuable 路径被拒绝；以及 fiber 释放时 provider 被撤回。

`tests/loader-composition.e2e.ts` 经由真实 Loader、以一份仅用于测试的 `cordis.yml` 启动 headless 应用，并把隔离出的 cwd 预备成一个真实仓库。它断言的是持久化子 Agent 会话头部的 `cwd`，不是模型文本：工作区决策在会话日志里是持久的，而一个 mock 的回答只会复述别人让它说的话。
