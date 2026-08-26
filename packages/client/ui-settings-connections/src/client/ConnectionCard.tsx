/**
 * One connectable backend, rendered the way an account connection is rendered
 * and not the way a provider profile is: a name, a sentence, a state word, and
 * one obvious button. The technical join behind the state word stays on the
 * Host; what reaches this file is already the four states and the one repair
 * each implies.
 *
 * While a sign-in runs, the card becomes the conversation — the flow's notices
 * in order, then its question with a field. That is the whole guided flow: the
 * steps are the flow's own, so nothing here has to know how any provider's
 * OAuth works.
 */

import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { ConnectionStatus, ConnectionView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Pill, StateDot, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionConversation } from './store.ts'
import type { ConnectionsLocaleKey } from './locales.ts'
import css from './ConnectionCard.module.css'

/** Everything one card needs, already resolved by the section. */
export interface ConnectionCardProps {
  /** The Host's view of this connection. */
  row: ConnectionView
  /** The running sign-in's conversation, when this connection has one. */
  conversation: ConnectionConversation | undefined
  /** Whether this card is the expanded one. */
  expanded: boolean
  /** Card copy. */
  t: (key: ConnectionsLocaleKey) => string
  /** Start a sign-in with the named method. */
  onConnect: (method: string) => void
  /** Answer the open question. */
  onAnswer: (promptId: string, value: string) => void
  /** Withdraw the running sign-in. */
  onCancel: () => void
  /** Write the missing route. */
  onFinishSetup: () => void
  /** Make this connection the one new conversations start with. */
  onActivate: () => void
  /** Ask before forgetting the stored credential. */
  onDisconnect: () => void
  /** Show or hide this card's detail. */
  onExpand: (next: boolean) => void
}

/** The state word each status carries. */
const STATUS_KEYS = {
  'connected': 'statusConnected',
  'setup-required': 'statusSetupRequired',
  'needs-attention': 'statusNeedsAttention',
  'not-connected': 'statusNotConnected',
} satisfies Record<ConnectionStatus, ConnectionsLocaleKey>

/**
 * The dot beside the state word. `not-connected` gets none: nothing is wrong
 * with a backend a person simply has not chosen, and a coloured dot there
 * would read as a problem to fix.
 */
const STATUS_DOTS = {
  'connected': 'done',
  'setup-required': 'warning',
  'needs-attention': 'error',
  'not-connected': null,
} satisfies Record<ConnectionStatus, StateDotState | null>

/** The sentence explaining a state that is not `connected`. */
const ATTENTION_KEYS = {
  'route-missing': 'whyRouteMissing',
  'credential-missing': 'whyCredentialMissing',
  'credential-read-only': 'whyCredentialReadOnly',
} satisfies Record<NonNullable<ConnectionView['attention']>, ConnectionsLocaleKey>

/**
 * The sentence for a state that is not `connected`, given whether this backend
 * has a sign-in at all.
 *
 * A missing credential reads as an expired sign-in only where a sign-in exists.
 * A backend authenticated by a typed key has no button on this page, so its
 * sentence has to name the page that does — otherwise the card tells someone to
 * sign in again with nothing to press.
 * @param attention - the repair the Host named.
 * @param connectable - whether any sign-in flow is registered for this backend.
 * @returns the copy key to render.
 */
function attentionKey(
  attention: NonNullable<ConnectionView['attention']>,
  connectable: boolean,
): ConnectionsLocaleKey {
  if (attention === 'credential-missing' && !connectable) return 'whyKeyMissing'
  return ATTENTION_KEYS[attention]
}

/**
 * Render the open question of a running sign-in.
 * @param props - the question, the copy, and where the answer goes.
 * @returns the question form.
 */
