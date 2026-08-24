# anthropic-login

[English](README.md) | 中文

在启动时为随附 OAuth 登录的 pi-ai 目录提供方完成登录——默认是 Anthropic 的“Claude Pro/Max”订阅流程。

[`@deepseek-ai/dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.zh.md) 已经为每个已安装的目录提供方注册了一条授权流程，流程本身负责协议交互与凭据写入。缺的是*调用方*：Web 界面的模型页只能编辑 api-key 凭据，CLI 也没有 `login` 命令。这份覆盖层就是那个缺失的调用方——在启动过程中把一个终端交互交给 `ctx.authorization.begin()`。

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
| `authorization` | `ctx.authorization` 是负责登录会话的接缝。没有任何随附 bundle 挂载它，而 pi-ai 是在 `ctx.inject(['authorization'], …)` 内注册登录流程的，因此缺了这一行，那些流程根本不会存在。 |
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
