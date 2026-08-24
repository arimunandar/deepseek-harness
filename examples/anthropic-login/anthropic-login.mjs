/**
 * Boot-time sign-in for a pi-ai catalog provider that ships an OAuth login —
 * by default Anthropic's "Claude Pro/Max" subscription flow.
 *
 * `@deepseek-ai/dsh-llm-pi-ai` already registers one authorization flow per
 * installed catalog provider (see its `registerPiAiFlows`), and the flow itself
 * owns the protocol and the credential write. What no shipped surface does yet
 * is *call* it: the Web UI's Models page only edits api-key credentials, and the
 * CLI has no `login` command. This plugin is that missing caller — a terminal
 * interaction handed to `ctx.authorization.begin()` during boot.
 *
 * It stays out of the way once a credential exists: a stored record for the key
 * means pi-ai owns refresh from there on, so the plugin logs and does nothing.
 *
 * @module anthropic-login
 */

import { createInterface } from 'node:readline'

/** Service the plugin cannot work without. */
export const inject = ['authorization']

/** Cordis plugin name. */
export const name = 'anthropic-login'

/** Defaults for every config field. */
const DEFAULTS = {
  scope: 'llm-pi-ai',
  provider: 'anthropic',
  method: 'oauth',
  force: false,
  waitMs: 15_000,
  pollMs: 250,
}

/** Where notices and prompts are written: stderr, so a protocol stdout stays clean. */
const out = process.stderr

/**
 * Write one labelled line.
 * @param {string} message - line body.
 */
function say(message) {
  out.write(`[anthropic-login] ${message}\n`)
}

/**
 * Ask one question on the terminal.
 *
 * @param {string} message - what to ask.
 * @param {AbortSignal | undefined} signal - withdraws this question alone.
 * @returns {Promise<string>} what the human typed.
 */
function ask(message, signal) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: out, terminal: true })
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      rl.close()
      fn(value)
    }
    const onAbort = () => { finish(reject, new Error('prompt withdrawn')) }
    if (signal?.aborted === true) return finish(reject, new Error('prompt withdrawn'))
    signal?.addEventListener('abort', onAbort, { once: true })
    // A closed stdin is not an empty answer: handing '' to the flow would make
    // it reject a blank authorization code and report that as a login failure.
    rl.on('close', () => { finish(reject, new Error('stdin closed before the question was answered')) })
    rl.question(`[anthropic-login] ${message}\n> `, answer => { finish(resolve, answer.trim()) })
  })
}

/**
 * Wait for the flow to appear. The provider plugin registers its flows in an
 * `ctx.inject(['authorization'], …)` callback, so ours can mount first; polling
 * for the entry is cheaper than reaching into another plugin's load order.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} key - the credential key, `<scope>/<provider>`.
 * @param {{ waitMs: number, pollMs: number }} timing - how long to wait, how often to look.
 * @param {AbortSignal} signal - abandons the wait when the plugin unloads.
 * @returns {Promise<import('@deepseek-ai/dsh-authorization').AuthorizationEntry | undefined>} the entry, or undefined on timeout.
 */
async function waitForFlow(ctx, key, timing, signal) {
  const deadline = Date.now() + timing.waitMs
  for (;;) {
    // The withdrawal check comes first, and the service is read through the
    // optional accessor rather than `ctx.authorization`: the injected getter
    // throws `cannot get required service "authorization" in inactive context`
    // once the fiber leaves ACTIVE, and this loop outlives the tree whenever
    // boot tears down while it is still polling. A throw here would escape the
    // detached attempt and fail the whole boot loudly.
    if (signal.aborted) return undefined
    const authorization = ctx.get('authorization')
    if (authorization === undefined) return undefined
    const entry = authorization.describe(key)
    if (entry !== undefined) return entry
    if (Date.now() >= deadline) return undefined
    await new Promise(resolve => { setTimeout(resolve, timing.pollMs) })
  }
}

/**
 * Run the sign-in once, reporting each step on stderr.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {typeof DEFAULTS} settings - resolved config.
 * @param {AbortSignal} signal - withdraws the whole attempt on unload.
 */
async function signIn(ctx, settings, signal) {
  const key = `${settings.scope}/${settings.provider}`

  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    say('no credentials service is mounted, so a sign-in would have nowhere to land; skipping')
    return
  }
  if (!settings.force) {
    const record = await credentials.readRecord(key)
    if (record !== undefined) {
      say(`"${key}" already holds a ${record.kind} credential; skipping (set force: true to sign in again)`)
      return
    }
  }

  const entry = await waitForFlow(ctx, key, settings, signal)
  if (entry === undefined) {
    if (signal.aborted) return
    say(`no authorization flow appeared for "${key}" within ${settings.waitMs}ms.`)
    say('mount @deepseek-ai/dsh-llm-pi-ai (it registers the flow) and @deepseek-ai/dsh-authorization.')
    return
  }
  const method = entry.methods.find(candidate => candidate.id === settings.method)
  if (method === undefined) {
    const offered = entry.methods.map(m => `${m.id} (${m.label})`).join(', ')
    say(`"${entry.label}" offers no method "${settings.method}"; it offers: ${offered}`)
    return
  }
  if (!process.stdin.isTTY) {
    say(`cannot sign in to ${entry.label} without a terminal: no TTY on stdin.`)
    say(`run the profile from an interactive shell to finish "${method.label}".`)
    return
  }

  say(`signing in to ${entry.label} — ${method.label}`)
  try {
    const outcome = await ctx.authorization.begin({
      key,
      method: method.id,
      signal,
      interaction: {
        notify(notice) {
          say(notice.message)
          if (notice.url !== undefined) say(`open: ${notice.url}`)
          if (notice.code !== undefined) say(`code: ${notice.code}`)
        },
        prompt(prompt) {
          if (prompt.kind === 'select') {
            const options = prompt.options
            const lines = options.map((option, index) => `  ${index + 1}) ${option.label}`).join('\n')
            return ask(`${prompt.message}\n${lines}\nchoose 1-${options.length}`, prompt.signal)
              .then((answer) => {
                const chosen = options[Number(answer) - 1] ?? options.find(o => o.id === answer)
                if (chosen === undefined) throw new Error(`"${answer}" is not one of the offered options`)
                return chosen.id
              })
          }
          return ask(prompt.message, prompt.signal)
        },
      },
    })
    say(outcome.status === 'authorized'
      ? `authorized. the grant is stored as record "${key}" and refreshes itself from here.`
      : 'sign-in cancelled; nothing was stored.')
  } catch (error) {
    // A failed sign-in must not take the boot down: every other capability in
    // the tree still works, and the next start can retry.
    say(`sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Start one detached sign-in attempt, withdrawn if the plugin unloads.
 *
 * The attempt is detached because `apply` runs inside the boot sequence: an
 * awaited browser round trip here would hold the whole tree, and the human it
 * waits on cannot answer until the surface they are being sent to is up.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Partial<typeof DEFAULTS>} [config] - config from the entry.
 */
export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...config }
  ctx.effect(() => {
    const controller = new AbortController()
    // Nothing awaits this attempt, so its rejection would be an unhandled one
    // and `installFailLoud` treats those as fatal. The whole point of the
    // plugin is that a sign-in it cannot finish leaves the rest of the tree
    // running, so the last resort is reported here and swallowed.
    void signIn(ctx, settings, controller.signal).catch((error) => {
      say(`sign-in abandoned: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => { controller.abort() }
  })
}
