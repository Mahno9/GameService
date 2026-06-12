import { useEffect, useState } from 'react';
import { api, type Minigame, type Poi } from '../api';
import { SchemaForm, type Schema } from '../schema-form/SchemaForm';

// ---------------------------------------------------------------------------
// Minigame module contract (see minigame_contract.md)
// ---------------------------------------------------------------------------

interface GameResult {
  score: number;
  won: boolean;
}

interface GameHandle {
  destroy(): void;
}

interface GameModule {
  init(
    container: HTMLElement,
    config: Record<string, unknown> & { muted: boolean },
    callbacks: { onComplete: (result: GameResult) => void; onExit: () => void },
  ): GameHandle;
}

// ---------------------------------------------------------------------------
// Test-run overlay — isolated fullscreen launch of a game
// ---------------------------------------------------------------------------

interface TestRunProps {
  entryUrl: string;
  config: Record<string, unknown>;
  onClose: () => void;
}

function TestRunOverlay({ entryUrl, config, onClose }: TestRunProps) {
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let handle: GameHandle | null = null;
    let disposed = false;
    const container = document.getElementById('sf-test-container');

    function cleanup() {
      if (handle) {
        try {
          handle.destroy();
        } catch {
          // ignore destroy errors
        }
        handle = null;
      }
    }

    if (container) {
      import(/* @vite-ignore */ entryUrl)
        .then((mod: GameModule) => {
          if (disposed) return;
          handle = mod.init(
            container,
            { ...config, muted: false },
            {
              onComplete: (result) => {
                // eslint-disable-next-line no-console
                console.log('[test-run] onComplete', result);
                setBanner(`Завершено: ${result.won ? 'победа' : 'поражение'}, баллы: ${result.score}`);
                cleanup();
              },
              onExit: () => {
                // eslint-disable-next-line no-console
                console.log('[test-run] onExit');
                cleanup();
              },
            },
          );
        })
        .catch((e: unknown) => {
          if (disposed) return;
          setError(e instanceof Error ? e.message : 'Не удалось загрузить игру');
        });
    }

    return () => {
      disposed = true;
      cleanup();
    };
  }, [entryUrl, config]);

  return (
    <div className='test-run-overlay'>
      <button className='test-run-close' title='Закрыть' onClick={onClose}>
        ✕
      </button>
      {banner && <div className='test-run-banner'>{banner}</div>}
      {error && <div className='test-run-error'>{error}</div>}
      <div id='sf-test-container' className='test-run-container' />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config modal for a single POI
// ---------------------------------------------------------------------------

interface ConfigModalProps {
  poi: Poi;
  minigame: Minigame | undefined;
  onClose: () => void;
  onSaved: (replayable: boolean) => void;
}

function ConfigModal({ poi, minigame, onClose, onSaved }: ConfigModalProps) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [replayable, setReplayable] = useState(poi.replayable);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRun, setTestRun] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const schemaPromise = minigame
      ? fetch(minigame.schemaUrl).then((r) => r.json() as Promise<Schema>)
      : Promise.resolve<Schema>({ type: 'object', properties: {} });

    Promise.all([schemaPromise, api.getPoiConfig(poi.id)])
      .then(([sch, cfg]) => {
        if (cancelled) return;
        setSchema(sch);
        setConfig(cfg.config ?? {});
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poi.id, minigame]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updatePoi(poi.id, { config, replayable });
      onSaved(replayable);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal-card' onClick={(e) => e.stopPropagation()}>
        <div className='modal-header'>
          <span className='modal-title'>{poi.name}</span>
          <button className='modal-close' title='Закрыть' onClick={onClose}>
            ✕
          </button>
        </div>

        <div className='modal-body'>
          {loading && <p>Загрузка…</p>}
          {error && <p className='sf-asset-error'>{error}</p>}

          {!loading && schema && (
            <>
              <SchemaForm schema={schema} value={config} onChange={setConfig} />

              <label className='sf-field sf-field-check modal-replayable'>
                <input
                  type='checkbox'
                  checked={replayable}
                  onChange={(e) => setReplayable(e.target.checked)}
                />
                <span className='sf-label'>Повторяемая</span>
              </label>
            </>
          )}
        </div>

        <div className='modal-actions'>
          <button
            className='modal-test-btn'
            disabled={!minigame || loading}
            onClick={() => setTestRun(true)}
          >
            ▶ Запустить в тестовом режиме
          </button>
          <div className='modal-actions-spacer' />
          <button onClick={() => void handleSave()} disabled={saving || loading}>
            Сохранить
          </button>
          <button onClick={onClose}>Отмена</button>
        </div>
      </div>

      {testRun && minigame && (
        <TestRunOverlay
          entryUrl={minigame.entryUrl}
          config={config}
          onClose={() => setTestRun(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function MinigamesSection() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [minigames, setMinigames] = useState<Minigame[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getPois(), api.getMinigames()])
      .then(([ps, mgs]) => {
        setPois(ps);
        setMinigames(mgs);
      })
      .catch(() => undefined);
  }, []);

  function minigameFor(poi: Poi): Minigame | undefined {
    return minigames.find((m) => m.id === poi.minigameId);
  }

  const selectedPoi = pois.find((p) => p.id === selectedId) ?? null;

  return (
    <div className='minigames-section'>
      <h3 className='minigames-title'>Мини-игры</h3>
      <div className='minigames-list'>
        {pois.map((poi) => {
          const mg = minigameFor(poi);
          return (
            <button
              key={poi.id}
              className='minigames-row'
              onClick={() => setSelectedId(poi.id)}
            >
              <span className='minigames-row-name'>{poi.name}</span>
              <span className='minigames-row-game'>{mg?.title ?? poi.minigameId}</span>
            </button>
          );
        })}
        {pois.length === 0 && <p className='minigames-empty'>Нет точек интереса.</p>}
      </div>

      {selectedPoi && (
        <ConfigModal
          poi={selectedPoi}
          minigame={minigameFor(selectedPoi)}
          onClose={() => setSelectedId(null)}
          onSaved={(replayable) => {
            setPois((prev) =>
              prev.map((p) => (p.id === selectedPoi.id ? { ...p, replayable } : p)),
            );
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
