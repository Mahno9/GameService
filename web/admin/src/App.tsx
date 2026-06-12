import { useEffect, useState } from 'react';
import { api } from './api';
import { LoginScreen } from './auth/LoginScreen';
import { MapSection } from './sections/MapSection';
import { PoiSection } from './sections/PoiSection';
import { MinigamesSection } from './sections/MinigamesSection';
import { DebugSection } from './sections/DebugSection';
import { LeaderboardSection } from './sections/LeaderboardSection';

type Section = 'map' | 'pois' | 'minigames' | 'debug' | 'leaderboard';

const SECTIONS: { id: Section; title: string }[] = [
  { id: 'map', title: 'Карта' },
  { id: 'pois', title: 'Точки интереса' },
  { id: 'minigames', title: 'Мини-игры' },
  { id: 'debug', title: 'Дебаг' },
  { id: 'leaderboard', title: 'Лидерборд' },
];

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [section, setSection] = useState<Section>('map');

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return null;
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <div className="layout">
      <nav className="sidebar">
        <h2>AdminPanel</h2>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? 'active' : ''}
            onClick={() => setSection(s.id)}
          >
            {s.title}
          </button>
        ))}
        <div className="sidebar-spacer" />
        <button
          onClick={() => {
            api.logout().then(() => setAuthed(false));
          }}
        >
          Выйти
        </button>
      </nav>
      <main className="content">
        {section === 'map' && <MapSection />}
        {section === 'pois' && <PoiSection />}
        {section === 'minigames' && <MinigamesSection />}
        {section === 'debug' && <DebugSection />}
        {section === 'leaderboard' && <LeaderboardSection />}
      </main>
    </div>
  );
}
