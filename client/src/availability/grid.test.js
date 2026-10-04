import { describe, expect, test } from 'vitest'
import {
  applyToSlots,
  buildWeekGrid,
  copyDay,
  dragMode,
  moveCell,
  rangesFromSlots,
  sameSlots,
  slotsFromRanges,
  slotsInRectangle,
  toggleSlot,
} from './grid.js'

const WINTER = new Date('2026-01-15T12:00:00Z')
const SUMMER = new Date('2026-07-15T12:00:00Z')

// 'Sun 18:30' -> UTC slot index
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const utcSlot = (label) => {
  const [day, time] = label.split(' ')
  const [h, m] = time.split(':').map(Number)
  return (DAYS.indexOf(day) * 1440 + h * 60 + m) / 30
}

describe('buildWeekGrid', () => {
  test.each([
    ['UTC', WINTER],
    ['Asia/Kolkata', WINTER],
    ['Asia/Kathmandu', WINTER],
    ['America/New_York', WINTER],
    ['America/New_York', SUMMER],
    ['Asia/Tokyo', WINTER],
    ['Pacific/Chatham', WINTER], // +13:45
  ])('in %s every UTC slot appears in exactly one cell, and back again', (timeZone, at) => {
    const grid = buildWeekGrid(timeZone, at)
    const seen = new Set()

    for (let day = 0; day < 7; day++) {
      for (let row = 0; row < 48; row++) {
        const slot = grid.slotAt(day, row)
        expect(Number.isInteger(slot)).toBe(true)
        expect(grid.cellOf(slot)).toEqual({ day, row })
        seen.add(slot)
      }
    }
    expect(seen.size).toBe(336)
  })

  test('in UTC the grid is the plain week', () => {
    const grid = buildWeekGrid('UTC', WINTER)

    expect(grid.slotAt(0, 0)).toBe(0)
    expect(grid.slotAt(6, 47)).toBe(335)
    expect(grid.rowStartMinute(18)).toBe(9 * 60)
  })

  test("local Monday needn't be UTC Monday", () => {
    // Monday 00:00 in India is Sunday 18:30 UTC; in Tokyo it's Sunday 15:00 UTC.
    expect(buildWeekGrid('Asia/Kolkata', WINTER).slotAt(0, 0)).toBe(utcSlot('Sun 18:30'))
    expect(buildWeekGrid('Asia/Tokyo', WINTER).slotAt(0, 0)).toBe(utcSlot('Sun 15:00'))
    // Monday 00:00 in New York is 05:00 UTC in winter, 04:00 in summer.
    expect(buildWeekGrid('America/New_York', WINTER).slotAt(0, 0)).toBe(utcSlot('Mon 05:00'))
    expect(buildWeekGrid('America/New_York', SUMMER).slotAt(0, 0)).toBe(utcSlot('Mon 04:00'))
  })

  test('a UTC slot late on Sunday shows on local Monday when the zone is ahead', () => {
    expect(buildWeekGrid('Asia/Kolkata', WINTER).cellOf(utcSlot('Sun 20:00'))).toEqual({ day: 0, row: 3 }) // Mon 01:30
  })

  test('in a +05:45 zone rows are labelled :15 and :45, and still map one-to-one to UTC slots', () => {
    const grid = buildWeekGrid('Asia/Kathmandu', WINTER)

    expect(grid.rowShift).toBe(15)
    expect(grid.rowStartMinute(0)).toBe(15) // 00:15
    expect(grid.rowStartMinute(1)).toBe(45) // 00:45
    // Local Monday 09:15 is 03:30 UTC.
    expect(grid.slotAt(0, 18)).toBe(utcSlot('Mon 03:30'))
  })
})

describe('slotsFromRanges / rangesFromSlots', () => {
  test('turn stored ranges into slots and back', () => {
    const ranges = [
      { startMinute: 540, endMinute: 660 },
      { startMinute: 1980, endMinute: 2010 },
    ]

    const slots = slotsFromRanges(ranges)

    expect([...slots].sort((a, b) => a - b)).toEqual([18, 19, 20, 21, 66])
    expect(rangesFromSlots(slots)).toEqual(ranges)
  })

  test('merge touching slots into one range, in order', () => {
    expect(rangesFromSlots(new Set([21, 18, 20, 19]))).toEqual([{ startMinute: 540, endMinute: 660 }])
  })

  test('never wrap past the end of the week: a Sunday-into-Monday block is two ranges', () => {
    expect(rangesFromSlots(new Set([334, 335, 0, 1]))).toEqual([
      { startMinute: 0, endMinute: 60 },
      { startMinute: 10020, endMinute: 10080 },
    ])
  })

  test('the whole week is one range, nothing is no ranges', () => {
    expect(rangesFromSlots(new Set(Array.from({ length: 336 }, (_, i) => i)))).toEqual([
      { startMinute: 0, endMinute: 10080 },
    ])
    expect(rangesFromSlots(new Set())).toEqual([])
  })
})

