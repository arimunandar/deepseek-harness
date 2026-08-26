import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Every stylesheet this page ships. */
const css = readdirSync(fileURLToPath(new URL('../src/client/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

/** The theme sheets that declare every `--dsw-*` name a page may use. */
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

describe('connections page theme styles', () => {
  it('names only theme variables the token sheet defines', () => {
    // An undeclared `--dsw-*` name is not a near miss: it has no fallback, so
    // the property simply does not apply and the surface it was meant to paint
    // renders bare. This page shipped that way — every colour it named was a
    // plausible-looking spelling the sheets never declare — which is why the
    // gate exists here rather than only on the Models page.
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    const undeclared = [...new Set(named)].filter(name => !tokens.includes(`  ${String(name)}:`))
    expect(undeclared).toEqual([])
  })

  it('never falls back to a literal colour', () => {
    // A literal in a fallback slot is one colour for both themes, which is the
    // same defect the undeclared name causes, only harder to see.
    expect(css).not.toMatch(/var\(--[a-z0-9-]+,\s*#/)
    expect(css).not.toMatch(/var\(--[a-z0-9-]+,\s*rgb/)
  })

  it('shares the Models row surface, so the two pages read as one product', () => {
    const card = /^\.card \{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(card).toContain('border: 1px solid var(--dsw-alias-border-l2)')
    expect(card).toContain('border-radius: 12px')
  })
})
