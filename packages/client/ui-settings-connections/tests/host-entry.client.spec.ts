import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-settings-connections host entry', () => {
  it('contributes nothing on the Host, where the page has no surface to fill', () => {
    const body = vi.fn(apply)
    body()
    expect(body).toHaveReturnedWith(undefined)
  })
})
