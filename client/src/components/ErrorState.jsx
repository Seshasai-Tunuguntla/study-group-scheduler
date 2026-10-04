// A failed load: says what went wrong and offers a retry, instead of a blank screen.
export default function ErrorState({ error, onRetry, title = "Something went wrong" }) {
  return (
    <div className="flash flash-error error-state" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{error?.message || 'Please try again.'}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
