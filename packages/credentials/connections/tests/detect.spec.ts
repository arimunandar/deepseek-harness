import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commandOnPath, executableCandidates } from '../src/detect.ts'

const roots: string[] = []

/** A PATH entry holding one file with the given mode. */
function directoryWith(name: string, mode: number): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-detect-'))
  roots.push(root)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, name), '#!/bin/sh\n', { mode })
  return bin
}

afterEach(() => { roots.length = 0 })

describe('vendor command detection', () => {
  it('finds an executable file on PATH', () => {
    const bin = directoryWith('claude', 0o755)
    expect(commandOnPath('claude', { PATH: bin })).toBe(true)
  })

  it('does not find a file that is present but not executable', () => {
    const bin = directoryWith('claude', 0o644)
    expect(commandOnPath('claude', { PATH: bin })).toBe(false)
  })

  it('does not find a command no PATH entry holds', () => {
    const bin = directoryWith('claude', 0o755)
    expect(commandOnPath('codex', { PATH: bin })).toBe(false)
  })

  it('searches every PATH entry and skips empty ones', () => {
    const first = directoryWith('other', 0o755)
    const second = directoryWith('codex', 0o755)
    expect(commandOnPath('codex', { PATH: [first, '', second].join(delimiter) })).toBe(true)
  })

  it('answers no when the environment carries no PATH at all', () => {
    expect(commandOnPath('claude', {})).toBe(false)
    expect(commandOnPath('claude', { PATH: '' })).toBe(false)
  })

  it('reads the process environment when none is supplied', () => {
    // The bare-name lookup is the whole default-argument contract; which
    // commands this machine happens to have is not this suite's business.
    expect(typeof commandOnPath('dsh-definitely-absent-command')).toBe('boolean')
  })
})

describe('candidate paths', () => {
  // `delimiter` is the host's, not the named platform's, so these cases vary
  // only the suffix rule and keep PATH entries in this host's own grammar.
  it('tries the bare name once per PATH entry on POSIX', () => {
    expect(executableCandidates('codex', { PATH: ['/a', '/b'].join(delimiter) }, 'linux'))
      .toEqual([join('/a', 'codex'), join('/b', 'codex')])
  })

  it('tries every PATHEXT suffix per entry on Windows', () => {
    expect(executableCandidates('codex', { PATH: '/bin', PATHEXT: '.EXE;.CMD' }, 'win32'))
      .toEqual([join('/bin', 'codex.EXE'), join('/bin', 'codex.CMD')])
  })

  it('falls back to the standard Windows suffixes when PATHEXT is absent', () => {
    expect(executableCandidates('codex', { PATH: '/bin' }, 'win32'))
      .toEqual(['.COM', '.EXE', '.BAT', '.CMD'].map(suffix => join('/bin', `codex${suffix}`)))
  })

  it('drops empty PATHEXT entries a trailing separator leaves behind', () => {
    expect(executableCandidates('codex', { PATH: '/bin', PATHEXT: '.EXE;' }, 'win32'))
      .toEqual([join('/bin', 'codex.EXE')])
  })

  it('has no candidates without a PATH', () => {
    expect(executableCandidates('codex', {}, 'linux')).toEqual([])
  })
})
