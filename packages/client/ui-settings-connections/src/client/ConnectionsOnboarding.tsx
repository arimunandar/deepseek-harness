/**
 * First-run connection step.
 *
 * What a person meets before they can start a conversation is the same page
 * they will come back to: the cards, in the same shapes, doing the same things.
 * A sign-in started here is the attempt the settings page shows, because both
 * surfaces bind one store.
 *
 * This step owns the moment that the official-DeepSeek credential step used to
 * own. It asks the wider question — which of the offered backends, by sign-in
 * or by key — so running both would leave anyone who defers the first looking
 * at a second takeover asking a narrower version of the same thing.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button, OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ConnectionCard } from './ConnectionCard.tsx'
import { cardActions } from './store.ts'
import type { ConnectionsState, ConnectionsStore } from './store.ts'
import type { ConnectionsLocaleKey } from './locales.ts'
import css from './ConnectionsOnboarding.module.css'

/** Registration-side dependencies of {@link ConnectionsOnboarding}. */
export interface ConnectionsOnboardingInjected {
  /** The page store, shared with the settings section. */
  controller: ConnectionsStore
  hooks: {
    /** Page snapshot, bound by the UI renderer as `useConnections`. */
    connections: SnapshotStore<ConnectionsState>
  }
  /** Step copy. */
  t: (key: ConnectionsLocaleKey) => string
}

/** Slot owner props plus this step's injected dependencies. */
export type ConnectionsOnboardingProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<ConnectionsOnboardingInjected>

/**
 * Whether this step has anything to ask.
 *
 * A directory that has not loaded, failed to load, or offers nothing asks
 * nothing: the step is a nudge toward a page that exists either way, and
 * blocking first run on a failed read would trap someone behind a surface that
 * cannot help them. Any connection already usable — including one a launch
 * environment supplies — ends it without rendering.
 * @param state - the current page snapshot.
 * @returns whether the step should render.
 */
export function onboardingNeeded(state: ConnectionsState): boolean {
  if (state.status !== 'ready' || state.rows.length === 0) return false
  return !state.rows.some(row => row.status === 'connected')
}

/**
 * Offer the connection cards to a first-run person with no usable backend.
 * @param props - settings-shell owner state and this feature's dependencies.
 * @returns the first-run takeover, or null when nothing needs asking.
 */
export function ConnectionsOnboarding(props: ConnectionsOnboardingProps): ReactNode {
  const { complete, controller, useConnections, t } = props
  const state = useConnections(snapshot => snapshot)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  // A connection that lands while the step is open ends it, so the person who
  // just signed in is not left looking at a takeover asking them to sign in.
  useEffect(() => {
    if (state.status === 'ready' && !onboardingNeeded(state)) complete()
  }, [complete, state])

  if (state.status !== 'ready' || !onboardingNeeded(state)) return null

  return (
    <OnboardingSurface>
      <div className={css.step}>
        <h2 className={css.heading}>{t('onboardingHeading')}</h2>
        <p className={css.body}>{t('onboardingBody')}</p>
        <div className={css.cards}>
          {state.rows.map(row => (
            <ConnectionCard
              key={row.id}
              row={row}
              conversation={state.conversations[row.id]}
              expanded={state.expanded === row.id}
              t={t}
              {...cardActions(controller, row.id)}
            />
          ))}
        </div>
        <div className={css.footer}>
          <Button onClick={() => { complete() }}>{t('onboardingLater')}</Button>
        </div>
      </div>
    </OnboardingSurface>
  )
}
