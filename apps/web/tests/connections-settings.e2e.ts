// Web e2e scenario: the Connections page end to end through the real wire.
// The page states what a person can do about each backend and offers exactly
// the repair that state implies — Connect while nothing is stored, Finish
// setup once a credential exists but no route reads it, Use for new chats once
// it does, and a named confirmation before forgetting anything. Each
// transition is driven by moving one of the four joined owners and observing
// the pushed `connections/changed` converge the open page without a reload.
//
// Zero model calls: connecting is settings/credentials/llm-domain traffic, so
// there is no fixture and a stray stream would fail loud because the adapter
// registry is empty. The scenario's own backends come from
// connections-settings.overlay.yml rather than the shipped three, so a
// developer's real DEEPSEEK_API_KEY and installed `claude`/`codex` cannot move
// what the page says.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-connections'
// Context augmentation only: the page's activate gesture writes through it.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** This scenario's own connection directory, in place of the shipped three. */
const OVERLAY = fileURLToPath(new URL('./connections-settings.overlay.yml', import.meta.url))

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/connections-settings', import.meta.url))
const EMPTY_EXPECTED = join(SNAPSHOT_DIR, 'empty.expected.md')
const SETUP_EXPECTED = join(SNAPSHOT_DIR, 'setup-required.expected.md')
const CONNECTED_EXPECTED = join(SNAPSHOT_DIR, 'connected.expected.md')
const DISCONNECT_EXPECTED = join(SNAPSHOT_DIR, 'disconnect.expected.md')
const MODE = webSnapshotMode()

/** The record a sign-in would have written for the overlay's `alpha` entry. */
const ALPHA_RECORD = credentialKey('llm-pi-ai', 'anthropic')

describe('web e2e: the Connections page says what to press about each backend', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('offers Connect, and nothing else, while nothing is stored', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-connections-empty'))
    // Settings opens directly: this page contributes no first-run takeover, and
    // the scaffold pre-acknowledges the welcome notice while leaving the
    // DeepSeek adapter unmounted, so neither shipped step has anything to ask.
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '连接' }).click()
    await dialog.getByText('选一个来用。可以随时连接多个，并在它们之间切换。').waitFor({ timeout: 10_000 })

    // `alpha` addresses a record pi-ai registers a real sign-in flow for, so
    // its Connect button exists; `beta` names a reference no flow writes, so
    // the page says it cannot be connected here instead of offering a button
    // that would fail. Each card is a named region, which is what tells the
    // two apart — and what tells either from the navigation entry that carries
    // the same word.
    await dialog.getByRole('region', { name: 'Alpha' })
      .getByRole('button', { name: '连接', exact: true }).waitFor({ timeout: 10_000 })
    const beta = dialog.getByRole('region', { name: 'Beta' })
    await beta.getByText('这个后端在当前配置下无法连接。').waitFor({ timeout: 10_000 })
    expect(await beta.getByRole('button', { name: '连接', exact: true }).count()).toBe(0)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EMPTY_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('converges to setup-required when a credential lands without a route', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-connections-setup'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    // A sign-in's own commit, made through the seam it commits through. The
    // page is already open, so what this asserts is that a credential written
    // anywhere converges the open surface through `connections/changed`.
    await scaffold.ctx.credentials.modifyRecord(ALPHA_RECORD, () =>
      Promise.resolve({ kind: 'grant', payload: { token: 'e2e' } }))

    await dialog.getByText('需要完成设置').waitFor({ timeout: 10_000 })
    await dialog.getByText('已经登录，还差最后一步就能使用。').waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SETUP_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('writes the missing route on Finish setup and reports the backend usable', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-connections-finish'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '完成设置' }).click()

    await dialog.getByText('已连接').waitFor({ timeout: 10_000 })
    // The repair is a settings write, not a page-local flag: the route the
    // adapter registers from is in the document afterwards.
    const section = scaffold.ctx.settings.get(settingsNamespace('llm-pi-ai')) as {
      providers?: Record<string, unknown>
    }
    expect(section.providers).toHaveProperty('anthropic')

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CONNECTED_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('makes the connection the default for new conversations', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-connections-activate'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '用于新对话' }).click()
    await dialog.getByText('正在使用').waitFor({ timeout: 10_000 })
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    })
  }, 60_000)

  it('names the connection before forgetting it, and forgets only on confirm', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-connections-disconnect'))
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '断开连接' }).click()
    const confirm = page.getByRole('dialog', { name: '断开 Alpha？' })
    await confirm.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="dialog"][aria-label="断开 Alpha？"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DISCONNECT_EXPECTED, snapshot, MODE)

    // Going back keeps the credential: a confirmation that removed on dismiss
    // would not be one.
    await confirm.getByRole('button', { name: '返回' }).click()
    expect(await scaffold.ctx.credentials.describeRecord(ALPHA_RECORD)).toMatchObject({ configured: true })

    await dialog.getByRole('button', { name: '断开连接' }).click()
    await page.getByRole('dialog', { name: '断开 Alpha？' }).getByRole('button', { name: '确认断开' }).click()
    await expect.poll(
      async () => (await scaffold.ctx.credentials.describeRecord(ALPHA_RECORD)).configured,
      { timeout: 10_000 },
    ).toBe(false)
    // The route survives: this app wrote it, but forgetting a sign-in is not
    // the same gesture as removing a provider, and the Models page owns that.
    await dialog.getByText('需要处理').waitFor({ timeout: 10_000 })
  }, 60_000)

  it('drove the whole page without a console warning or page error', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
