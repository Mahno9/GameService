import { useEffect, useMemo, useState } from 'react';
import { api, type Minigame, type Poi } from '../api';
import { SchemaForm, type Schema } from '../schema-form/SchemaForm';
import { FindObjectEditor } from '../scene-editor/FindObjectEditor';
import { showToast } from '../toast';

// Properties of the find-object schema that are managed by the visual
// FindObjectEditor instead of the generic SchemaForm.
const FIND_OBJECT_EDITOR_KEYS = ['backgroundImage', 'overlays', 'targets'] as const;

/** Strip the editor-managed properties so SchemaForm only renders the rest. */
function schemaWithoutEditorKeys(schema: Schema): Schema {
  if (!schema.properties) return schema;
  const properties: Record<string, Schema> = {};
  for (const [key, sub] of Object.entries(schema.properties)) {
    if ((FIND_OBJECT_EDITOR_KEYS as readonly string[]).includes(key)) continue;
    properties[key] = sub;
  }
  const required = schema.required?.filter(
    (k) => !(FIND_OBJECT_EDITOR_KEYS as readonly string[]).includes(k),
  );
  return required ? { ...schema, properties, required } : { ...schema, properties };
}

type Cfg = Record<string, unknown>;

/** Effective config = defaults ⊕ override, merged by top-level key. */
function mergeTop(defaults: Cfg, override: Cfg): Cfg {
  return { ...defaults, ...override };
}

