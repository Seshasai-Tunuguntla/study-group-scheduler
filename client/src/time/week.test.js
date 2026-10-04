import { describe, expect, test } from 'vitest'
import {
  formatCountdown,
  formatDuration,
  formatOffset,
  formatWindow,
  minutesUntilNext,
  toLocalMinute,
  utcMinuteOfWeek,
  utcOffsetMinutes,
} from './week.js'

const WINTER = new Date('2026-01-15T12:00:00Z')
const SUMMER = new Date('2026-07-15T12:00:00Z')

// 'Wed 18:00' -> minutes since Monday 00:00
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const minuteOf = (label) => {
  const [day, time] = label.split(' ')
  const [h, m] = time.split(':').map(Number)
  return DAYS.indexOf(day) * 1440 + h * 60 + m
}

describe('utcOffsetMinutes', () => {
  test.each([
    ['UTC', WINTER, 0],
    ['Asia/Kolkata', WINTER, 330],
    ['Asia/Kathmandu', WINTER, 345],
    ['America/New_York', WINTER, -300],
    ['America/New_York', SUMMER, -240],
  ])('%s -> %i', (timeZone, at, expected) => {
    expect(utcOffsetMinutes(timeZone, at)).toBe(expected)
  })
})

describe('toLocalMinute', () => {
  test('shifts by the zone offset', () => {
    expect(toLocalMinute(minuteOf('Mon 10:30'), 'Asia/Kolkata', WINTER)).toBe(minuteOf('Mon 16:00'))
  })

  test('wraps backwards into Sunday for zones behind UTC', () => {
    expect(toLocalMinute(minuteOf('Mon 02:00'), 'America/New_York', WINTER)).toBe(minuteOf('Sun 21:00'))
  })

  test('wraps forwards into Monday for zones ahead of UTC', () => {
    expect(toLocalMinute(minuteOf('Sun 20:00'), 'Asia/Tokyo', WINTER)).toBe(minuteOf('Mon 05:00'))
  })

  test('follows DST: the same UTC time is an hour later locally in summer', () => {
    expect(toLocalMinute(minuteOf('Wed 22:00'), 'America/New_York', WINTER)).toBe(minuteOf('Wed 17:00'))
    expect(toLocalMinute(minuteOf('Wed 22:00'), 'America/New_York', SUMMER)).toBe(minuteOf('Wed 18:00'))
  })
})

describe('formatWindow', () => {
  const gb = { at: WINTER, locale: 'en-GB' }

  test('shows the day and both times in the user zone', () => {
    expect(formatWindow(minuteOf('Mon 09:00'), 60, 'UTC', gb)).toBe('Mon 09:00 – 10:00')
    expect(formatWindow(minuteOf('Mon 10:30'), 60, 'Asia/Kolkata', gb)).toBe('Mon 16:00 – 17:00')
  })

  test('names both days when the window runs past midnight, including Sunday into Monday', () => {
    expect(formatWindow(minuteOf('Sun 23:00'), 120, 'UTC', gb)).toBe('Sun 23:00 – Mon 01:00')
    expect(formatWindow(minuteOf('Tue 23:30'), 60, 'UTC', gb)).toBe('Tue 23:30 – Wed 00:30')
  })

  test('a window ending exactly at midnight reads as the same evening', () => {
    expect(formatWindow(minuteOf('Fri 22:00'), 120, 'UTC', gb)).toBe('Fri 22:00 – 00:00')
  })

  test('a UTC time can land on a different local day', () => {
    // Monday 02:00 UTC is still Sunday evening in New York.
    expect(formatWindow(minuteOf('Mon 02:00'), 60, 'America/New_York', gb)).toBe('Sun 21:00 – 22:00')
  })

  test("uses the locale's clock", () => {
    expect(formatWindow(minuteOf('Mon 18:00'), 90, 'UTC', { at: WINTER, locale: 'en-US' })).toBe(
      'Mon 6:00 PM – 7:30 PM'
    )
  })

  test('can spell out the day', () => {
    expect(formatWindow(minuteOf('Wed 18:00'), 60, 'UTC', { ...gb, dayStyle: 'long' })).toBe('Wednesday 18:00 – 19:00')
  })
})

describe('minutesUntilNext', () => {
  const mondayMorning = new Date('2026-10-05T08:00:00Z') // a Monday

  test('counts forward to the next occurrence in the week', () => {
    expect(utcMinuteOfWeek(mondayMorning)).toBe(minuteOf('Mon 08:00'))
    expect(minutesUntilNext(minuteOf('Mon 09:00'), mondayMorning)).toBe(60)
    expect(minutesUntilNext(minuteOf('Wed 08:00'), mondayMorning)).toBe(2 * 1440)
  })

  test('a time earlier in the week comes round next week', () => {
    expect(minutesUntilNext(minuteOf('Mon 07:00'), mondayMorning)).toBe(7 * 1440 - 60)
  })

  test('is 0 right at the start', () => {
    expect(minutesUntilNext(minuteOf('Mon 08:00'), mondayMorning)).toBe(0)
  })
})

test.each([
  [30, '30 min'],
  [60, '1 hour'],
  [90, '1 h 30 min'],
  [120, '2 hours'],
  [240, '4 hours'],
])('formatDuration(%i) -> %s', (minutes, text) => {
  expect(formatDuration(minutes)).toBe(text)
})

test.each([
  [0, 'now'],
  [45, 'in 45 min'],
  [60, 'in 1 hour'],
  [300, 'in 5 hours'],
  [1440, 'in 1 day'],
  [3 * 1440 + 100, 'in 3 days'],
])('formatCountdown(%i) -> %s', (minutes, text) => {
  expect(formatCountdown(minutes)).toBe(text)
})

test('formatOffset', () => {
  expect(formatOffset('Asia/Kolkata', WINTER)).toBe('GMT+05:30')
  expect(formatOffset('America/New_York', WINTER)).toBe('GMT-05:00')
  expect(formatOffset('UTC', WINTER)).toBe('GMT')
})
