import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

/**
 * Test adapter for the worktree composition, branching on the requested MODEL
 * rather than on conversation state: `mock-lead` delegates once and then
 * reports, while `mock-role` answers plainly. Branching on the model is what
 * keeps the child from re-entering the lead's delegate-first behavior, which a
 * state-based branch cannot express once the child's own history is empty.
 */
class MockWorktreeAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.model === 'mock-role') {
      yield * this.say('role finished in its own workspace')
      return
    }
    const delegated = options.messages.some(message =>
      message.content.some(block => block.type === 'tool-result'))
    if (delegated) {
      yield * this.say('lead collected the role result')
      return
    }
    const args = JSON.stringify({ description: 'workspace probe', prompt: 'do the work' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: CallId('call-delegate'), name: 'subagent', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('call-delegate'), name: 'subagent', arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }

  /** Stream one complete text answer. */
  private async * say(text: string): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'mock-worktree-llm'
export const inject = ['llm']

/**
 * Register the worktree-composition mock adapter under the `mock` provider.
 * @param ctx - the plugin context supplying `ctx.llm`.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mock'], new MockWorktreeAdapter())
}
