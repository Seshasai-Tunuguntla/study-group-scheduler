const {
  normalizeRanges,
  splitAtWeekEnd,
  rangesToSlots,
  RangeOverlapError,
} = require('../../../src/scheduling/ranges');
const { minuteOf, slotsBetween } = require('./weekHelpers');

// range('Mon 09:00', 'Mon 10:00') -> { startMinute: 540, endMinute: 600 }. 'END' is Sunday 24:00.
const range = (from, to) => ({
  startMinute: minuteOf(from),
  endMinute: to === 'END' ? 10080 : minuteOf(to),
});

describe('splitAtWeekEnd', () => {
  test('leaves a normal range alone', () => {
    expect(splitAtWeekEnd(range('Mon 09:00', 'Mon 10:00'))).toEqual([range('Mon 09:00', 'Mon 10:00')]);
  });

  test('splits a Sunday-into-Monday range in two', () => {
    expect(splitAtWeekEnd(range('Sun 23:00', 'Mon 01:00'))).toEqual([
      range('Sun 23:00', 'END'), // [10020, 10080)
      range('Mon 00:00', 'Mon 01:00'), // [0, 60)
    ]);
  });

  test('an end of Monday 00:00 adds nothing on the Monday side', () => {
    expect(splitAtWeekEnd(range('Sun 22:00', 'Mon 00:00'))).toEqual([range('Sun 22:00', 'END')]);
  });
});

describe('normalizeRanges', () => {
  test('sorts by start time', () => {
    expect(normalizeRanges([range('Wed 09:00', 'Wed 10:00'), range('Mon 09:00', 'Mon 10:00')])).toEqual([
      range('Mon 09:00', 'Mon 10:00'),
      range('Wed 09:00', 'Wed 10:00'),
    ]);
  });

  test('merges ranges that touch', () => {
    const input = [range('Mon 10:00', 'Mon 11:00'), range('Mon 09:00', 'Mon 10:00'), range('Mon 11:00', 'Mon 11:30')];

    expect(normalizeRanges(input)).toEqual([range('Mon 09:00', 'Mon 11:30')]);
  });

  test('keeps ranges separate when there is a gap', () => {
    const input = [range('Mon 09:00', 'Mon 10:00'), range('Mon 10:30', 'Mon 11:00')];

    expect(normalizeRanges(input)).toEqual(input);
  });

  test('splits a wrap-around range and merges each piece with its neighbours', () => {
    const input = [
      range('Sun 21:00', 'Sun 23:00'),
      range('Sun 23:00', 'Mon 01:00'), // wraps
      range('Mon 01:00', 'Mon 02:00'),
    ];

    expect(normalizeRanges(input)).toEqual([
      range('Mon 00:00', 'Mon 02:00'),
      range('Sun 21:00', 'END'),
    ]);
  });

  test('never merges across the week boundary: a Sunday-to-Monday block stays two rows', () => {
    const input = [range('Mon 00:00', 'Mon 01:00'), range('Sun 23:00', 'END')];

    expect(normalizeRanges(input)).toHaveLength(2);
  });

  test('the whole week is one range', () => {
    expect(normalizeRanges([range('Mon 00:00', 'END')])).toEqual([{ startMinute: 0, endMinute: 10080 }]);
  });

  test('an empty list stays empty', () => {
    expect(normalizeRanges([])).toEqual([]);
  });

  test.each([
    ['partly', [range('Mon 09:00', 'Mon 10:00'), range('Mon 09:30', 'Mon 11:00')]],
    ['as duplicates', [range('Mon 09:00', 'Mon 10:00'), range('Mon 09:00', 'Mon 10:00')]],
    ['one inside another', [range('Mon 09:00', 'Mon 12:00'), range('Mon 10:00', 'Mon 11:00')]],
    ['through the week boundary', [range('Sun 23:00', 'Mon 01:00'), range('Mon 00:30', 'Mon 02:00')]],
  ])('rejects ranges that overlap %s', (_label, input) => {
    expect(() => normalizeRanges(input)).toThrow(RangeOverlapError);
  });

  test('names the overlapping ranges in the error', () => {
    expect(() => normalizeRanges([range('Mon 09:30', 'Mon 11:00'), range('Mon 09:00', 'Mon 10:00')])).toThrow(
      'ranges overlap: [540, 600) and [570, 660)'
    );
  });

  test('does not modify its input', () => {
    const input = [range('Mon 09:00', 'Mon 10:00'), range('Mon 10:00', 'Mon 11:00')];
    const copy = structuredClone(input);

    normalizeRanges(input);

    expect(input).toEqual(copy);
  });
});

describe('rangesToSlots', () => {
  test('lists every 30-minute slot a range covers', () => {
    expect(rangesToSlots([range('Mon 09:00', 'Mon 11:00')])).toEqual(slotsBetween('Mon 09:00', 'Mon 11:00'));
    expect(rangesToSlots([range('Mon 09:00', 'Mon 11:00')])).toEqual([18, 19, 20, 21]);
  });

  test('covers the last slots of the week', () => {
    expect(rangesToSlots([range('Sun 23:00', 'END')])).toEqual([334, 335]);
  });

  test('handles several ranges and none', () => {
    expect(rangesToSlots([range('Mon 00:00', 'Mon 00:30'), range('Sun 23:30', 'END')])).toEqual([0, 335]);
    expect(rangesToSlots([])).toEqual([]);
  });
});
