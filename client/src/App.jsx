import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

// Phase 1 placeholder: proves the Vite -> /api proxy -> Express chain works.
// Replaced by the real auth/dashboard/group routes in phase 7.
function ScaffoldStatus() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data) => setStatus(data.ok ? 'ok' : 'error'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <main className="scaffold">
      <h1>Study Scheduler</h1>
      <p>
        API status:{' '}
        <strong data-status={status}>
          {status === 'checking' ? 'checking…' : status === 'ok' ? 'connected' : 'unreachable'}
        </strong>
      </p>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ScaffoldStatus />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
