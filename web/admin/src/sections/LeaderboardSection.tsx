import { useEffect, useState } from 'react';
import { api, type LeaderboardEntry, type RealUser } from '../api';

// ---------------------------------------------------------------------------
// Add-entry form
// ---------------------------------------------------------------------------

interface AddFormProps {
  onAdd: (name: string, avatarEmoji: string, score: number) => Promise<void>;
}

function AddEntryForm({ onAdd }: AddFormProps) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('😊');
  const [score, setScore] = useState('0');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    const s = parseInt(score, 10);
    if (!name.trim() || !emoji.trim() || isNaN(s) || s < 0) return;
    setBusy(true);
    try {
      await onAdd(name.trim(), emoji.trim(), s);
      setName('');
      setEmoji('😊');
      setScore('0');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='lb-add-form'>
      <span className='lb-section-subtitle'>Добавить участника</span>
      <div className='lb-add-row'>
        <input
          placeholder='Имя'
          value={name}
          onChange={(e) => setName(e.target.value)}
          className='lb-input-name'
        />
        <input
          placeholder='Эмодзи'
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          className='lb-input-emoji'
          maxLength={4}
        />
        <input
          type='number'
          placeholder='Баллы'
          value={score}
          onChange={(e) => setScore(e.target.value)}
          className='lb-input-score'
          min={0}
        />
        <button onClick={() => { void handleSubmit(); }} disabled={busy || !name.trim()}>
          Добавить
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline-editable row for fictional entry
// ---------------------------------------------------------------------------

interface EntryRowProps {
  entry: LeaderboardEntry;
  onSave: (id: string, name: string, avatarEmoji: string, score: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function EntryRow({ entry, onSave, onDelete }: EntryRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [emoji, setEmoji] = useState(entry.avatarEmoji);
  const [score, setScore] = useState(String(entry.score));
  const [busy, setBusy] = useState(false);

  // Keep local state in sync if the parent updates the entry (e.g. after save)
  useEffect(() => {
    if (!editing) {
      setName(entry.name);
      setEmoji(entry.avatarEmoji);
      setScore(String(entry.score));
    }
  }, [entry, editing]);

  function handleCancel() {
    setName(entry.name);
    setEmoji(entry.avatarEmoji);
    setScore(String(entry.score));
    setEditing(false);
  }

  async function handleSave() {
    const s = parseInt(score, 10);
    if (!name.trim() || !emoji.trim() || isNaN(s) || s < 0) return;
    setBusy(true);
    try {
      await onSave(entry.id, name.trim(), emoji.trim(), s);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Удалить «${entry.name}»?`)) return;
    setBusy(true);
    try {
      await onDelete(entry.id);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr className='lb-row lb-row--editing'>
        <td>
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            className='lb-input-emoji'
            maxLength={4}
          />
        </td>
        <td>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className='lb-input-name'
          />
        </td>
        <td>
          <input
            type='number'
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className='lb-input-score'
            min={0}
          />
        </td>
        <td className='lb-actions'>
          <button onClick={() => { void handleSave(); }} disabled={busy || !name.trim()}>
            Сохранить
          </button>
          <button onClick={handleCancel} disabled={busy}>
            Отмена
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className='lb-row lb-row--clickable'
      onClick={() => setEditing(true)}
      title='Нажмите для редактирования'
    >
      <td className='lb-cell-emoji'>{entry.avatarEmoji}</td>
      <td>{entry.name}</td>
      <td className='lb-cell-score'>{entry.score}</td>
      <td className='lb-actions' onClick={(e) => e.stopPropagation()}>
        <button
          className='lb-delete-btn'
          onClick={() => { void handleDelete(); }}
          disabled={busy}
        >
          Удалить
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Real users block
// ---------------------------------------------------------------------------

interface RealUsersBlockProps {
  users: RealUser[];
  onDelete: (userId: string) => Promise<void>;
}

function RealUsersBlock({ users, onDelete }: RealUsersBlockProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(user: RealUser) {
    if (!window.confirm(`Удалить результаты пользователя «${user.name}»?`)) return;
    setBusyId(user.id);
    try {
      await onDelete(user.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className='lb-real-block'>
      <h4 className='lb-block-title'>Реальные игроки</h4>
      {users.length === 0 ? (
        <p className='lb-empty'>Нет реальных игроков</p>
      ) : (
        <table className='lb-table'>
          <thead>
            <tr>
              <th></th>
              <th>Имя</th>
              <th>Баллы</th>
              <th>Метки</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className='lb-row'>
                <td className='lb-cell-emoji'>{u.avatarEmoji}</td>
                <td>{u.name}</td>
                <td className='lb-cell-score'>{u.totalScore}</td>
                <td className='lb-cell-badges'>
                  {u.isDebug && <span className='lb-badge lb-badge--debug'>debug</span>}
                  {u.completedAll && (
                    <span className='lb-badge lb-badge--done'>✓ все игры</span>
                  )}
                </td>
                <td className='lb-actions'>
                  <button
                    className='lb-delete-btn'
                    onClick={() => { void handleDelete(u); }}
                    disabled={busyId === u.id}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function LeaderboardSection() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [realUsers, setRealUsers] = useState<RealUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getLeaderboard(), api.getRealUsers()])
      .then(([e, r]) => {
        setEntries(e);
        setRealUsers(r);
      })
      .catch(() => setError('Не удалось загрузить данные'));
  }, []);

  async function handleAdd(name: string, avatarEmoji: string, score: number) {
    setError(null);
    try {
      const created = await api.createLeaderboardEntry({ name, avatarEmoji, score });
      setEntries((prev) => [...prev, created]);
    } catch {
      setError('Ошибка при добавлении');
    }
  }

  async function handleSave(id: string, name: string, avatarEmoji: string, score: number) {
    setError(null);
    try {
      const updated = await api.updateLeaderboardEntry(id, { name, avatarEmoji, score });
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch {
      setError('Ошибка при сохранении');
    }
  }

  async function handleDeleteEntry(id: string) {
    setError(null);
    try {
      await api.deleteLeaderboardEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError('Ошибка при удалении');
    }
  }

  async function handleDeleteRealUser(userId: string) {
    setError(null);
    try {
      await api.deleteRealUser(userId);
      setRealUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch {
      setError('Ошибка при удалении');
    }
  }

  return (
    <div className='lb-section'>
      <h3 className='lb-section-title'>Таблица лидеров</h3>

      {error && <p className='lb-error'>{error}</p>}

      {/* Fictional entries */}
      <div className='lb-fictional-block'>
        <h4 className='lb-block-title'>Фиктивные участники</h4>
        {entries.length === 0 ? (
          <p className='lb-empty'>Нет участников</p>
        ) : (
          <table className='lb-table'>
            <thead>
              <tr>
                <th></th>
                <th>Имя</th>
                <th>Баллы</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onSave={handleSave}
                  onDelete={handleDeleteEntry}
                />
              ))}
            </tbody>
          </table>
        )}

        <AddEntryForm onAdd={handleAdd} />
      </div>

      {/* Real users */}
      <RealUsersBlock users={realUsers} onDelete={handleDeleteRealUser} />
    </div>
  );
}
