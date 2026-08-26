/**
 * Whether a vendor's own command-line tool is installed on this machine.
 *
 * The answer is used for one sentence of copy ("you already use this") and for
 * ordering cards, never as authentication: nothing here opens, parses, or
 * copies a credential out of another product's files. Those formats carry no
 * compatibility promise, and a subscription token issued to one client is not
 * this app's to reuse — a person who already has the vendor's tool signs in
 * here with the same account instead, which takes one click and produces a
 * grant that belongs to this app.
 *
 * @module @deepseek-ai/dsh-connections/detect
 */

import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Every filesystem path a shell would try for one command name.
 *
 * POSIX runs the bare name; Windows resolves through `PATHEXT`, whose default
 * is spelled out because a launcher environment that drops the variable still
 * resolves the same four kinds a shell would. Empty `PATH` entries are skipped
 * rather than resolved against the working directory, which is what a
 * trailing separator would otherwise mean.
 * @param command - bare command name, without a directory or an extension.
 * @param env - the environment supplying `PATH` and `PATHEXT`.
 * @param platform - the host platform, which decides whether suffixes apply.
 * @returns the candidate paths, in the order a shell would try them.
 */
export function executableCandidates(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const path = env['PATH']
  if (path === undefined || path.length === 0) return []
  const suffixes = platform === 'win32'
    ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(entry => entry.length > 0)
    : ['']
  const candidates: string[] = []
  for (const directory of path.split(delimiter)) {
    if (directory.length === 0) continue
    for (const suffix of suffixes) candidates.push(join(directory, `${command}${suffix}`))
  }
  return candidates
}

/**
 * Look one command up on `PATH` the way a shell would.
 *
 * Nothing is executed: a vendor tool that is present but broken, or that would
 * prompt on launch, must not be able to affect a configuration page.
 * @param command - bare command name, without a directory or an extension.
 * @param env - the environment supplying `PATH` and `PATHEXT`.
 * @returns whether an executable file of that name sits on `PATH`.
 */
export function commandOnPath(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const candidate of executableCandidates(command, env, process.platform)) {
    try {
      accessSync(candidate, constants.X_OK)
      return true
    } catch {
      // Absent, unreadable, or not executable: all three mean "not this
      // candidate", and the next one is the only thing that can differ.
    }
  }
  return false
}
