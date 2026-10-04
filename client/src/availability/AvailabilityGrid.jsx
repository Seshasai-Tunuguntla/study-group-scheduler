import { useRef, useState } from 'react';
import { formatDay, formatTime } from '../time/week';
import {
  applyToSlots,
  dragMode,
  DAYS_PER_WEEK,
  moveCell,
  ROWS_PER_DAY,
  slotsInRectangle,
  toggleSlot,
} from './grid';

const DAY_INDEXES = Array.from({ length: DAYS_PER_WEEK }, (_, day) => day);
const ROW_INDEXES = Array.from({ length: ROWS_PER_DAY }, (_, row) => row);
const TAP_SLOP_PX = 10;

// A finger that moves further than this between down and up was scrolling, not tapping.
const isTap = (start, event) => Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_SLOP_PX;

const cellFrom = (element) => {
  const cell = element?.closest?.('[data-day]');
  return cell ? { day: Number(cell.dataset.day), row: Number(cell.dataset.row) } : null;
};

/**
 * The weekly grid: one cell per UTC slot, laid out and labelled in the user's time zone by `grid`.
 *
 * Mouse, pen and touch all go through the same pointer events:
 * - Mouse/pen: press and drag paints the rectangle between the first and current cell. The first
 *   cell decides whether the drag marks free or clears (see dragMode).
 * - Touch: the grid normally lets the page scroll, so a finger swipe scrolls and a tap toggles one
 *   cell. With `touchPaint` on, the grid stops scrolling (touch-action: none) and a finger drags
 *   exactly like a mouse.
 * - Keyboard: arrow keys move, Space or Enter toggles.
 */
export default function AvailabilityGrid({ grid, selection, onChange, touchPaint, locale }) {
  const [drag, setDrag] = useState(null); // { pointerId, start, current, mode }
  const [focusCell, setFocusCell] = useState({ day: 0, row: 36 });
  const tap = useRef(null); // { pointerId, cell, x, y } for a touch that may turn out to be a tap
  const tableRef = useRef(null);

  const preview = drag
    ? applyToSlots(selection, slotsInRectangle(grid, drag.start, drag.current), drag.mode)
    : selection;

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    const cell = cellFrom(event.target);
    if (!cell) return;
    setFocusCell(cell);

    if (event.pointerType === 'touch' && !touchPaint) {
      // Wait for pointerup: if the finger moved (or the browser took over to scroll and sent
      // pointercancel), it wasn't a tap.
      tap.current = { pointerId: event.pointerId, cell, x: event.clientX, y: event.clientY };
      return;
    }

    event.preventDefault(); // no text selection while dragging
    try {
      // Keeps pointermove/pointerup coming to the grid even if the pointer leaves it mid-drag.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer already ended (a very quick tap): the drag still works for this press.
    }
    const mode = dragMode(selection, grid.slotAt(cell.day, cell.row));
    setDrag({ pointerId: event.pointerId, start: cell, current: cell, mode });
  }

  function handlePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // With pointer capture the event target stays the table, so find the cell under the pointer.
    const cell = cellFrom(document.elementFromPoint(event.clientX, event.clientY));
    if (cell && (cell.day !== drag.current.day || cell.row !== drag.current.row)) {
      setDrag({ ...drag, current: cell });
    }
  }

  function handlePointerUp(event) {
    const pendingTap = tap.current;
    if (pendingTap && pendingTap.pointerId === event.pointerId) {
      tap.current = null;
      if (isTap(pendingTap, event)) {
        onChange(toggleSlot(selection, grid.slotAt(pendingTap.cell.day, pendingTap.cell.row)));
      }
      return;
    }
    if (drag && event.pointerId === drag.pointerId) {
      onChange(preview);
      setDrag(null);
    }
  }

  function handlePointerCancel(event) {
    if (tap.current?.pointerId === event.pointerId) tap.current = null;
    if (drag?.pointerId === event.pointerId) setDrag(null);
  }

  function handleKeyDown(event) {
    const cell = cellFrom(event.target);
    if (!cell) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onChange(toggleSlot(selection, grid.slotAt(cell.day, cell.row)));
      return;
    }
    const next = moveCell(cell, event.key);
    if (next.day === cell.day && next.row === cell.row) return;
    event.preventDefault();
    setFocusCell(next);
    tableRef.current.querySelector(`[data-day="${next.day}"][data-row="${next.row}"]`)?.focus();
  }

  return (
    <table
      ref={tableRef}
      className={`week-grid${touchPaint ? ' week-grid-paint' : ''}${drag ? ' is-dragging' : ''}`}
      role="grid"
      aria-label="Weekly availability. Arrow keys move, Space marks a half hour free or not."
      aria-multiselectable="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <thead>
        <tr>
          <td className="week-grid-corner" />
          {DAY_INDEXES.map((day) => (
            <th key={day} scope="col">
              {formatDay(day * 24 * 60, { locale })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROW_INDEXES.map((row) => {
          const startMinute = grid.rowStartMinute(row);
          const time = formatTime(startMinute, { locale });
          const onTheHour = row % 2 === 0;
          return (
            <tr key={row} className={onTheHour ? 'hour-start' : undefined}>
              <th scope="row" className={onTheHour ? 'time-label' : 'time-label time-label-half'}>
                {time}
              </th>
              {DAY_INDEXES.map((day) => {
                const slot = grid.slotAt(day, row);
                const free = preview.has(slot);
                const changing = drag !== null && free !== selection.has(slot);
                const focused = focusCell.day === day && focusCell.row === row;
                return (
                  <td
                    key={day}
                    role="gridcell"
                    data-day={day}
                    data-row={row}
                    tabIndex={focused ? 0 : -1}
                    aria-selected={free}
                    aria-label={`${formatDay(day * 24 * 60, { locale, style: 'long' })} ${time}`}
                    className={`cell${free ? ' cell-free' : ''}${changing ? ' cell-changing' : ''}`}
                  />
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
