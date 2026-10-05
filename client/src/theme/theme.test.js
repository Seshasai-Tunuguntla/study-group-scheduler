import { describe, expect, test } from 'vitest'
import { applyTheme, readPinnedTheme, THEME_KEY, toggleTheme, writePinnedTheme } from './theme.js'

const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}
const blockedStorage = {
  getItem() { throw new Error('blocked') },
  setItem() { throw new Error('blocked') },
  removeItem() { throw new Error('blocked') },
}

describe('toggleTheme', () => {
  test.each([
    // current, system -> theme, pinned
    ['dark', 'dark', 'light', 'light'], // leaving the system theme pins the other one
    ['light', 'dark', 'dark', null], // back to the system's theme: unpinned, follows the system again
    ['light', 'light', 'dark', 'dark'],
    ['dark', 'light', 'light', null],
  ])('from %s with a %s system -> %s, pinned %s', (current, system, theme, pinned) => {
    expect(toggleTheme(current, system)).toEqual({ theme, pinned })
  })
})

describe('pinned theme storage', () => {
  test('reads back what was written, and removing it means "follow the system"', () => {
    const storage = memoryStorage()
    writePinnedTheme('light', storage)
    expect(readPinnedTheme(storage)).toBe('light')
    writePinnedTheme(null, storage)
    expect(readPinnedTheme(storage)).toBeNull()
  })

  test('ignores anything that is not a theme', () => {
    expect(readPinnedTheme(memoryStorage({ [THEME_KEY]: 'sepia' }))).toBeNull()
  })

  test('blocked storage just means not pinned, and never throws', () => {
    expect(readPinnedTheme(blockedStorage)).toBeNull()
    expect(() => writePinnedTheme('dark', blockedStorage)).not.toThrow()
  })
})

describe('applyTheme', () => {
  // Just enough of a document: <html> and the two theme-color metas.
  const fakeDocument = () => {
    const metas = ['light', 'dark'].map((theme) => ({ dataset: { themeColor: theme }, media: '' }))
    return { documentElement: { dataset: {} }, querySelectorAll: () => metas, metas }
  }

  test('a pinned theme sets data-theme and makes its theme-color apply everywhere', () => {
    const doc = fakeDocument()
    applyTheme('light', doc)
    expect(doc.documentElement.dataset.theme).toBe('light')
    expect(doc.metas.map((meta) => meta.media)).toEqual(['all', 'not all'])
  })

  test('no pin removes data-theme and hands theme-color back to the system setting', () => {
    const doc = fakeDocument()
    applyTheme('dark', doc)
    applyTheme(null, doc)
    expect(doc.documentElement.dataset.theme).toBeUndefined()
    expect(doc.metas.map((meta) => meta.media)).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-color-scheme: dark)',
    ])
  })
})