describe('dragging', () => {
  test('the first cell pressed decides whether the drag adds or removes', () => {
    const selection = new Set([18])

    expect(dragMode(selection, 18)).toBe('remove')
    expect(dragMode(selection, 19)).toBe('add')
  })

  test('selects the rectangle between two cells, whichever way the drag went', () => {
    const grid = buildWeekGrid('UTC', WINTER)
    const monToWed18to19 = [
      utcSlot('Mon 18:00'), utcSlot('Mon 18:30'), utcSlot('Mon 19:00'),
      utcSlot('Tue 18:00'), utcSlot('Tue 18:30'), utcSlot('Tue 19:00'),
      utcSlot('Wed 18:00'), utcSlot('Wed 18:30'), utcSlot('Wed 19:00'),
    ]

    const downRight = slotsInRectangle(grid, { day: 0, row: 36 }, { day: 2, row: 38 })
    const upLeft = slotsInRectangle(grid, { day: 2, row: 38 }, { day: 0, row: 36 })

    expect(downRight.sort((a, b) => a - b)).toEqual(monToWed18to19)
    expect(upLeft.sort((a, b) => a - b)).toEqual(monToWed18to19)
  })

  test("a rectangle in a zone ahead of UTC can cross UTC's week boundary", () => {
    const grid = buildWeekGrid('Asia/Kolkata', WINTER)

    // Local Monday 00:00-01:00 is UTC Sunday 18:30-19:30.
    expect(slotsInRectangle(grid, { day: 0, row: 0 }, { day: 0, row: 1 })).toEqual([
      utcSlot('Sun 18:30'),
      utcSlot('Sun 19:00'),
    ])
  })

  test('applyToSlots adds or removes without touching the original', () => {
    const selection = new Set([1, 2])

    expect([...applyToSlots(selection, [2, 3], 'add')].sort()).toEqual([1, 2, 3])
    expect([...applyToSlots(selection, [2, 3], 'remove')]).toEqual([1])
    expect([...selection]).toEqual([1, 2])
  })

  test('toggleSlot flips one cell', () => {
    expect(toggleSlot(new Set([5]), 5).has(5)).toBe(false)
    expect(toggleSlot(new Set(), 5).has(5)).toBe(true)
  })
})

describe('copyDay', () => {
  test("copies Monday's pattern onto Tuesday to Friday, replacing theirs, weekend untouched", () => {
    const grid = buildWeekGrid('UTC', WINTER)
    const selection = new Set([
      utcSlot('Mon 18:00'), utcSlot('Mon 18:30'),
      utcSlot('Tue 09:00'), // replaced: Monday has nothing at 09:00
      utcSlot('Sat 10:00'), // untouched
    ])

    const next = copyDay(selection, grid)

    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      expect(next.has(utcSlot(`${day} 18:00`))).toBe(true)
      expect(next.has(utcSlot(`${day} 18:30`))).toBe(true)
    }
    expect(next.has(utcSlot('Tue 09:00'))).toBe(false)
    expect(next.has(utcSlot('Sat 10:00'))).toBe(true)
    expect(next.size).toBe(11)
  })

  test("copies by local day, so in India Monday evening lands on each weekday evening", () => {
    const grid = buildWeekGrid('Asia/Kolkata', WINTER)
    const mondayEvening = new Set([grid.slotAt(0, 36)]) // local Mon 18:00 = 12:30 UTC

    const next = copyDay(mondayEvening, grid)

    expect([...next].sort((a, b) => a - b)).toEqual(
      ['Mon 12:30', 'Tue 12:30', 'Wed 12:30', 'Thu 12:30', 'Fri 12:30'].map(utcSlot)
    )
  })
})

test('sameSlots compares contents, not identity', () => {
  expect(sameSlots(new Set([1, 2]), new Set([2, 1]))).toBe(true)
  expect(sameSlots(new Set([1, 2]), new Set([1]))).toBe(false)
  expect(sameSlots(new Set([1, 2]), new Set([1, 3]))).toBe(false)
})

test('moveCell moves with the arrow keys and stops at the edges', () => {
  expect(moveCell({ day: 0, row: 0 }, 'ArrowUp')).toEqual({ day: 0, row: 0 })
  expect(moveCell({ day: 0, row: 0 }, 'ArrowDown')).toEqual({ day: 0, row: 1 })
  expect(moveCell({ day: 6, row: 47 }, 'ArrowRight')).toEqual({ day: 6, row: 47 })
  expect(moveCell({ day: 3, row: 10 }, 'ArrowLeft')).toEqual({ day: 2, row: 10 })
})
