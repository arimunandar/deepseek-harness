# Agent Note: the first-run connections step is a dialog

Status: implemented

[English](2026-08-26-first-run-connections-dialog.md) | 中文

## Problem

首次运行的连接步骤把问题放在整屏接管界面上提出：一层不透明的 `--dsw-alias-bg-layer-1` 展示层盖在模糊遮罩之上，由 [步骤自有接管界面框架的 Agent Note](../bug-fix/2026-08-06-onboarding-step-owned-takeover-chrome.zh.md) 引入的 `OnboardingSurface` 原语绘制。该界面在提问期间整个替换掉产品，传达的是"你来到了一个新地方"，而不是"只差一步就能开始对话"。

两个首次运行步骤也已经彼此偏离。欢迎声明通过 `OnboardingModal`（`ui-settings-models`）已经在对话框里提问，而连接步骤仍用接管界面——同一次运行的同一个时刻出现两种呈现方式，差别仅在于由哪个插件注册了步骤。

## Decision

连接步骤改为渲染在共享的 `Modal` 里并启用 `headless`，因此应用在遮罩之后保持可见并被模糊。卡片自带表头，并在 `calc(100vh - 48px)` 处内部滚动——正是这一点让三张连接卡片和一段较长的登录会话都能放进较矮的视口，而不会让遮罩本身变成滚动容器。

隐式关闭被拒绝：`onClose` 是空操作，因此 Escape 与点击遮罩都不起作用。推迟是步骤通过 `complete()` 记录下来的决定，而 `Later` 按钮是唯一能记录它的入口——一个可以被误触关掉的问题，其答案不足以让任何东西依赖。

步骤仅在正在提问的那段窗口内保持 `#root` 为 `inert`，并且恢复的是它进入时读到的值，而不是直接清除该标志，因此设置过该标志的嵌套界面能保留自己的答案。判定阶段依旧既不绘制也不阻塞：`inert` 绑定在决定是否渲染的同一个条件上。

`OnboardingSurface` 被删除。两个首次运行步骤都已在对话框里提问后，接管原语不再有使用方；保留一条闲置的第二种引导呈现方式，只会招致两种呈现再次彼此偏离。

## Alternatives considered

**保留接管界面并重新设计其样式。** 收窄展示层、弱化背景，仍然会把应用藏在不透明层之后；真正传达"这只是一步，不是一个新地方"的是能看见遮罩之后的产品，而在不透明展示层上无论怎样调整样式都提供不了这一点。

**把 `OnboardingModal` 提升到 `ui-primitives` 并让两个步骤共用。** 这才是正确的终态，也正是连接步骤的界面框架被刻意写成它的近似副本的原因：同样的 `Modal` 加 `headless`、同样拒绝隐式关闭、同样的 inert 处理、同样的 `calc(100vh - 48px)` 内容盒。这里是推迟而非否决——该提取跨三个包，应当放进一次以提取本身为主题的改动里，而不是放进一次讨论"如何提问"的改动里。在此之前重复是真实存在的，也是未来的步骤首先应当合并掉的东西。

**让 Escape 表示推迟。** 把关闭当作推迟确实能记录决定，但这会使误按的一次键盘操作与一次真正的选择无法区分，而该步骤正是挡在新用户与一次可用对话之间的唯一一环。

## Consequences

两个首次运行步骤现在呈现一致，并且遮罩覆盖整个视口，而不像接管界面那样从产品顶栏之下开始。这没有带来损失：接管界面本来就把 `#root` 置为 `inert`，因此无论哪种方式，顶栏在提问期间都是可见但不可用的。

`ConnectionsOnboarding` 与 `OnboardingModal` 之间重复的对话框界面框架是明知而保留的。它体量小且稳定，`pnpm run duplication` 也不会标记它——这意味着未来的提取必须是主动选择的结果，而不是被某个门禁逼出来的。

## Testing

`packages/client/ui-settings-connections/tests/components.client.spec.tsx` 钉住呈现方式：dialog 角色及其 `aria-modal`／标签、Escape 与点击遮罩既不结束步骤也不调用 `complete()`、`#root` 仅在步骤提问期间为 inert 且在卸载时被恢复，以及没有 `#root` 的组合仍能渲染。

`apps/web/tests/onboarding-deepseek-config.e2e.ts` 通过 `aria-label` 定位两个首次运行对话框，这正是被删除的 `onboardingStage` 类名子串过去为该步骤所做的事；其 `missing.expected.md` 基准现在捕获的是对话框子树。来自步骤自有接管界面框架 Agent Note 的重载闪烁采样器继续针对同样这两个标签工作，因此那个缺陷仍被钉住。`apps/web/tests/navigation-panes.e2e.ts` 通过对话框标签与 `Later` 按钮关闭该步骤，`apps/web/stress-tests/reasoning-chunks.stress.ts` 则按 portal 结构（`[role="presentation"]:has([role="dialog"])`）隐藏固定件中无法关闭的声明，而不再依赖类名子串。
