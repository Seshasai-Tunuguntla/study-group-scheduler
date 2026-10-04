const {
  preferredWindowSlots,
  utcOffsetMinutes,
  parseTimeOfDay,
  localHoursShiftMinutes,
} = require('../../../src/scheduling/preferredWindow');
const { dailySlots, slotOf } = require('./weekHelpers');

const WINTER = new Date('2026-01-15T12:00:00Z');
const SUMMER = new Date('2026-07-15T12:00:00Z');

// The same hours every day, written in UTC, as sorted slot indexes.
const utcEveryDay = (from, to) => dailySlots(from, to).sort((a, b) => a - b);

const preferred = (start, end, timeZone, at = WINTER) =>
  preferredWindowSlots({
    startMinuteOfDay: parseTimeOfDay(start),
    endMinuteOfDay: parseTimeOfDay(end),
    timeZone,
    at,
  });

describe('utcOffsetMinutes', () => {
  test.each([
    ['UTC', WINTER, 0],
    ['Asia/Kolkata', WINTER, 330],
    ['Asia/Kathmandu', WINTER, 345],
    ['America/New_York', WINTER, -300],
    ['America/New_York', SUMMER, -240],
    // POSIX-style names have the sign reversed: Etc/GMT+5 is five hours *behind* UTC.
    ['Etc/GMT+5', WINTER, -300],
  ])('%s at %s -> %i minutes', (timeZone, at, expected) => {
    expect(utcOffsetMinutes(timeZone, at)).toBe(expected);
  });
});

describe('preferredWindowSlots', () => {
  test('applies the same hours to all seven days', () => {
    const slots = preferred('16:00', '21:00', 'UTC');

    expect(slots).toHaveLength(7 * 10); // 5 hours = 10 slots, every day
    expect(slots).toEqual(utcEveryDay('16:00', '21:00'));
    expect(slots).toContain(slotOf('Mon 16:00'));
    expect(slots).toContain(slotOf('Sun 20:30'));
  });

  test("converts from the zone's local time to UTC (Asia/Kolkata, +05:30)", () => {
    // 16:00-21:00 in India is 10:30-15:30 UTC.
    expect(preferred('16:00', '21:00', 'Asia/Kolkata')).toEqual(utcEveryDay('10:30', '15:30'));
  });

  test('a window that ends before it starts crosses midnight, and Sunday night runs into Monday', () => {
    const slots = preferred('21:00', '01:00', 'UTC');

    expect(slots).toHaveLength(7 * 8);
    expect(slots).toEqual(utcEveryDay('21:00', '01:00'));
    expect(slots).toContain(slotOf('Tue 00:30')); // Monday night's window, after midnight
    expect(slots).toContain(slotOf('Mon 00:30')); // Sunday night's window wraps to the week start
    expect(slots).not.toContain(slotOf('Mon 01:00'));
  });

  test('local early morning in a zone ahead of UTC lands on the previous UTC day (Asia/Tokyo, +09:00)', () => {
    // Monday 00:00-02:00 in Tokyo is Sunday 15:00-17:00 UTC: the week wraps backwards.
    const slots = preferred('00:00', '02:00', 'Asia/Tokyo');

    expect(slots).toEqual(utcEveryDay('15:00', '17:00'));
    expect(slots).toContain(slotOf('Sun 15:00'));
  });

  test('uses the offset in force at the given moment, so DST moves it by an hour (America/New_York)', () => {
    expect(preferred('16:00', '21:00', 'America/New_York', WINTER)).toEqual(utcEveryDay('21:00', '02:00'));
    expect(preferred('16:00', '21:00', 'America/New_York', SUMMER)).toEqual(utcEveryDay('20:00', '01:00'));
  });

  test('in a +05:45 zone, only slots the window fully covers count (Asia/Kathmandu)', () => {
    // 16:00-21:00 local is 10:15-15:15 UTC: the 10:00 and 15:00 UTC slots are only half covered.
    expect(preferred('16:00', '21:00', 'Asia/Kathmandu')).toEqual(utcEveryDay('10:30', '15:00'));
  });

  test('an empty window is an error', () => {
    expect(() => preferred('16:00', '16:00', 'UTC')).toThrow('the preferred window must not be empty');
  });
});

describe('localHoursShiftMinutes', () => {
  test.each([
    ['Asia/Kolkata', 'Asia/Tokyo', WINTER, -210], // 18:00 IST = 12:30 UTC, 18:00 JST = 09:00 UTC
    ['Asia/Tokyo', 'Asia/Kolkata', WINTER, 210],
    ['Asia/Kolkata', 'Asia/Calcutta', WINTER, 0], // same zone, old name
    ['UTC', 'America/New_York', WINTER, 300],
    ['UTC', 'America/New_York', SUMMER, 240], // uses the offsets in force at the moment
    ['America/St_Johns', 'UTC', WINTER, -210], // -03:30: a half hour, but not a tie
  ])('%s -> %s at %s: %i minutes', (from, to, at, expected) => {
    expect(localHoursShiftMinutes(from, to, at)).toBe(expected);
  });

  describe('exact ties (zones 15 or 45 minutes apart) round toward zero', () => {
    test.each([
      // India (+05:30) and Nepal (+05:45) are exactly 15 minutes apart: half way between 0 and 30.
      ['Asia/Kolkata', 'Asia/Kathmandu', 0],
      ['Asia/Kathmandu', 'Asia/Kolkata', 0],
      // UTC and Nepal are 345 minutes apart: half way between 330 and 360, so 330.
      ['UTC', 'Asia/Kathmandu', -330],
      ['Asia/Kathmandu', 'UTC', 330],
    ])('%s -> %s: %i minutes', (from, to, expected) => {
      expect(localHoursShiftMinutes(from, to, WINTER)).toBe(expected);
    });
  });

  test('switching there and back always cancels out, ties included', () => {
    const zones = ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tokyo', 'America/New_York', 'Pacific/Chatham', 'America/St_Johns'];
    for (const a of zones) {
      for (const b of zones) {
        expect(localHoursShiftMinutes(a, b, WINTER) + localHoursShiftMinutes(b, a, WINTER)).toBe(0);
      }
    }
  });
});
