import { useEffect, useRef, useState } from 'react';
import { runVectorJob, runRasterJob } from '@gameservice/tile-pipeline';
import type { JobStage, ProgressInfo, ResumeInfo } from '@gameservice/tile-pipeline';
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

type JobRunner = (
  args: { bbox: Bbox; minZoom: number; maxZoom: number; signal: AbortSignal; resume?: ResumeInfo },
  callbacks: {
    onStage: (s: JobStage) => void;
    onProgress: (p: ProgressInfo) => void;
    onError: (err: Error) => void;
  },
) => Promise<void>;

interface RunState {
  status: RunStatus;
  stage: JobStage | null;
  progress: ProgressInfo | null;
  errorMsg: string | null;
  isRunning: boolean;
  start: (bbox: Bbox, minZoom: number, maxZoom: number, resume?: ResumeInfo) => Promise<void>;
  cancel: () => void;
}

/** Reusable run-state for a single tile job (vector or raster). */
function useTileJobRun(runner: JobRunner, onSettled: () => void): RunState {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [stage, setStage] = useState<JobStage | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function start(bbox: Bbox, minZoom: number, maxZoom: number, resume?: ResumeInfo) {
    setStatus('running');
    setStage(null);
    setProgress(null);
    setErrorMsg(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const args: { bbox: Bbox; minZoom: number; maxZoom: number; signal: AbortSignal; resume?: ResumeInfo } = {
        bbox,
        minZoom,
        maxZoom,
        signal: controller.signal,
      };
      if (resume !== undefined) {
        args.resume = resume;
      }
      await runner(args, {
        onStage: (s) => setStage(s),
        onProgress: (p) => setProgress(p),
        onError: (err) => setErrorMsg(err.message),
      });
      setStatus('done');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('cancelled');
      } else {
        setStatus('error');
        if (err instanceof Error) setErrorMsg(err.message);
      }
    } finally {
      abortRef.current = null;
      onSettled();
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return {
    status,
    stage,
    progress,
    errorMsg,
    isRunning: status === 'running',
    start,
    cancel,
  };
}

function formatEta(etaSeconds: number): string {
  if (etaSeconds < 60) {
    return `осталось ~${etaSeconds} сек`;
  }
  return `осталось ~${Math.round(etaSeconds / 60)} мин`;
}

export function TileGenerationPanel({ savedBbox }: Props) {
  const [minZoom, setMinZoom] = useState(14);
  const [maxZoom, setMaxZoom] = useState(17);
  const [rasterMinZoom, setRasterMinZoom] = useState(11);
  const [rasterMaxZoom, setRasterMaxZoom] = useState(13);
  const [jobs, setJobs] = useState<TileJob[]>([]);

  const refreshJobs = () => {
    api.getTileJobs().then(setJobs).catch(() => undefined);
  };

  useEffect(() => {
    refreshJobs();
  }, []);

  const vector = useTileJobRun(runVectorJob, refreshJobs);
  const raster = useTileJobRun(runRasterJob, refreshJobs);

  const noBbox = !savedBbox;
  const anyRunning = vector.isRunning || raster.isRunning;

  function renderRunState(run: RunState) {
    const pct =
      run.progress && run.progress.tilesTotal > 0
        ? Math.round((run.progress.tilesDone / run.progress.tilesTotal) * 100)
        : 0;
    return (
      <>
        {run.isRunning && (
          <div className="tile-progress-area">
            {run.stage && <div className="tile-stage">{STAGE_LABELS[run.stage]}</div>}
            {run.progress && (
              <>
                <div className="tile-progress-bar-wrap">
                  <div className="tile-progress-bar" style={{ width: `${pct}%` }} />
                </div>
                <div className="tile-progress-text">
                  {run.progress.tilesDone} / {run.progress.tilesTotal} тайлов · зум{' '}
                  {run.progress.zoom}
                  {run.progress.etaSeconds !== undefined && (
                    <span className="tile-eta"> · {formatEta(run.progress.etaSeconds)}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {run.status === 'done' && <div className="tile-status-ok">Готово ✓</div>}
        {run.status === 'error' && run.errorMsg && (
          <div className="tile-status-error">{run.errorMsg}</div>
        )}
        {run.status === 'cancelled' && <div className="tile-status-warn">Прервано</div>}
      </>
    );
  }

  function handleResume(job: TileJob) {
    const bbox = job.bbox;
    const resume: ResumeInfo = { jobId: job.id, completedZooms: job.completedZooms };
    if (job.kind === 'vector') {
      void vector.start(bbox, job.minZoom, job.maxZoom, resume);
    } else {
      void raster.start(bbox, job.minZoom, job.maxZoom, resume);
    }
  }

  function handleRegenerate(job: TileJob) {
    const bbox = job.bbox;
    if (job.kind === 'vector') {
      void vector.start(bbox, job.minZoom, job.maxZoom);
    } else {
      void raster.start(bbox, job.minZoom, job.maxZoom);
    }
  }

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
            disabled={vector.isRunning}
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
            disabled={vector.isRunning}
            onChange={(e) => setMaxZoom(Number(e.target.value))}
            className="tile-zoom-input"
          />
        </label>
        {noBbox ? (
          <span className="tile-hint">Сначала выберите и сохраните участок</span>
        ) : (
          !vector.isRunning && (
            <button
              onClick={() => {
                if (savedBbox) void vector.start(savedBbox, minZoom, maxZoom);
              }}
              disabled={noBbox || anyRunning}
            >
              Сгенерировать векторные тайлы
            </button>
          )
        )}
        {vector.isRunning && (
          <button onClick={vector.cancel} className="tile-cancel-btn">
            Отмена
          </button>
        )}
      </div>

      {renderRunState(vector)}

      <h3 className="tile-panel-title">Растровые тайлы</h3>

      <div className="tile-panel-controls">
        <label className="tile-zoom-label">
          Мин. зум
          <input
            type="number"
            min={0}
            max={22}
            value={rasterMinZoom}
            disabled={raster.isRunning}
            onChange={(e) => setRasterMinZoom(Number(e.target.value))}
            className="tile-zoom-input"
          />
        </label>
        <label className="tile-zoom-label">
          Макс. зум
          <input
            type="number"
            min={0}
            max={22}
            value={rasterMaxZoom}
            disabled={raster.isRunning}
            onChange={(e) => setRasterMaxZoom(Number(e.target.value))}
            className="tile-zoom-input"
          />
        </label>
        {noBbox ? (
          <span className="tile-hint">Сначала выберите и сохраните участок</span>
        ) : (
          !raster.isRunning && (
            <button
              onClick={() => {
                if (savedBbox) void raster.start(savedBbox, rasterMinZoom, rasterMaxZoom);
              }}
              disabled={noBbox || anyRunning}
            >
              Сгенерировать растровые тайлы
            </button>
          )
        )}
        {raster.isRunning && (
          <button onClick={raster.cancel} className="tile-cancel-btn">
            Отмена
          </button>
        )}
      </div>

      {renderRunState(raster)}

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
              {(job.status === 'paused' || job.status === 'failed') && (
                <button
                  className="tile-job-action-btn"
                  disabled={anyRunning}
                  onClick={() => handleResume(job)}
                >
                  Продолжить
                </button>
              )}
              {job.status === 'done' && (
                <button
                  className="tile-job-action-btn"
                  disabled={anyRunning}
                  onClick={() => handleRegenerate(job)}
                >
                  Перегенерировать
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