/** Sparse override: only top-level keys of `config` that differ from `defaults`. */
function diffTop(defaults: Cfg, config: Cfg): Cfg {
  const out: Cfg = {};
  for (const [key, value] of Object.entries(config)) {
    if (JSON.stringify(value) !== JSON.stringify(defaults[key])) out[key] = value;
  }
  return out;
}

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
                console.log('[test-run] onComplete', result);
                cleanup();
                onClose();
              },
              onExit: () => {
                console.log('[test-run] onExit');
                cleanup();
                onClose();
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
      {error && <div className='test-run-error'>{error}</div>}
      <div id='sf-test-container' className='test-run-container' />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config modal — edits a config object for a minigame (defaults or per-POI)
// ---------------------------------------------------------------------------

interface ConfigModalProps {
  minigame: Minigame;
  title: string;
  initialConfig: Cfg;
  showReplayable: boolean;
  initialReplayable?: boolean;
  onClose: () => void;
  onSave: (config: Cfg, replayable: boolean) => Promise<void>;
}

function ConfigModal({
  minigame,
  title,
  initialConfig,
  showReplayable,
  initialReplayable,
  onClose,
  onSave,
}: ConfigModalProps) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [config, setConfig] = useState<Cfg>(initialConfig);
  const [replayable, setReplayable] = useState(initialReplayable ?? false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRun, setTestRun] = useState(false);

  const isFindObject = minigame.id === 'find-object';
  // For find-object, the visual editor owns backgroundImage/overlays/targets;
  // SchemaForm renders the remaining fields (scoreThresholds, sounds, …).
  const formSchema = useMemo(
    () => (schema && isFindObject ? schemaWithoutEditorKeys(schema) : schema),
    [schema, isFindObject],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(minigame.schemaUrl)
      .then((r) => r.json() as Promise<Schema>)
      .then((sch) => {
        if (!cancelled) setSchema(sch);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [minigame.schemaUrl]);

  // Esc closes the settings window (a nested DrawModal intercepts Esc first via
  // a capture-phase handler that preventDefaults, so it won't reach here).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave(close: boolean) {
    setSaving(true);
    setError(null);
    try {
      await onSave(config, replayable);
      showToast('Сохранено');
      if (close) onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка сохранения';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className='modal-overlay' onClick={onClose}>
        <div
          className={`modal-card modal-card--config${isFindObject ? ' modal-card--wide' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
        <div className='modal-header'>
          <span className='modal-title'>{title}</span>
          <button className='modal-close' title='Закрыть' onClick={onClose}>
            ✕
          </button>
        </div>

        <div className='modal-body'>
          {loading && <p>Загрузка…</p>}
          {error && <p className='sf-asset-error'>{error}</p>}

          {!loading && schema && (
            <>
              {isFindObject && <FindObjectEditor value={config} onChange={setConfig} />}

              {formSchema && <SchemaForm schema={formSchema} value={config} onChange={setConfig} />}

              {showReplayable && (
                <label className='sf-field sf-field-check modal-replayable'>
                  <input
                    type='checkbox'
                    checked={replayable}
                    onChange={(e) => setReplayable(e.target.checked)}
                  />
                  <span className='sf-label'>Повторяемая</span>
                </label>
              )}
            </>
          )}
        </div>

        <div className='modal-actions'>
          <button className='modal-test-btn' disabled={loading} onClick={() => setTestRun(true)}>
            ▶ Запустить в тестовом режиме
          </button>
          <div className='modal-actions-spacer' />
          <button onClick={() => void handleSave(false)} disabled={saving || loading}>
            Сохранить
          </button>
          <button
            className='modal-save-primary'
            onClick={() => void handleSave(true)}
            disabled={saving || loading}
          >
            Сохранить и закрыть
          </button>
          <button onClick={onClose}>Отмена</button>
        </div>
        </div>
      </div>

      {/* Sibling of the backdrop, not a child — so clicks inside the game don't
          bubble to the modal-overlay onClose and close everything. */}
      {testRun && (
        <TestRunOverlay
          entryUrl={minigame.entryUrl}
          config={config}
          onClose={() => setTestRun(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main section — two lists: games (defaults + test launch) and POIs (override)
// ---------------------------------------------------------------------------

type Modal =
  | {
      minigame: Minigame;
      title: string;
      initialConfig: Cfg;
      showReplayable: boolean;
      initialReplayable?: boolean;
      onSave: (config: Cfg, replayable: boolean) => Promise<void>;
    }
  | null;

export function MinigamesSection() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [minigames, setMinigames] = useState<Minigame[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);

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

  // --- Edit a game's default config ---
  function openGame(mg: Minigame) {
    setModal({
      minigame: mg,
      title: `${mg.title} — дефолтные ассеты`,
      initialConfig: (mg.defaultConfig ?? {}) as Cfg,
      showReplayable: false,
      onSave: async (config) => {
        await api.updateMinigameDefaults(mg.id, config);
        setMinigames((prev) =>
          prev.map((m) => (m.id === mg.id ? { ...m, defaultConfig: config } : m)),
        );
      },
    });
  }

  // --- Edit a POI's sparse override (over the game's defaults) ---
  async function openPoi(poi: Poi) {
    const mg = minigameFor(poi);
    if (!mg) {
      setError(`Неизвестная мини-игра: ${poi.minigameId}`);
      return;
    }
    setError(null);
    try {
      const defaults = (mg.defaultConfig ?? {}) as Cfg;
      const cfg = await api.getPoiConfig(poi.id);
      const override = (cfg.config ?? {}) as Cfg;
      setModal({
        minigame: mg,
        title: poi.name,
        initialConfig: mergeTop(defaults, override),
        showReplayable: true,
        initialReplayable: poi.replayable,
        onSave: async (config, replayable) => {
          await api.updatePoi(poi.id, { config: diffTop(defaults, config), replayable });
          setPois((prev) => prev.map((p) => (p.id === poi.id ? { ...p, replayable } : p)));
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }

  return (
    <div className='minigames-section'>
      <h3 className='minigames-title'>Мини-игры</h3>
      {error && <p className='sf-asset-error'>{error}</p>}

      <h4 className='minigames-subtitle'>Игры</h4>
      <div className='minigames-list'>
        {minigames.map((mg) => (
          <button key={mg.id} className='minigames-row' onClick={() => openGame(mg)}>
            <span className='minigames-row-name'>{mg.title}</span>
            <span className='minigames-row-game'>дефолтные ассеты ▸</span>
          </button>
        ))}
        {minigames.length === 0 && <p className='minigames-empty'>Нет мини-игр.</p>}
      </div>

      <h4 className='minigames-subtitle'>Точки интереса</h4>
      <div className='minigames-list'>
        {pois.map((poi) => {
          const mg = minigameFor(poi);
          return (
            <button
              key={poi.id}
              className='minigames-row'
              onClick={() => void openPoi(poi)}
            >
              <span className='minigames-row-name'>{poi.name}</span>
              <span className='minigames-row-game'>{mg?.title ?? poi.minigameId}</span>
            </button>
          );
        })}
        {pois.length === 0 && <p className='minigames-empty'>Нет точек интереса.</p>}
      </div>

      {modal && (
        <ConfigModal
          minigame={modal.minigame}
          title={modal.title}
          initialConfig={modal.initialConfig}
          showReplayable={modal.showReplayable}
          initialReplayable={modal.initialReplayable ?? false}
          onClose={() => setModal(null)}
          onSave={modal.onSave}
        />
      )}
    </div>
  );
}
