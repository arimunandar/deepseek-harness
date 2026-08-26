# dsh-connections

[English](README.md) | 中文

连接目录（`ctx.connections`）。一个人能否用某个后端开始对话，是四个所有者共同决定的联接结果——[`ctx.authorization`](../authorization/README.zh.md) 上注册的登录流程、用 [`ctx.credentials`](../credentials/README.zh.md) 记录的凭据、注册在 `ctx.llm` 上的模型路由，以及 `ctx.agentDefaultModel` 持有的默认选择。每一个都正确回答自己的问题，而没有一个回答这个问题。本服务完成这次联接，把结果落到徽标能承载的四个词上，并且只暴露这些状态各自蕴含的修复动作——于是界面可以为每个后端渲染一张卡片，而不必知道凭据引用、记录作用域、设置命名空间或提供方路由的存在。

**有哪些后端是配置，不是代码。** `Config.connections` 列出它们，因为答案随部署、随组合了哪些适配器而变化。随附的 bundle 列出它们自带的三个；另一种组合列出自己的。

## 四种状态

| 状态 | 产生它的联接 | 修复动作 |
|---|---|---|
| `connected` | 已存凭据**且**有路由读取它 | 无 |
| `setup-required` | 已存凭据，没有路由 | `finishSetup()` 写入路由 |
| `needs-attention` | 路由已注册，凭据缺失或来自只读来源 | 重新登录，或修改启动环境 |
| `not-connected` | 什么都没存 | `connect()` |

`attention` 说明状态具体指哪一种，界面据此选择文案，不必重新推导联接。`credential-read-only` 是本包唯一拒绝尝试的修复：启动环境里的值遮蔽了可写层，凭据接缝会拒绝写入，而不是让解析继续返回被遮蔽的值——报告成功就是撒谎。

## 接口

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connections'

declare const ctx: Context

await ctx.connections.list()                       // ConnectionView[] — never a credential value
await ctx.connections.connect('claude', 'oauth')   // resolves when the sign-in settles
ctx.connections.answer('claude', '3', 'ABC-123')   // answers the question that attempt asked
ctx.connections.cancel('claude')                   // withdraws it, here or in the tab that started it
await ctx.connections.finishSetup('claude')        // the setup-required repair; idempotent
await ctx.connections.activate('claude')           // new conversations start here
await ctx.connections.disconnect('claude')         // forgets what is stored; never revokes
```

每个方法都是 Typert `@Remote`，因此一份实现同时服务进程内的终端调用方和经由 Gateway 的浏览器。

## 对话走事件，而不是第二条 wire 象限

`connect()` 在尝试结束时 resolve——人在浏览器里花多久就是多久。运行期间，流程的通知与提问会作为 `connections/notice` 与 `connections/prompt` 抵达每个正在观察的界面，而答案通过普通的一元 `answer()` 返回，而不是通过那个仍然打开的调用。于是一次登录不需要服务端发起的请求象限、不需要载体里的待答表、也不需要特殊客户端：观察同一个连接的第二个标签页看到同一场对话，并且可以回答它。

`promptId` 是让迟到的答案变安全的东西。已被取代的问题会被拒绝，而不是被套用到它的后继上——这正是"你的验证码过期了，这是新的"与一个验证码悄悄回答了错误问题之间的差别。

`connections/changed` 不携带载荷。联接跨越四个所有者，没有任何单个所有者的增量能描述最终状态，所以每个消费者都重新读取整个目录。服务订阅 `credentials/reference-updated`、`credentials/record-updated`、`llm/adapters-updated` 和 `authorization/settled`，把这四者折叠为那一个信号。

## 不读取其他产品的文件

`vendorCliInstalled` 回答厂商自己的命令行工具是否在 `PATH` 上，它的存在只为一句文案——"你已经在用它了"。这里不打开、不解析、也不复制那个工具存储中的任何凭据。那些格式没有兼容性承诺，而签发给某一个客户端的订阅令牌，不是本应用可以拿来复用的东西。已经装了厂商工具的人在这里用同一个账号登录，一次点击，产出一份属于本应用的授权。探测从不执行该命令，因此一个存在但已损坏、或者一启动就要求输入的厂商工具，不可能影响一个配置页面。

## 失败只呈现一行，且有上限

流程自己的措辞是失败信息里有用的那一半，但提供方库可以往 `Error.message` 里塞任何东西——pi-ai 的 OAuth 兑换就在里面嵌了一条带绝对文件系统路径的 `stack=` 链——而这个字符串会被逐字渲染在一个以"把这类东西挡在屏幕之外"为目的的页面上。因此 `connect()` 会在第一个 `stack=`/`details=` 标记处截断，只保留首行，并限制在 200 个字符以内。截完之后什么可读内容都不剩的消息，会变成一句"登录没有完成"的平实陈述。

这是一条可读性上限，不是脱敏保证：如果提供方把机密放在消息的第一个子句里，它仍会露出来，而这不是任何消费端规则能够阻止的。

## 登录成功会写入路由

一份没有任何路由读取的已存凭据，不是任何人能用的连接；为此让人再按一个按钮，等于在问他们管道的事。所以 `connect()` 在尝试获得授权后紧接着写入路由，路由已存在时跳过——重新登录绝不覆盖别人调好的 profile。没有设置提供方的部署在 `cordis.yml` 里组合自己的路由，本包在那里无从写起，路由就是那份文档所说的样子。

它创建的路由带上这个连接自己的名字。路由键是适配器的词汇——`anthropic`、`openai-codex`——而当 profile 没有另行命名时，配置界面显示的就是它；否则以"Claude"完成连接的人，在模型页上还得认出它其实是"anthropic"。缺少该名字的既有路由会在下一次 `connect()` 或 `finishSetup()` 时补上；已经带名字的路由则保持不变，因为文档里的名字是某个人选的，而产品标签输给刻意的覆盖。

## Model Experience

Indirectly, through the backend a person connects here, which owns every model-visible surface once it is selected.

#### KV Cache effect

No direct effect; credentials and connection state never enter a request prefix.

## Known Limitations and Deferred Work

- **一次登录只活在发起它的进程里** —— 授权接缝没有为尝试准备存储，所以登录中途刷新页面就会放弃它，人得从头再来。界面必须如实说明，而不是暗示尝试还在。
- **没有任何东西会吊销** —— `disconnect()` 就是 `deleteRecord`/`unset`，本地忘记凭据而不通知签发方。需要服务端吊销的提供方目前没有地方声明它。
- **`activate()` 每个连接只指定一个模型** —— `defaultModel` 是配置常量，所以旗舰模型变化的后端需要改配置。逐次对话的答案仍然是编辑器里的模型选择器。
- **路由写入只覆盖 `providers.<route>`** —— 适配器需要的东西超出该路径下一个 profile 的连接属于组合，不是本包能创建的。
- **探测是一次 `PATH` 查找** —— 装在 `PATH` 之外、或只能通过 shell 别名或函数触达的厂商工具会被读作不存在。后果是少一句文案，绝不会是错误的状态。
