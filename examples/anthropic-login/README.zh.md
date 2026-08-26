# anthropic-login

[English](README.md) | 中文

在启动时为随附 OAuth 登录的 pi-ai 目录提供方完成登录——默认是 Anthropic 的“Claude Pro/Max”订阅流程。

[`@deepseek-ai/dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.zh.md) 为每个已安装的目录提供方注册了一条授权流程，流程本身负责协议交互与凭据写入。这份覆盖层在启动时调用其中一条，而不是从页面或命令发起——把一个终端交互交给 `ctx.authorization.begin()`，供必须启动即已登录的 profile 使用。

## 如果你手工加过 `authorization` 行

本页早先的版本让你插入一行 `- id: authorization`，因为当时没有任何 bundle 挂载这条接缝。现在 base bundle 会挂载它，所以留在 `$DSH_HOME/cordis.patch.yml` 或某个 profile 自己的 patch 层里的那份副本就成了**重复的 loader entry id**，每个 profile 都会启动失败：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): duplicate loader entry id: authorization
```

删掉那一行即可。它下面的 `anthropic-login` 行照常工作。

## 运行

patch 文件只贡献配置，并不改变 loader 解析模块路径的目录，而 `name` 是逐字导入的——没有表达式转义。因此覆盖层里的相对路径是相对所启动 profile 的目录解析的，插件要先放到那里：

```sh
cp examples/anthropic-login/anthropic-login.mjs "${DSH_HOME:-$HOME/.dsh}/profiles/web/"
dsh web --patch ./examples/anthropic-login/cordis.yml
```

其他 profile 同样是这两步，只是针对各自的目录。写绝对路径的 `name` 也可行且无需复制，代价是把覆盖层钉死在某个检出目录上。

登录需要终端：请在交互式 shell 中启动该 profile，因为流程会告知去哪里授权并询问返回的结果。通知与提问一律写入 stderr，以保持协议 stdout 干净。

凭据一旦存在，插件便不再介入——它报告已存储的记录后什么都不做，因为此后由 pi-ai 负责刷新。若仍要重新登录，在 [`cordis.yml`](cordis.yml) 中设置 `force: true`。

## 挂载了什么

| 行 | 原因 |
|---|---|
| `anthropic-login` | 调用方。解析 `<scope>/<provider>`（`llm-pi-ai/anthropic`），等待 pi-ai 注册该流程，然后运行指定的方法。 |

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `scope` | `llm-pi-ai` | 凭据键的作用域，即 pi-ai 的 `RECORD_SCOPE`。 |
| `provider` | `anthropic` | pi-ai 目录提供方 id，同时也是凭据记录 id。 |
| `method` | `oauth` | `oauth` 是订阅登录；`api-key` 则是输入密钥。 |
| `force` | `false` | 即使已存储凭据也重新登录。 |
| `waitMs` | `15000` | 等待流程被注册的时长。 |
| `pollMs` | `250` | 查看的间隔。 |

## 失败被收敛

无法完成的登录不得拖垮启动：树中其他能力仍然可用，下一次启动可以重试。两条纪律支撑这个承诺。

尝试是脱钩的，因为 `apply` 运行在启动序列内——在那里等待一次浏览器往返会把整棵树挂住，而它等的人在被引导去的界面起来之前根本无法作答。既然没有任何地方 await 这次尝试，它的 rejection 就会成为未处理的 rejection，而 `installFailLoud` 视其为致命；因此插件自己报告这一兜底情况并将其吞掉。

轮询循环在触碰服务之前先检查撤回，并通过 `ctx.get('authorization')` 而非 `ctx.authorization` 读取服务。一旦 fiber 离开 `ACTIVE`，注入式取值器会抛出 `cannot get required service "authorization" in inactive context`，而这个循环在启动拆除时仍可能在轮询、活得比树更久——可选取值器在那里返回 `undefined`。
