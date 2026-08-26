/**
 * Connect-your-AI page, registered into Web Settings.
 *
 * It contributes no `settings.onboarding` step. One takeover already owns that
 * moment — the official-DeepSeek credential step — and a second one asking a
 * wider version of the same question would make first run two takeovers deep
 * for anyone who defers the first. Which step owns first run is a decision
 * about that flow rather than about this page.
 */

// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section'
// and 'settings.onboarding' entries).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge, the connections namespace, and the
// forwarded-event key face this page subscribes to.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ConnectionsSection } from './ConnectionsSection.tsx'
import type { ConnectionsSectionInjected } from './ConnectionsSection.tsx'
import { ConnectionsStore } from './store.ts'
import { en, zh, type ConnectionsLocaleKey } from './locales.ts'

export type { ConnectionsSectionInjected, ConnectionsSectionProps } from './ConnectionsSection.tsx'
export { cardActions, ConnectionsStore, EMPTY_CONNECTIONS_STATE, messageOf } from './store.ts'
export type { ConnectionCardActions, ConnectionConversation, ConnectionsState } from './store.ts'
export type { ConnectionsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Connect-your-AI page copy. */
    'settings.connections': ConnectionsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.connections'

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.connections']

/**
 * Register the Connections section and first-run step, and keep both fresh on
 * every pushed invalidation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-connections: copy dictionaries')

  const t = ctx.locale.bind(NS) as (key: ConnectionsLocaleKey) => string
  const controller = new ConnectionsStore(ctx.remote)

  const sectionInjected = (): ConnectionsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    t,
  })
  // The Host folds every owner that can change the directory into one signal,
  // so a sign-in finished in another tab, a hand-edited settings.yaml, and a
  // credential removed elsewhere all converge here without polling. The
  // conversation frames are separate because they belong to one attempt rather
  // than to the directory.
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('connections/changed', () => { void controller.load() }),
      ctx.remote.$on('connections/notice', (notice) => { controller.receiveNotice(notice) }),
      ctx.remote.$on('connections/prompt', (prompt) => { controller.receivePrompt(prompt) }),
      ctx.on('connection/reset', () => { void controller.load() }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-connections: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'connections',
    // Ahead of Models: connecting an account is the question a person arrives
    // with, and editing a provider profile is the one they arrive at later.
    order: 5,
    label: () => t('nav'),
    inject: sectionInjected,
  }, ConnectionsSection))
}
