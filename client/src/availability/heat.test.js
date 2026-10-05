import { describe, expect, test } from 'vitest'
import { heatLevel, legendSteps, pickMarks, slotPeople, slotsOfWindow } from './heat.js'

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
