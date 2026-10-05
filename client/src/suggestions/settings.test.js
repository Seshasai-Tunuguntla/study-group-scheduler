import { describe, expect, test } from 'vitest'
import {
  crossesMidnight,
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettings,
  storageKey,
  suggestionParams,
  TIME_OPTIONS,
  withPreferred,
  writeSettings,
} from './settings.js'

// A Map-backed stand-in for localStorage.
const memoryStorage = () => {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) }
}

describe('normalizeSettings', () => {
  test('keeps valid settings', () => {
    const settings = { duration: 90, preferredStart: '21:00', preferredEnd: '01:00' }
    expect(normalizeSettings(settings)).toEqual(settings)
  })

  test.each([
    ['nothing stored', null],
    ['a length the server would reject', { duration: 45 }],
    ['a preferred window with one end', { duration: 60, preferredStart: '16:00', preferredEnd: null }],
    ['an empty preferred window', { duration: 60, preferredStart: '16:00', preferredEnd: '16:00' }],
    ['a time off the half hour', { duration: 60, preferredStart: '16:15', preferredEnd: '18:00' }],
    ['garbage', 'not an object'],
  ])('falls back to defaults for %s', (_label, value) => {
    const result = normalizeSettings(value)
    expect(result.preferredStart).toBeNull()
    expect(result.preferredEnd).toBeNull()
    if (value?.duration !== 60) expect(result.duration).toBe(DEFAULT_SETTINGS.duration)
  })
})

describe('reading and writing', () => {
  test('remembers settings per user and group', () => {
    const storage = memoryStorage()
    writeSettings(storageKey(1, 7), { duration: 120, preferredStart: '18:00', preferredEnd: '21:00' }, storage)

    expect(readSettings(storageKey(1, 7), storage)).toEqual({ duration: 120, preferredStart: '18:00', preferredEnd: '21:00' })
    expect(readSettings(storageKey(1, 8), storage)).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(storageKey(2, 7), storage)).toEqual(DEFAULT_SETTINGS)
  })

  test('survives unreadable or blocked storage', () => {
    const corrupt = memoryStorage()
    corrupt.setItem('k', '{not json')
    const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }

    expect(readSettings('k', corrupt)).toEqual(DEFAULT_SETTINGS)
    expect(readSettings('k', blocked)).toEqual(DEFAULT_SETTINGS)
    expect(() => writeSettings('k', DEFAULT_SETTINGS, blocked)).not.toThrow()
  })
})

describe('preferred hours', () => {
  test('a window can cross midnight', () => {
    expect(crossesMidnight({ preferredStart: '21:00', preferredEnd: '01:00' })).toBe(true)
    expect(crossesMidnight({ preferredStart: '16:00', preferredEnd: '21:00' })).toBe(false)
    expect(crossesMidnight({ preferredStart: null, preferredEnd: null })).toBe(false)
  })

  test('moving one end onto the other pushes the other end an hour on instead of emptying the window', () => {
    const settings = { duration: 60, preferredStart: '18:00', preferredEnd: '21:00' }

    expect(withPreferred(settings, 'preferredStart', '21:00')).toMatchObject({ preferredStart: '21:00', preferredEnd: '22:00' })
    expect(withPreferred(settings, 'preferredEnd', '18:00')).toMatchObject({ preferredStart: '17:00', preferredEnd: '18:00' })
    expect(withPreferred({ ...settings, preferredEnd: '00:00' }, 'preferredStart', '00:00')).toMatchObject({ preferredEnd: '01:00' })
    expect(withPreferred(settings, 'preferredEnd', '23:30')).toMatchObject({ preferredStart: '18:00', preferredEnd: '23:30' })
  })

  test('the options are every half hour of the day', () => {
    expect(TIME_OPTIONS).toHaveLength(48)
    expect(TIME_OPTIONS.slice(0, 3)).toEqual(['00:00', '00:30', '01:00'])
    expect(TIME_OPTIONS.at(-1)).toBe('23:30')
  })

  test('suggestionParams only sends preferred hours when they are set', () => {
    expect(suggestionParams({ duration: 90, preferredStart: null, preferredEnd: null })).toEqual({ duration: 90 })
    expect(suggestionParams({ duration: 90, preferredStart: '21:00', preferredEnd: '01:00' })).toEqual({
      duration: 90,
      preferredStart: '21:00',
      preferredEnd: '01:00',
    })
  })
})
