import { formatDay, formatTime } from '../time/week';
import { DAYS_PER_WEEK, moveCell, ROWS_PER_DAY } from './grid';
import { heatLevel } from './heat';

const DAYS = Array.from({ length: DAYS_PER_WEEK }, (_, day) => day);
const ROWS = Array.from({ length: ROWS_PER_DAY }, (_, row) => row);

// In the sideways layout (days down, times across) the arrow keys turn with the grid.
const SIDEWAYS_KEYS = { ArrowUp: 'ArrowLeft', ArrowDown: 'ArrowRight', ArrowLeft: 'ArrowUp', ArrowRight: 'ArrowDown' };

/**
 * The group heatmap: one cell per UTC slot, laid out and labelled in the viewer's time zone.
 * Each cell prints how many of the members who replied are free, and the brightness steps up with
 * the count (heatLevel), so the number, not the colour, carries the meaning.
 *
 * sideways: days as rows and the 48 half hours across (wide screens); otherwise days as columns.
 * Hovering, tapping or moving onto a cell with the keyboard reports it through onInspect/onPin.
 */
export default function HeatGrid({
  grid,
  slots,
  respondedCount,
  respondedIds,
  sessionSlots,
  pickRankAt,
  pickCovered,
  pinned,
  onInspect,
  onPin,
  sideways,
  describe,
}) {
  const cellFor = (day, row) => {
    const slot = grid.slotAt(day, row);
    const count = slots[slot].filter((id) => respondedIds.has(id)).length;
    const level = heatLevel(count, respondedCount);
    const classes = ['heat-cell', `heat-${level}`];
    if (sessionSlots.has(slot)) classes.push('heat-session');
    if (pickCovered.has(slot)) classes.push('heat-picked');
    if (pinned === slot) classes.push('heat-pinned');
    const rank = pickRankAt.get(slot);
    const isPinned = pinned === slot || (pinned === null && day === 0 && row === 36);
    return (
      <td
        key={`${day}-${row}`}
        role="gridcell"
        className={classes.join(' ')}
        data-slot={slot}
        data-day={day}
        data-row={row}
        tabIndex={isPinned ? 0 : -1}
        aria-label={describe(slot, count)}
        aria-selected={pinned === slot}
      >
        {count > 0 && <span className="heat-count">{count}</span>}
        {rank && <span className="heat-rank">{rank}</span>}
      </td>
    );
  };

  const slotFrom = (target) => {
    const cell = target?.closest?.('[data-slot]');
    return cell ? Number(cell.dataset.slot) : null;
  };

  function handleKeyDown(event) {
    const cell = event.target.closest?.('[data-slot]');
    if (!cell) return;
    const from = { day: Number(cell.dataset.day), row: Number(cell.dataset.row) };
    const next = moveCell(from, sideways ? (SIDEWAYS_KEYS[event.key] ?? event.key) : event.key);
    if (next.day === from.day && next.row === from.row) return;
    event.preventDefault();
    const target = event.currentTarget.querySelector(`[data-day="${next.day}"][data-row="${next.row}"]`);
    target?.focus();
  }

  const label = (row) => formatTime(grid.rowStartMinute(row));

  return (
    <table
      className={`heat-grid ${sideways ? 'heat-sideways' : 'heat-upright'}`}
      role="grid"
      aria-label="How many members are free in each half hour. Arrow keys move between half hours."
      onPointerOver={(event) => event.pointerType === 'mouse' && onInspect(slotFrom(event.target))}
      onPointerLeave={() => onInspect(null)}
      onClick={(event) => {
        const slot = slotFrom(event.target);
        if (slot !== null) onPin(slot);
      }}
      onFocus={(event) => {
        const slot = slotFrom(event.target);
        if (slot !== null) onPin(slot);
      }}
      onKeyDown={handleKeyDown}
    >
      {sideways ? (
        <>
          <thead>
            <tr>
              <td className="heat-corner" />
              {ROWS.filter((row) => row % 4 === 0).map((row) => (
                <th key={row} scope="colgroup" colSpan={4}>
                  {label(row)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <tr key={day}>
                <th scope="row">{formatDay(day * 1440)}</th>
                {ROWS.map((row) => cellFor(day, row))}
              </tr>
            ))}
          </tbody>
        </>
      ) : (
        <>
          <thead>
            <tr>
              <td className="heat-corner" />
              {DAYS.map((day) => (
                <th key={day} scope="col">
                  {formatDay(day * 1440)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row} className={row % 2 === 0 ? 'hour-start' : undefined}>
                <th scope="row" className={row % 2 === 0 ? 'time-label' : 'time-label time-label-half'}>
                  {label(row)}
                </th>
                {DAYS.map((day) => cellFor(day, row))}
              </tr>
            ))}
          </tbody>
        </>
      )}
    </table>
  );
}