function PromptForm({ prompt, t, onAnswer }: {
  prompt: NonNullable<ConnectionConversation['prompt']>
  t: (key: ConnectionsLocaleKey) => string
  onAnswer: (promptId: string, value: string) => void
}): ReactNode {
  const [typed, setTyped] = useState('')
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (typed.length === 0) return
    onAnswer(prompt.promptId, typed)
    setTyped('')
  }
  if (prompt.kind === 'select') {
    return (
      <div className={css.prompt}>
        <p className={css.promptMessage}>{prompt.message}</p>
        <div className={css.choices}>
          {(prompt.options ?? []).map(option => (
            <Button
              key={option.id}
              variant="outline"
              onClick={() => { onAnswer(prompt.promptId, option.id) }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <form className={css.prompt} onSubmit={submit}>
      <label className={css.promptMessage} htmlFor={`connection-prompt-${prompt.id}`}>{prompt.message}</label>
      <div className={css.promptRow}>
        <input
          id={`connection-prompt-${prompt.id}`}
          className={css.promptField}
          // A secret is masked and kept out of autofill and spellcheck; the
          // seam draws exactly this one distinction between the two kinds.
          type={prompt.kind === 'secret' ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          placeholder={prompt.placeholder ?? ''}
          value={typed}
          onChange={(event) => { setTyped(event.target.value) }}
        />
        <Button variant="primary" type="submit" disabled={typed.length === 0}>{t('continueLabel')}</Button>
      </div>
    </form>
  )
}

/**
 * Render one connectable backend.
 * @param props - the row, its conversation, the copy, and every action.
 * @returns the card.
 */
export function ConnectionCard(props: ConnectionCardProps): ReactNode {
  const { row, conversation, expanded, t } = props
  const dot = STATUS_DOTS[row.status]
  const method = row.methods[0]
  // The attempt this surface started shows immediately from its own
  // conversation; one started elsewhere shows from the directory's `connecting`.
  const busy = row.connecting || conversation?.running === true
  const notices = conversation?.notices ?? []
  const latest = notices[notices.length - 1]
  // Captured so the copy handler closes over a narrowed value rather than
  // re-reading a field the compiler can no longer prove is present.
  const code = latest?.code

  return (
    <section className={css.card} aria-labelledby={`connection-${row.id}`}>
      <header className={css.head}>
        <div className={css.identity}>
          <h3 className={css.name} id={`connection-${row.id}`}>{row.label}</h3>
          <p className={css.description}>{row.description}</p>
        </div>
        <div className={css.state}>
          {dot !== null && <StateDot state={dot} />}
          <span className={css.stateWord}>{t(STATUS_KEYS[row.status])}</span>
          {row.active && <Pill active>{t('inUse')}</Pill>}
        </div>
      </header>

      {row.attention !== undefined && (
        <p className={css.why}>{t(attentionKey(row.attention, method !== undefined))}</p>
      )}

      {row.status === 'not-connected' && row.vendorCliInstalled && (
        <p className={css.hint}>{t('alreadyInstalled')}</p>
      )}

      {busy && (
        <div className={css.conversation}>
          <p className={css.keepOpen}>{t('keepTabOpen')}</p>
          {latest !== undefined && (
            <div className={css.notice}>
              <p className={css.noticeMessage}>{latest.message}</p>
              {latest.url !== undefined && (
                <a className={css.noticeLink} href={latest.url} target="_blank" rel="noreferrer noopener">
                  {t('openPage')}
                </a>
              )}
              {code !== undefined && (
                <div className={css.code}>
                  <code>{code}</code>
                  <Button size="sm" onClick={() => { void writeClipboard(code) }}>{t('copyCode')}</Button>
                </div>
              )}
            </div>
          )}
          {conversation?.prompt != null && (
            <PromptForm prompt={conversation.prompt} t={t} onAnswer={props.onAnswer} />
          )}
        </div>
      )}

      {conversation?.failure != null && !busy && (
        <p className={css.failure} role="alert">{conversation.failure}</p>
      )}

      <footer className={css.actions}>
        {busy
          ? <Button variant="outline" onClick={props.onCancel}>{t('cancel')}</Button>
          : (
            <>
              {row.status === 'setup-required' && (
                <Button variant="primary" onClick={props.onFinishSetup}>{t('finishSetup')}</Button>
              )}
              {row.status === 'not-connected' && method !== undefined && (
                <Button variant="primary" onClick={() => { props.onConnect(method.id) }}>{t('connect')}</Button>
              )}
              {row.status === 'needs-attention' && method !== undefined && row.attention !== 'credential-read-only' && (
                <Button variant="primary" onClick={() => { props.onConnect(method.id) }}>{t('reconnect')}</Button>
              )}
              {row.status === 'connected' && !row.active && (
                <Button variant="primary" onClick={props.onActivate}>{t('useForNewChats')}</Button>
              )}
              {row.disconnectable && (
                <Button onClick={props.onDisconnect}>{t('disconnect')}</Button>
              )}
              {row.status === 'not-connected' && method === undefined && (
                <p className={css.unavailable}>{t('unavailable')}</p>
              )}
            </>
          )}
        {!busy && notices.length > 0 && (
          <Button size="sm" onClick={() => { props.onExpand(!expanded) }}>
            {expanded ? '−' : '+'}
          </Button>
        )}
      </footer>

      {expanded && !busy && notices.length > 0 && (
        <ul className={css.history}>
          {notices.map((notice, index) => (
            <li key={`${notice.message}-${String(index)}`}>{notice.message}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
