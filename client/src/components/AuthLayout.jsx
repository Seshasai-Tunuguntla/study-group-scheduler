import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import WakeUpNote from './WakeUpNote';

const REPO_URL = 'https://github.com/Seshasai-Tunuguntla/study-group-scheduler';

// Public demo accounts, so visitors can try the app without signing up. The server rebuilds their
// data on start and when the demo is opened 30+ minutes after the last reset (server/src/demo).
const DEMO_ACCOUNTS = [
  { role: 'organizer', label: 'Try as organizer', email: 'demo-organizer@example.com', password: 'password123' },
  { role: 'member', label: 'Try as member', email: 'demo-member@example.com', password: 'password123' },
];

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

function DemoButtons() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [openingRole, setOpeningRole] = useState(null);
  const [error, setError] = useState('');

  async function tryDemo(account) {
    setError('');
    setOpeningRole(account.role);
    try {
      await login(account.email, account.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
      setOpeningRole(null);
    }
  }

  return (
    <section className="auth-demo" aria-labelledby="demo-heading">
      <h2 id="demo-heading" className="auth-demo-title">
        Try it without an account
      </h2>
      <div className="auth-demo-actions">
        {DEMO_ACCOUNTS.map((account, index) => (
          <button
            key={account.role}
            type="button"
            className={index === 0 ? 'btn' : 'btn-quiet'}
            disabled={openingRole !== null}
            onClick={() => tryDemo(account)}
          >
            {openingRole === account.role ? 'Opening demo…' : account.label}
          </button>
        ))}
      </div>
      <p className="auth-demo-note">
        Join a study group as Priya, its organizer in India, or Sam, a member in London. Change anything you like:
        the demo resets itself.
      </p>
      <div role="status">{openingRole && <WakeUpNote className="auth-demo-note" />}</div>
      {error && (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// The login/register frame: what the app does, the one-click demo, the form, then the details.
export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <section className="auth-intro">
        <h2 className="auth-title">Find the hour your whole study group can make.</h2>
        <p>
          Everyone marks when they're free each week. The app finds the times that work for the most people, never
          leaving out the ones who have to be there.
        </p>
      </section>
      <DemoButtons />
      <div className="panel auth-panel">{children}</div>
      <section className="auth-more" aria-label="About the app">
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
    </div>
  );
}
