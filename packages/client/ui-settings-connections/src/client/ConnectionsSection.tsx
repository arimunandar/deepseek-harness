/**
 * The Connections settings page: one card per offered backend, in the order
 * the Host declared them, plus the disconnect confirmation.
 *
 * There is no add flow, no route editor, and no field for a provider id — a
 * person who wants those is on the Models page. This page answers one question
 * per card ("can I use this yet") and offers one button per answer.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ConnectionCard } from './ConnectionCard.tsx'
import { cardActions } from './store.ts'
import type { ConnectionsState, ConnectionsStore } from './store.ts'
import type { ConnectionsLocaleKey } from './locales.ts'
import css from './ConnectionsSection.module.css'

/** Registration-side dependencies of {@link ConnectionsSection} (slot `inject`). */
export interface ConnectionsSectionInjected {
  /** The page store: loaded on mount, refreshed on every pushed invalidation. */
  controller: ConnectionsStore
  hooks: {
    /** Page snapshot, bound by the UI renderer as `useSnapshot`. */
    snapshot: SnapshotStore<ConnectionsState>
  }
  /** Page copy. */
  t: (key: ConnectionsLocaleKey) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type ConnectionsSectionProps = Partial<InjectFace<ConnectionsSectionInjected>>

type ConnectionsSectionFace = InjectFace<ConnectionsSectionInjected>

/**
 * Substitute the one named slot this page's confirmation copy carries.
 * @param template - the copy, holding `{{name}}`.
 * @param name - the connection's product name.
 * @returns the resolved sentence.
 */
function withName(template: string, name: string): string {
  return template.replaceAll('{{name}}', name)
}

/**
 * Render the Connections page.
 * @param props - the slot's inject face, absent until the section activates.
 * @returns the page, or null before its dependencies arrive.
 */
export function ConnectionsSection(props: ConnectionsSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: ConnectionsSectionFace }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const confirming = state.rows.find(row => row.id === state.confirming)

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h2 className={css.heading}>{t('heading')}</h2>
        <p className={css.intro}>{t('intro')}</p>
      </header>

      {state.status === 'loading' && <p className={css.status}>{t('loading')}</p>}

      {state.status === 'error' && (
        <div className={css.status} role="alert">
          <p>{t('error')}</p>
          <Button onClick={() => { void controller.load() }}>{t('retry')}</Button>
        </div>
      )}

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

      {confirming !== undefined && (
        <Modal
          open
          onClose={() => { controller.confirm(null) }}
          title={withName(t('disconnectTitle'), confirming.label)}
          description={withName(t('disconnectBody'), confirming.label)}
          closeLabel={t('close')}
          footer={(
            <div className={css.confirmActions}>
              <Button onClick={() => { controller.confirm(null) }}>{t('disconnectCancel')}</Button>
              <Button variant="primary" onClick={() => { void controller.disconnect(confirming.id) }}>
                {t('disconnectConfirm')}
              </Button>
            </div>
          )}
        />
      )}
    </div>
  )
}
