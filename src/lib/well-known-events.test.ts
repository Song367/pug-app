import { describe, expect, it } from 'vitest'
import { partitionEventProps, resolveInlineProps } from './well-known-events'

describe('screen_view wire aliases', () => {
  it.each([
    ['screenName', '/home'],
    ['screen_name', '/settings'],
  ])('uses %s as the inline headline', (key, value) => {
    const result = resolveInlineProps('screen_view', { [key]: value })
    expect(result.headline).toBe(value)
    expect(result.headlinePairs).toEqual([[key, value]])
  })

  it('keeps the SDK camelCase alias outside the proto schema bucket', () => {
    expect(partitionEventProps('screen_view', { screenName: '/home', screen_name: '/fallback' })).toEqual({
      schemaProps: [['screen_name', '/fallback']],
      extraProps: [['screenName', '/home']],
    })
  })
})
