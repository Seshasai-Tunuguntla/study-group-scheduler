import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import JoinCode from '../../components/JoinCode';

export default function MembersTab() {
  const { group, isOrganizer, reloadGroup } = useOutletContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busyUserId, setBusyUserId] = useState(null);
  const [error, setError] = useState('');

  async function run(userId, action) {
    setError('');
    setBusyUserId(userId);
    try {
      await action();
      await reloadGroup();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyUserId(null);
    }
  }

  function toggleRequired(member) {
    run(member.userId, () => api.setRequired(group.id, member.userId, !member.required));
  }

  function remove(member) {
    if (!window.confirm(`Remove ${member.name} from ${group.name}? Their availability for this group is deleted too.`)) return;
    run(member.userId, () => api.removeMember(group.id, member.userId));
  }

  async function leave() {
    if (!window.confirm(`Leave ${group.name}? Your availability for this group is deleted.`)) return;
    setError('');
    setBusyUserId(user.id);
    try {
      await api.removeMember(group.id, user.id);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusyUserId(null);
    }
  }

  return (
    <section aria-labelledby="members-heading">
      {isOrganizer && (
        <div className="panel invite">
          <h2>Invite people</h2>
          <p className="muted">Share this code. Anyone with it can join from their dashboard.</p>
          <JoinCode code={group.joinCode} />
        </div>
      )}

      <h2 id="members-heading">Members</h2>
      {error && <p className="flash flash-error" role="alert">{error}</p>}

      <ul className="member-list">
        {group.members.map((member) => {
          const isMe = member.userId === user.id;
          const busy = busyUserId === member.userId;
          return (
            <li key={member.userId} className="member">
              <div className="member-who">
                <span className="member-name">
                  {member.name}
                  {isMe && <span className="muted"> (you)</span>}
                </span>
                <span className="member-status">
                  {member.role === 'ORGANIZER' && <span className="chip chip-accent">Organizer</span>}
                  {member.availabilityUpdatedAt ? (
                    <span className="status status-done">Filled in their week</span>
                  ) : (
                    <span className="status status-waiting">Hasn't filled in their week yet</span>
                  )}
                </span>
              </div>

              <div className="member-actions">
                {isOrganizer ? (
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={member.required}
                      onChange={() => toggleRequired(member)}
                      disabled={busy}
                    />
                    <span className="switch-track" aria-hidden="true" />
                    <span>Required</span>
                  </label>
                ) : (
                  <span className="chip">{member.required ? 'Required' : 'Optional'}</span>
                )}
                {isOrganizer && !isMe && (
                  <button type="button" className="btn-quiet btn-danger" onClick={() => remove(member)} disabled={busy}>
                    {busy ? 'Working…' : 'Remove'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="hint">
        Required members must be free for every suggested time. Optional members count towards attendance but never
        block a time. Members who haven't filled in their week yet are left out until they do.
      </p>

      {!isOrganizer && (
        <button type="button" className="btn-quiet btn-danger leave" onClick={leave} disabled={busyUserId !== null}>
          Leave group
        </button>
      )}
    </section>
  );
}
