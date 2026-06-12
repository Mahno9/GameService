import { useEffect, useState } from 'react';
import { api, type LeaderboardRow } from '../api';
import { playClick } from '../audio/uiSound';
import { useI18n } from '../i18n/index';

interface LeaderboardScreenProps {
  userId: string;
  onClose: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; rows: LeaderboardRow[] }
  | { status: 'error'; message: string };

/** Full-screen overlay showing the ranked leaderboard. */
export function LeaderboardScreen({ userId, onClose }: LeaderboardScreenProps) {
  const t = useI18n();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void api
      .getLeaderboard(userId)
      .then((rows) => {
        if (!cancelled) setLoad({ status: 'ok', rows });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('leaderboard.errorFallback');
          setLoad({ status: 'error', message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="overlay-screen">
      <div className="overlay-header">
        <span className="overlay-title">{t('leaderboard.title')}</span>
        <button type="button" className="overlay-close-btn" onClick={() => { playClick(); onClose(); }} aria-label={t('leaderboard.close')}>
          ✕
        </button>
      </div>

      {load.status === 'loading' && (
        <div className="overlay-loading">{t('leaderboard.loading')}</div>
      )}

      {load.status === 'error' && (
        <div className="overlay-error">{load.message}</div>
      )}

      {load.status === 'ok' && (
        <div className="leaderboard-list">
          {load.rows.map((row, idx) => (
            <div
              key={`${row.name}-${idx}`}
              className={`leaderboard-row${row.isPlayer ? ' leaderboard-row-player' : ''}`}
            >
              <span className="lb-place">{idx + 1}</span>
              <span className="lb-avatar">{row.avatarEmoji}</span>
              <span className="lb-name">{row.name}</span>
              <span className="lb-score">{row.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
