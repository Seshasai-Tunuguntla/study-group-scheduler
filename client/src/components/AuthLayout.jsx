const REPO_URL = 'https://github.com/Seshasai-Tunuguntla/study-group-scheduler';

// The two-column login/register frame from the Landlord project: a brand panel and the form.
// The one-click demo buttons join the brand panel in phase 10, once the demo accounts exist.
export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <section className="auth-brand">
        <h2 className="auth-brand-title">Find the hour your whole study group can make.</h2>
        <p>
          Everyone marks when they're free each week. The app finds the times that work for the most people,
          never leaving out the ones who have to be there.
        </p>
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
