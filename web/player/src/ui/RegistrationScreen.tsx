import { useState } from 'react';
import { api } from '../api';
import { localState, type ClientState } from '../state/localState';

const AVATARS = [
  '😀', '😎', '🤩', '🥳', '😇', '🤓', '😺', '🤠',
  '🦊', '🐱', '🐶', '🦁', '🐸', '🐼', '🐨', '🐯',
  '🐵', '🐰', '🐻', '🐲', '🦄', '🐧', '🦉', '🐢',
];

interface RegistrationScreenProps {
  onDone: () => void;
}

function isAdoptableState(value: unknown): value is ClientState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.updatedAt === 'number';
}

export function RegistrationScreen({ onDone }: RegistrationScreenProps) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0] as string);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 30;

  async function handleStart() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.postSession({ name: trimmed, avatarEmoji: avatar });
      const local = localState.getSnapshot();
      // Adopt server state only if it's newer than what we hold locally.
      if (isAdoptableState(res.state) && res.state.updatedAt > local.updatedAt) {
        localState.replace(res.state);
      }
      localState.setProfile({
        userId: res.user.id,
        name: res.user.name,
        avatarEmoji: res.user.avatarEmoji,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось начать');
      setSubmitting(false);
    }
  }

  return (
    <div className="reg-screen">
      <div className="reg-card">
        <h1 className="reg-title">Добро пожаловать</h1>
        <p className="reg-subtitle">Введите имя и выберите аватар</p>

        <input
          className="reg-input"
          type="text"
          placeholder="Ваше имя"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <div className="reg-avatars">
          {AVATARS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={
                emoji === avatar ? 'reg-avatar reg-avatar-selected' : 'reg-avatar'
              }
              onClick={() => setAvatar(emoji)}
              aria-label={`Аватар ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        {error && <div className="reg-error">{error}</div>}

        <button
          type="button"
          className="reg-start"
          disabled={!valid || submitting}
          onClick={() => void handleStart()}
        >
          {submitting ? 'Загрузка…' : 'Начать'}
        </button>
      </div>
    </div>
  );
}
