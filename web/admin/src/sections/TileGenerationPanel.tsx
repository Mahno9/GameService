import { useEffect, useRef, useState } from 'react';
import { runVectorJob } from '@gameservice/tile-pipeline';
import type { JobStage, ProgressInfo } from '@gameservice/tile-pipeline';
import { api, type Bbox, type TileJob } from '../api';

interface Props {
  savedBbox: Bbox | null;
}

const STAGE_LABELS: Record<JobStage, string> = {
  'download': 'Загрузка OSM',
  'parse': 'Парсинг',
  'generate+upload': 'Генерация и загрузка',
};

type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export function TileGenerationPanel({ savedBbox }: Props) {
  const [minZoom, setMinZoom] = useState(14);
  const [maxZoom, setMaxZoom] = useState(17);
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [stage, setStage] = useState<JobStage | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jobs, setJobs] = useState<TileJob[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.getTileJobs().then(setJobs).catch(() => undefined);
  }, []);

  async function startGeneration() {
    if (!savedBbox) return;
    setRunStatus('running');
    setStage(null);
    setProgress(null);
    setErrorMsg(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runVectorJob(
        { bbox: savedBbox, minZoom, maxZoom, signal: controller.signal },
        {
          onStage: (s) => setStage(s),
          onProgress: (p) => setProgress(p),
          onError: (err) => setErrorMsg(err.message),
        },
      );
      setRunStatus('done');
    } catch (err) {
      if (controller.signal.aborted) {
        setRunStatus('cancelled');
      } else {
        setRunStatus('error');
        if (err instanceof Error) setErrorMsg(err.message);
      }
    } finally {
      abortRef.current = null;
      api.getTileJobs().then(setJobs).catch(() => undefined);
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const noBbox = !savedBbox;
  const isRunning = runStatus === 'running';
  const pct = progress && progress.tilesTotal > 0
    ? Math.round((progress.tilesDone / progress.tilesTotal) * 100)
    : 0;

  return (
    <div className="tile-panel">
      <h3 className="tile-panel-title">Векторные тайлы</h3>

      <div className="tile-panel-controls">
        <label className="tile-zoom-label">
          Мин. зум
          <input
            type="number"
            min={0}
            max={22}
            value={minZoom}
            disabled={isRunning}
            onChange={(e) => setMinZoom(Number(e.target.value))}
            className="tile-zoom-input"
          />
        </label>
        <label className="tile-zoom-label">
          Макс. зум
          <input
            type="number"
            min={0}
            max={22}
            value={maxZoom}
            disabled={isRunning}
            onChange={(e) => setMaxZoom(Number(e.target.value))}
            className="tile-zoom-input"
          />
        </label>
        {noBbox ? (
          <span className="tile-hint">Сначала выберите и сохраните участок</span>
        ) : (
          !isRunning && (
            <button onClick={() => { void startGeneration(); }} disabled={noBbox}>
              Сгенерировать векторные тайлы
            </button>
          )
        )}
        {isRunning && (
          <button onClick={cancel} className="tile-cancel-btn">
            Отмена
          </button>
        )}
      </div>

      {isRunning && (
        <div className="tile-progress-area">
          {stage && <div className="tile-stage">{STAGE_LABELS[stage]}</div>}
          {progress && (
            <>
              <div className="tile-progress-bar-wrap">
                <div className="tile-progress-bar" style={{ width: `${pct}%` }} />
              </div>
              <div className="tile-progress-text">
                {progress.tilesDone} / {progress.tilesTotal} тайлов · зум {progress.zoom}
              </div>
            </>
          )}
        </div>
      )}

      {runStatus === 'done' && <div className="tile-status-ok">Готово ✓</div>}
      {runStatus === 'error' && errorMsg && (
        <div className="tile-status-error">{errorMsg}</div>
      )}
      {runStatus === 'cancelled' && <div className="tile-status-warn">Прервано</div>}

      {jobs.length > 0 && (
        <div className="tile-jobs-list">
          <h4 className="tile-jobs-title">История задач</h4>
          {jobs.map((job) => (
            <div key={job.id} className="tile-job-row">
              <span className="tile-job-kind">{job.kind}</span>
              <span className={`tile-job-status tile-job-status--${job.status}`}>{job.status}</span>
              <span className="tile-job-progress">
                {job.tilesDone}/{job.tilesTotal}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
