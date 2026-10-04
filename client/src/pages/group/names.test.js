import { expect, test } from 'vitest'
import { names } from './names.js'

const ana = { userId: 1, name: 'Ana' }
const ben = { userId: 2, name: 'Ben' }
const cal = { userId: 3, name: 'Cal' }

test('joins names into a sentence', () => {
  expect(names([])).toBe('')
  expect(names([ana])).toBe('Ana')
  expect(names([ana, ben])).toBe('Ana and Ben')
  expect(names([ana, ben, cal])).toBe('Ana, Ben and Cal')
})

test('lists the viewer first as "you"', () => {
  expect(names([ana], 1)).toBe('you')
  expect(names([ana, ben, cal], 2)).toBe('you, Ana and Cal')
  expect(names([ana, ben], 99)).toBe('Ana and Ben')
})
