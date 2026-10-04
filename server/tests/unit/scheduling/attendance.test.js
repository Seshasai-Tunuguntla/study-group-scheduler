const { whoCanAttend } = require('../../../src/scheduling/attendance');
const { member, minuteOf } = require('./weekHelpers');

test('splits members into who is free for the whole window and who is not, keeping their order', () => {
  const members = [
    member('ana', ['Mon 09:00', 'Mon 11:00']),
    member('ben', ['Mon 09:30', 'Mon 11:00']), // misses the first half hour
    member('cal'), // never free
    member('dev', ['Mon 08:00', 'Mon 10:00']),
  ];

  expect(whoCanAttend({ members, startMinute: minuteOf('Mon 09:00'), durationMinutes: 60 })).toEqual({
    attendees: ['ana', 'dev'],
    missing: ['ben', 'cal'],
  });
});

test('handles a window that wraps from Sunday night into Monday', () => {
  const members = [
    member('ana', ['Sun 22:00', 'Mon 02:00']),
    member('ben', ['Sun 22:00', 'Mon 00:00']), // free until midnight only
  ];

  expect(whoCanAttend({ members, startMinute: minuteOf('Sun 23:00'), durationMinutes: 120 })).toEqual({
    attendees: ['ana'],
    missing: ['ben'],
  });
});

test('nobody to check -> nobody attends', () => {
  expect(whoCanAttend({ members: [], startMinute: 0, durationMinutes: 30 })).toEqual({ attendees: [], missing: [] });
});
