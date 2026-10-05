import { Fragment, useMemo } from 'react';
import { formatDay, formatWindow, MINUTES_PER_DAY, SLOT_MINUTES } from '../time/week';
import { buildWeekGrid, DAYS_PER_WEEK, ROWS_PER_DAY } from './grid';
import { heatLevel, mostFreeStretch } from './heat';

const DAYS = Array.from({ length: DAYS_PER_WEEK }, (_, day) => day);
const ROWS = Array.from({ length: ROWS_PER_DAY }, (_, row) => row);

// What the grid shows, in words: the caption is the mini heatmap's text alternative.
function caption({ respondedCount, freeCounts }, grid, timeZone) {
  if (respondedCount === 0) return 'Nobody has filled in their week yet';
  const stretch = mostFreeStretch(freeCounts, grid);
  if (!stretch) return 'No free time marked yet';
  const outOf = `${stretch.count} of ${respondedCount}`;
  if (stretch.allWeek) return `${outOf} free all week`;
  return `Most free: ${formatWindow(stretch.startSlot * SLOT_MINUTES, stretch.slots * SLOT_MINUTES, timeZone)} (${outOf})`;
}

// A group's week at a glance on the dashboard: one small cell per half hour, a row per day, laid
// out in the viewer's zone with the same brightness steps as the group heatmap. Too small to read
// counts from, so it's hidden from screen readers and the caption says what matters.
export default function MiniHeat({ heat, timeZone }) {
  const grid = useMemo(() => buildWeekGrid(timeZone), [timeZone]);

  return (
    <figure className="mini-heat">
      <div className="mini-heat-grid" aria-hidden="true">
        {DAYS.map((day) => (
          <Fragment key={day}>
            <span className="mini-heat-day">{formatDay(day * MINUTES_PER_DAY).slice(0, 2)}</span>
            {ROWS.map((row) => {
              const level = heatLevel(heat.freeCounts[grid.slotAt(day, row)], heat.respondedCount);
              return <i key={row} className={level ? `l${level}` : undefined} />;
            })}
          </Fragment>
        ))}
      </div>
      <figcaption>{caption(heat, grid, timeZone)}</figcaption>
    </figure>
  );
}
