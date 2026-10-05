import { describe, expect, test } from 'vitest'
import { heatLevel, legendSteps, mostFreeStretch, pickMarks, slotPeople, slotsOfWindow } from './heat.js'
import { buildWeekGrid } from './grid.js'

describe('heatLevel', () => {
  test.each([
    [0, 3, 0],
    [1, 3, 1],
    [2, 3, 2],
    [3, 3, 4], // everyone who replied: the brightest step
    [1, 5, 1],
    [2, 5, 2],
    [3, 5, 2],
    [4, 5, 3],
    [5, 5, 4],
    [1, 1, 4],
    [0, 0, 0], // nobody has replied yet
  ])('%i free of %i replied -> level %i', (count, responded, level) => {
    expect(heatLevel(count, responded)).toBe(level)
  })

  test('never goes down as more people are free', () => {
    for (let responded = 1; responded <= 12; responded++) {
      for (let count = 1; count <= responded; count++) {
        expect(heatLevel(count, responded)).toBeGreaterThanOrEqual(heatLevel(count - 1, responded))
      }
    }
  })
})

describe('legendSteps', () => {
  test('small groups get one swatch per count', () => {
    expect(legendSteps(3)).toEqual([
      { level: 0, label: '0' },
      { level: 1, label: '1' },
      { level: 2, label: '2' },
      { level: 4, label: '3' },
    ])
  })

  test('bigger groups group the counts that share a step', () => {
    expect(legendSteps(10)).toEqual([
      { level: 0, label: '0' },
      { level: 1, label: '1–3' },
      { level: 2, label: '4–6' },
      { level: 3, label: '7–9' },
      { level: 4, label: '10' },
    ])
  })
})

test('slotsOfWindow covers each half hour and wraps past the end of the week', () => {
  expect(slotsOfWindow(540, 90)).toEqual([18, 19, 20])
  expect(slotsOfWindow(10050, 60)).toEqual([335, 0])
})

test('pickMarks puts each rank on its first slot and remembers which slots each covers', () => {
  const { rankAt, covered } = pickMarks([
    { startMinute: 1980, durationMinutes: 60 },
    { startMinute: 2040, durationMinutes: 60 },
  ])

  expect([...rankAt]).toEqual([[66, 1], [68, 2]])
  expect([...covered]).toEqual([[66, 1], [67, 1], [68, 2], [69, 2]])
})

test('slotPeople splits the members who replied into free and not free, keeping their order', () => {
  const olivia = { userId: 1, name: 'Olivia', required: true }
  const ana = { userId: 2, name: 'Ana', required: false }
  const ben = { userId: 3, name: 'Ben', required: true }

  expect(slotPeople([3, 1], [olivia, ana, ben])).toEqual({ free: [olivia, ben], notFree: [ana], blockedBy: [] })
})

test('slotPeople lists the required members who are not free as blocking the half hour', () => {
  const olivia = { userId: 1, name: 'Olivia', required: true }
  const ana = { userId: 2, name: 'Ana', required: false }
  const ben = { userId: 3, name: 'Ben', required: true }
  const cal = { userId: 4, name: 'Cal', required: true }

  // Ana is optional, so only Ben and Cal block it.
  expect(slotPeople([1], [olivia, ana, ben, cal]).blockedBy).toEqual([ben, cal])
})

describe('mostFreeStretch', () => {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  // 'Thu 14:00' (UTC) -> its slot index
  const slotAt = (label) => {
    const [day, time] = label.split(' ')
    const [hours, minutes] = time.split(':').map(Number)
    return (DAYS.indexOf(day) * 1440 + hours * 60 + minutes) / 30
  }
  // counts: { 'Thu 14:00': 4, ... } for single slots, everything else 0
  const week = (counts) => {
    const freeCounts = new Array(336).fill(0)
    for (const [label, count] of Object.entries(counts)) freeCounts[slotAt(label)] = count
    return freeCounts
  }
  const utc = buildWeekGrid('UTC')

  test('is null when nobody is free', () => {
    expect(mostFreeStretch(new Array(336).fill(0), utc)).toBeNull()
  })

  test('finds the longest stretch at the top count, not just the first top slot', () => {
    const counts = week({
      'Tue 10:00': 3,
      'Thu 14:00': 3, 'Thu 14:30': 3, 'Thu 15:00': 3,
      'Thu 15:30': 2, // a lower count ends the stretch
      'Fri 09:00': 2, 'Fri 09:30': 2, 'Fri 10:00': 2, 'Fri 10:30': 2, // longer, but fewer people
    })

    expect(mostFreeStretch(counts, utc)).toEqual({ startSlot: slotAt('Thu 14:00'), slots: 3, count: 3 })
  })

  test("breaks ties by what comes first on the viewer's own calendar", () => {
    // Sunday 23:00 UTC is Monday 04:30 in India, earlier than Monday 05:00 UTC (10:30 in India).
    const counts = week({ 'Mon 05:00': 2, 'Sun 23:00': 2 })

    expect(mostFreeStretch(counts, utc).startSlot).toBe(slotAt('Mon 05:00'))
    expect(mostFreeStretch(counts, buildWeekGrid('Asia/Kolkata')).startSlot).toBe(slotAt('Sun 23:00'))
  })

  test('follows a stretch from Sunday night into Monday', () => {
    const counts = week({ 'Sun 23:00': 2, 'Sun 23:30': 2, 'Mon 00:00': 2, 'Mon 00:30': 2 })

    expect(mostFreeStretch(counts, utc)).toEqual({ startSlot: slotAt('Sun 23:00'), slots: 4, count: 2 })
  })

  test('says "all week" when the top count holds every half hour', () => {
    expect(mostFreeStretch(new Array(336).fill(2), utc)).toEqual({ allWeek: true, count: 2 })
  })
})
