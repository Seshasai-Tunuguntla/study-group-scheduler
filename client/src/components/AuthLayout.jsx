const REPO_URL = 'https://github.com/Seshasai-Tunuguntla/study-group-scheduler';

// A made-up week (7 days x 24 hours) for the decorative heatmap: brighter = more people free.
// Weekday evenings fill up, with one bright overlap mid-week, the way a real group's week tends to.
const TEASER = Array.from({ length: 7 }, (_, day) =>
  Array.from({ length: 24 }, (_, hour) => {
    if (day < 5 && hour >= 18 && hour <= 21) return day === 2 && hour >= 19 && hour <= 20 ? 4 : 1 + ((day + hour) % 3);
    if (day === 5 && hour >= 10 && hour <= 13) return hour === 11 ? 3 : 1;
    return 0;
  })
);

function HeatTeaser() {
  return (
    <div className="heat-teaser" aria-hidden="true">
      {TEASER.map((hours, day) => (
        <div className="heat-teaser-row" key={day}>
          {hours.map((level, hour) => (
            <i key={hour} className={level ? `l${level}` : undefined} />
          ))}
        </div>
      ))}
    </div>
  );
}

// The login/register frame: a short pitch with a glimpse of the heatmap, and the form.
// The one-click demo buttons join the pitch in phase 10, once the demo accounts exist.
export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <section className="auth-pitch">
        <h2 className="auth-title">Find the hour your whole study group can make.</h2>
        <p>
          Everyone marks when they're free each week. The app finds the times that work for the most people, never
          leaving out the ones who have to be there.
        </p>
        <HeatTeaser />
        <ul className="auth-points">
          <li>Drag across a weekly grid to mark when you're free</li>
          <li>See the best three times, and who can make each one</li>
          <li>Every time shown in your own time zone</li>
        </ul>
        <p className="auth-stack">
          Built with React, Node.js/Express, PostgreSQL and Prisma.{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            See the code on GitHub
          </a>
        </p>
      </section>
      <div className="panel auth-panel">{children}</div>
    </div>
  );
}
