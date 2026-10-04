const { suggestWindows } = require('../../../src/scheduling/suggestWindows');
const {
  minuteOf,
  slotsBetween,
  dailySlots,
  member,
  freeAllWeek,
  required,
  times,
} = require('./weekHelpers');
const { referenceSuggest, windowSlots, seededRandom, randomGroup } = require('./reference');

const DURATIONS = [30, 60, 90, 120, 150, 180, 210, 240];

describe('suggestWindows', () => {
  describe('basic results', () => {
    test('nobody overlaps -> empty result', () => {
      const members = [
        member('ana', ['Mon 09:00', 'Mon 11:00']),
        member('ben', ['Tue 09:00', 'Tue 11:00']),
        member('cal', ['Wed 09:00', 'Wed 11:00']),
      ];

      expect(suggestWindows({ members, durationMinutes: 60 })).toEqual([]);
    });

    test('empty members list -> empty result', () => {
      expect(suggestWindows({ members: [], durationMinutes: 60 })).toEqual([]);
      expect(suggestWindows({ members: [], durationMinutes: 60, minAttendees: 1 })).toEqual([]);
    });

    test('everyone free all week -> earliest windows, back to back but not overlapping', () => {
      const result = suggestWindows({
        members: [freeAllWeek('ana'), freeAllWeek('ben')],
        durationMinutes: 60,
      });

      expect(times(result)).toEqual([
        ['Mon 00:00', 'Mon 01:00'],
        ['Mon 01:00', 'Mon 02:00'],
        ['Mon 02:00', 'Mon 03:00'],
      ]);
      expect(result[0]).toEqual({
        startMinuteOfWeek: 0,
        endMinuteOfWeek: 60,
        attendees: ['ana', 'ben'],
        missing: [],
        preferredMinutes: 0,
      });
    });

    test('returns at most `limit` suggestions, and fewer when fewer distinct windows exist', () => {
      const allFree = [freeAllWeek('ana'), freeAllWeek('ben')];
      expect(suggestWindows({ members: allFree, durationMinutes: 30, limit: 5 })).toHaveLength(5);

      const oneSharedHour = [member('ana', ['Mon 09:00', 'Mon 10:00']), member('ben', ['Mon 09:00', 'Mon 10:00'])];
      expect(suggestWindows({ members: oneSharedHour, durationMinutes: 60, limit: 3 })).toHaveLength(1);
    });
  });

  describe('required members and attendee filters', () => {
    test('a required member blocks an otherwise better window', () => {
      const ana = member('ana', ['Tue 18:00', 'Tue 20:00']);
      const others = [
        member('ben', ['Mon 09:00', 'Mon 10:00'], ['Tue 18:00', 'Tue 19:00']),
        member('cal', ['Mon 09:00', 'Mon 10:00']),
        member('dev', ['Mon 09:00', 'Mon 10:00']),
      ];

      // With nobody required, Monday wins: three people can make it.
      const optional = suggestWindows({ members: [ana, ...others], durationMinutes: 60 });
      expect(times(optional)[0]).toEqual(['Mon 09:00', 'Mon 10:00']);

      // Once ana is required, Monday is discarded even though more people are free then.
      const result = suggestWindows({ members: [required(ana), ...others], durationMinutes: 60 });
      expect(result).toEqual([
        {
          startMinuteOfWeek: minuteOf('Tue 18:00'),
          endMinuteOfWeek: minuteOf('Tue 19:00'),
          attendees: ['ana', 'ben'],
          missing: ['cal', 'dev'],
          preferredMinutes: 0,
        },
      ]);
    });

    test('a required member with no availability -> empty result', () => {
      const members = [required(member('ana')), freeAllWeek('ben'), freeAllWeek('cal')];

      expect(suggestWindows({ members, durationMinutes: 60 })).toEqual([]);
    });

    test('minAttendees drops windows with too few attendees', () => {
      const members = [
        member('ana', ['Mon 09:00', 'Mon 10:00'], ['Tue 09:00', 'Tue 10:00']),
        member('ben', ['Mon 09:00', 'Mon 10:00'], ['Tue 09:00', 'Tue 10:00']),
        member('cal', ['Mon 09:00', 'Mon 10:00']),
      ];

      expect(times(suggestWindows({ members, durationMinutes: 60 }))).toEqual([
        ['Mon 09:00', 'Mon 10:00'],
        ['Tue 09:00', 'Tue 10:00'],
      ]);
      expect(times(suggestWindows({ members, durationMinutes: 60, minAttendees: 3 }))).toEqual([
        ['Mon 09:00', 'Mon 10:00'],
      ]);
      expect(suggestWindows({ members, durationMinutes: 60, minAttendees: 4 })).toEqual([]);
    });

    test('by default a window needs two attendees; minAttendees: 1 allows solo windows', () => {
      const members = [member('ana', ['Mon 09:00', 'Mon 10:00'])];

      expect(suggestWindows({ members, durationMinutes: 60 })).toEqual([]);
      expect(times(suggestWindows({ members, durationMinutes: 60, minAttendees: 1 }))).toEqual([
        ['Mon 09:00', 'Mon 10:00'],
      ]);
    });
  });

  describe('durations and the circular week', () => {
    test('duration longer than any shared free block -> empty result', () => {
      // Each is free for 3 hours, but they only share 10:00-12:00.
      const members = [member('ana', ['Mon 09:00', 'Mon 12:00']), member('ben', ['Mon 10:00', 'Mon 13:00'])];

      expect(times(suggestWindows({ members, durationMinutes: 120 }))).toEqual([['Mon 10:00', 'Mon 12:00']]);
      expect(suggestWindows({ members, durationMinutes: 150 })).toEqual([]);
    });

    test('a window can wrap from Sunday night into Monday morning', () => {
      const members = [member('ana', ['Sun 23:00', 'Mon 01:00']), member('ben', ['Sun 23:00', 'Mon 01:00'])];

      const [only, ...rest] = suggestWindows({ members, durationMinutes: 120 });

      expect(rest).toEqual([]);
      expect(only.startMinuteOfWeek).toBe(minuteOf('Sun 23:00')); // 10020
      expect(only.endMinuteOfWeek).toBe(minuteOf('Mon 01:00')); // 60: end < start means it wraps
      expect(only.attendees).toEqual(['ana', 'ben']);
    });

    test('windows that overlap across the Sunday -> Monday boundary are never both returned', () => {
      // Shared block Sun 23:00 - Mon 02:00 fits 2h windows starting Sun 23:00, Sun 23:30 and Mon 00:00.
      // Every pair of those shares at least one Monday slot, so only one may be suggested.
      const members = [member('ana', ['Sun 23:00', 'Mon 02:00']), member('ben', ['Sun 23:00', 'Mon 02:00'])];

      // Earliest start wins the tie; the Sunday starts (slots 334, 335) overlap it through the wrap.
      expect(times(suggestWindows({ members, durationMinutes: 120 }))).toEqual([['Mon 00:00', 'Mon 02:00']]);

      // Preferring Sunday night flips which one wins, and Mon 00:00 is now the one dropped.
      const preferSunday = suggestWindows({
        members,
        durationMinutes: 120,
        preferredSlots: slotsBetween('Sun 22:00', 'Mon 00:00'),
      });
      expect(times(preferSunday)).toEqual([['Sun 23:00', 'Mon 01:00']]);
    });
  });

  describe('ranking', () => {
    test('ties are broken by earliest start, independent of member order', () => {
      const members = [
        member('ana', ['Tue 10:00', 'Tue 11:00'], ['Mon 18:00', 'Mon 19:00']),
        member('ben', ['Mon 18:00', 'Mon 19:00'], ['Tue 10:00', 'Tue 11:00']),
      ];

      const forwards = suggestWindows({ members, durationMinutes: 60 });
      const backwards = suggestWindows({ members: [...members].reverse(), durationMinutes: 60 });

      expect(times(forwards)).toEqual([
        ['Mon 18:00', 'Mon 19:00'],
        ['Tue 10:00', 'Tue 11:00'],
      ]);
      expect(times(backwards)).toEqual(times(forwards));
      expect(suggestWindows({ members, durationMinutes: 60 })).toEqual(forwards);
    });

    test('a preferred window changes the ranking, including partial overlap', () => {
      const members = ['ana', 'ben'].map((id) =>
        member(id, ['Mon 09:00', 'Mon 10:00'], ['Tue 15:30', 'Tue 16:30'], ['Wed 17:00', 'Wed 18:00'])
      );

      expect(times(suggestWindows({ members, durationMinutes: 60 }))).toEqual([
        ['Mon 09:00', 'Mon 10:00'],
        ['Tue 15:30', 'Tue 16:30'],
        ['Wed 17:00', 'Wed 18:00'],
      ]);

      // "Prefer 16:00-21:00": Wed is fully inside, Tue half inside, Mon not at all.
      const preferEvenings = suggestWindows({
        members,
        durationMinutes: 60,
        preferredSlots: dailySlots('16:00', '21:00'),
      });
      expect(times(preferEvenings)).toEqual([
        ['Wed 17:00', 'Wed 18:00'],
        ['Tue 15:30', 'Tue 16:30'],
        ['Mon 09:00', 'Mon 10:00'],
      ]);
      expect(preferEvenings.map((s) => s.preferredMinutes)).toEqual([60, 30, 0]);
    });

    test('attendance still outranks the preferred window', () => {
      const members = [
        member('ana', ['Mon 09:00', 'Mon 10:00'], ['Wed 17:00', 'Wed 18:00']),
        member('ben', ['Mon 09:00', 'Mon 10:00'], ['Wed 17:00', 'Wed 18:00']),
        member('cal', ['Mon 09:00', 'Mon 10:00']),
      ];

      const result = suggestWindows({
        members,
        durationMinutes: 60,
        preferredSlots: dailySlots('16:00', '21:00'),
      });

      expect(times(result)).toEqual([
        ['Mon 09:00', 'Mon 10:00'],
        ['Wed 17:00', 'Wed 18:00'],
      ]);
    });
  });

  describe('properties on random groups', () => {
    test('suggestions never overlap each other', () => {
      let suggestionsChecked = 0;

      for (let seed = 1; seed <= 60; seed++) {
        const rand = seededRandom(seed);
        const members = randomGroup(rand);

        for (const durationMinutes of DURATIONS) {
          const result = suggestWindows({ members, durationMinutes, limit: 10, minAttendees: 1 });
          const usedSlots = new Set();

          for (const suggestion of result) {
            for (const slot of windowSlots(suggestion.startMinuteOfWeek, durationMinutes)) {
              expect(usedSlots.has(slot)).toBe(false);
              usedSlots.add(slot);
            }
          }
          suggestionsChecked += result.length;
        }
      }

      // Guard against the test passing vacuously because the random groups produced nothing.
      expect(suggestionsChecked).toBeGreaterThan(2000);
    });

    test('matches a brute-force reference implementation', () => {
      let nonEmptyCases = 0;

      for (let seed = 1; seed <= 300; seed++) {
        const rand = seededRandom(seed);
        const input = {
          members: randomGroup(rand, { requiredChance: 0.15 }),
          durationMinutes: DURATIONS[Math.floor(rand() * DURATIONS.length)],
          limit: 1 + Math.floor(rand() * 5),
          minAttendees: 1 + Math.floor(rand() * 3),
          preferredSlots: rand() < 0.5 ? dailySlots('16:00', '21:00') : [],
        };

        const result = suggestWindows(input);
        expect(result).toEqual(referenceSuggest(input));
        if (result.length > 0) nonEmptyCases++;
      }

      expect(nonEmptyCases).toBeGreaterThan(150);
    });
  });

  describe('input validation', () => {
    const members = [freeAllWeek('ana'), freeAllWeek('ben')];

    test.each([
      [45, RangeError, 'durationMinutes must be a multiple of 30, got 45'],
      [100, RangeError, 'durationMinutes must be a multiple of 30, got 100'],
      [0, RangeError, 'durationMinutes must be between 30 and 240, got 0'],
      [15, RangeError, 'durationMinutes must be between 30 and 240, got 15'],
      [-30, RangeError, 'durationMinutes must be between 30 and 240, got -30'],
      [270, RangeError, 'durationMinutes must be between 30 and 240, got 270'],
      ['60', TypeError, 'durationMinutes must be a whole number of minutes, got "60"'],
      [NaN, TypeError, 'durationMinutes must be a whole number of minutes, got NaN'],
      [undefined, TypeError, 'durationMinutes must be a whole number of minutes, got undefined'],
    ])('durationMinutes %p -> %p', (durationMinutes, ErrorType, message) => {
      const run = () => suggestWindows({ members, durationMinutes });

      expect(run).toThrow(ErrorType);
      expect(run).toThrow(message);
    });

    test('rejects a limit or minAttendees below 1', () => {
      expect(() => suggestWindows({ members, durationMinutes: 60, limit: 0 })).toThrow(
        'limit must be a positive whole number, got 0'
      );
      expect(() => suggestWindows({ members, durationMinutes: 60, minAttendees: 0 })).toThrow(
        'minAttendees must be a positive whole number, got 0'
      );
    });

    test.each([336, -1, 1.5])('rejects free slot index %p, naming the member', (badSlot) => {
      const withBadSlot = [...members, { id: 'cal', required: false, freeSlots: [0, badSlot] }];

      expect(() => suggestWindows({ members: withBadSlot, durationMinutes: 60 })).toThrow(
        `member cal freeSlots has an invalid slot index: ${badSlot} (expected 0-335)`
      );
    });

    test('rejects a members value that is not an array', () => {
      expect(() => suggestWindows({ members: null, durationMinutes: 60 })).toThrow(TypeError);
    });
  });
});
