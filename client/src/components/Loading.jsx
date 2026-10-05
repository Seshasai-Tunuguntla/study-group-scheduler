import WakeUpNote from './WakeUpNote';

export default function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
      <WakeUpNote />
    </div>
  );
}
