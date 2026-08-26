# Agent Note: the first-run connections step is a dialog

Status: implemented

English | [中文](2026-08-26-first-run-connections-dialog.zh.md)

## Problem

The first-run connections step asked its question on a full-viewport takeover: an opaque `--dsw-alias-bg-layer-1` stage over a blur mask, painted by the `OnboardingSurface` primitive that [the step-owned chrome Agent Note](../bug-fix/2026-08-06-onboarding-step-owned-takeover-chrome.md) introduced. That surface replaced the product for the duration of the question, which said the person had arrived somewhere new rather than that one thing stood between them and a conversation.

The two first-run steps had also drifted apart. The welcome notice already asked inside a dialog through `OnboardingModal` (`ui-settings-models`), while the connections step used the takeover — two presentations for the same moment in the same run, differing only by which plugin registered the step.

## Decision

The connections step renders in the shared `Modal` with `headless`, so the app stays visible and blurred behind the mask. The card owns its own header and scrolls internally at `calc(100vh - 48px)`, which is what lets three connection cards and a long sign-in conversation both fit a short viewport without the mask becoming a scroller.

Implicit dismissal is refused: `onClose` is a no-op, so Escape and a mask click do nothing. Deferring is a decision the step records through `complete()`, and the `Later` button is the only thing that records it — a question that can be escaped by accident is a question whose answer nothing can rely on.

The step holds `#root` inert for exactly the window in which it is asking, restoring the value it found rather than clearing the flag, so a nested surface that set it keeps its own answer. Deciding still paints nothing and blocks nothing: `inert` is bound to the same condition that decides whether to render at all.

`OnboardingSurface` is deleted. With both first-run steps now asking inside dialogs, the takeover primitive had no consumer, and keeping an unused second way to present onboarding invites the two presentations to drift apart again.

## Alternatives considered

**Keep the takeover and restyle it.** Narrowing the stage and softening the background would have kept the app hidden behind an opaque layer; the thing that reads as "one step, not a new place" is seeing the product behind the mask, which no amount of restyling on an opaque stage provides.

**Promote `OnboardingModal` to `ui-primitives` and share it between both steps.** The right end state, and the reason the connections step's chrome is deliberately a near-copy of it: same `Modal` with `headless`, same refused implicit dismissal, same inert handling, same `calc(100vh - 48px)` content box. Deferred rather than rejected — the extraction crosses three packages and belongs in a change that is about the extraction, not about how the question is asked. Until then the duplication is real and is the first thing a future step should collapse.

**Let Escape defer the step.** Treating dismissal as deferral would record the decision, but it makes an accidental keystroke indistinguishable from a choice, and the step is the one thing standing between a new user and a working conversation.

## Consequences

Both first-run steps now present identically, and the mask covers the full viewport rather than starting below the product top bar as the takeover's did. Nothing is lost by that: the takeover already held `#root` inert, so the top bar was visible but unusable during the question either way.

The duplicated dialog chrome between `ConnectionsOnboarding` and `OnboardingModal` is knowingly carried. It is small and stable, and `pnpm run duplication` does not flag it — which means a future extraction has to be chosen rather than forced by a gate.

## Testing

`packages/client/ui-settings-connections/tests/components.client.spec.tsx` pins the presentation: the dialog role and its `aria-modal`/label, that Escape and a mask click neither end the step nor call `complete()`, that `#root` is inert only while the step is asking and is restored on unmount, and that a composition without `#root` still renders.

`apps/web/tests/onboarding-deepseek-config.e2e.ts` addresses both first-run dialogs by `aria-label`, which is what the deleted `onboardingStage` class substring used to do for this step; its `missing.expected.md` golden now captures the dialog subtree. The reload-flash sampler from the step-owned chrome Agent Note keeps working against the same two labels, so that defect stays pinned. `apps/web/tests/navigation-panes.e2e.ts` dismisses the step by its dialog label and `Later` button, and `apps/web/stress-tests/reasoning-chunks.stress.ts` hides the fixture's undismissable notice by portal structure (`[role="presentation"]:has([role="dialog"])`) rather than by a class substring.
