import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { IMAGE_ACCEPT } from '../asset-accept';

// ---------------------------------------------------------------------------
// Config shape (mirrors minigames/find-object/schema.json)
//   x / y are in BACKGROUND PIXEL coordinates and refer to the ITEM CENTER.
//   targets[] is an ORDERED queue; overlays[] is unordered decoration.
// ---------------------------------------------------------------------------

export interface SceneItem {
  image: string;
  x: number;
  y: number;
  rotation: number;
  colorFilter: string;
  zIndex: number;
  scale: number;
}

export interface FindObjectConfig {
  backgroundImage?: string;
  overlays?: SceneItem[];
  targets?: SceneItem[];
  // other keys (scoreThresholds, sounds, …) are preserved untouched
  [key: string]: unknown;
}

interface FindObjectEditorProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

type Kind = 'target' | 'overlay';

interface Selection {
  kind: Kind;
  index: number;
}

// ---------------------------------------------------------------------------
// Colour-filter presets (CSS filter strings)
// ---------------------------------------------------------------------------

const FILTER_PRESETS: { label: string; value: string }[] = [
  { label: 'нет', value: '' },
  { label: 'grayscale(1)', value: 'grayscale(1)' },
  { label: 'sepia(1)', value: 'sepia(1)' },
  { label: 'hue-rotate(90deg)', value: 'hue-rotate(90deg)' },
  { label: 'hue-rotate(180deg)', value: 'hue-rotate(180deg)' },
  { label: 'brightness(1.3)', value: 'brightness(1.3)' },
  { label: 'contrast(1.5)', value: 'contrast(1.5)' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readItems(value: Record<string, unknown>, key: 'overlays' | 'targets'): SceneItem[] {
  const raw = value[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => normalizeItem(it as Partial<SceneItem>));
}

function normalizeItem(it: Partial<SceneItem>): SceneItem {
  return {
    image: typeof it.image === 'string' ? it.image : '',
    x: typeof it.x === 'number' ? it.x : 0,
    y: typeof it.y === 'number' ? it.y : 0,
    rotation: typeof it.rotation === 'number' ? it.rotation : 0,
    colorFilter: typeof it.colorFilter === 'string' ? it.colorFilter : '',
    zIndex: typeof it.zIndex === 'number' ? it.zIndex : 0,
    scale: typeof it.scale === 'number' ? it.scale : 1,
  };
}

function maxZIndex(targets: SceneItem[], overlays: SceneItem[]): number {
  let max = 0;
  for (const it of targets) max = Math.max(max, it.zIndex);
  for (const it of overlays) max = Math.max(max, it.zIndex);
  return max;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function FindObjectEditor({ value, onChange }: FindObjectEditorProps) {
  const backgroundImage = typeof value.backgroundImage === 'string' ? value.backgroundImage : '';
  const targets = useMemo(() => readItems(value, 'targets'), [value]);
  const overlays = useMemo(() => readItems(value, 'overlays'), [value]);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState<Kind | null>(null);

  // Natural pixel size of the background (for the pixel↔screen scale factor)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(0);

  // Measure the rendered stage width so we can convert pixel↔screen.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [backgroundImage, natural]);

  // scale = screen px per background px
  const scale = natural && natural.w > 0 && stageWidth > 0 ? stageWidth / natural.w : 1;

  // ----- mutation helpers (always bubble a fresh config object) -------------

  const commit = useCallback(
    (next: { targets?: SceneItem[]; overlays?: SceneItem[]; backgroundImage?: string }) => {
      onChange({
        ...value,
        ...(next.backgroundImage !== undefined ? { backgroundImage: next.backgroundImage } : {}),
        targets: next.targets ?? targets,
        overlays: next.overlays ?? overlays,
      });
    },
    [onChange, value, targets, overlays],
  );

  const updateItem = useCallback(
    (kind: Kind, index: number, patch: Partial<SceneItem>) => {
      const list = kind === 'target' ? targets : overlays;
      const nextList = list.map((it, i) => (i === index ? { ...it, ...patch } : it));
      commit(kind === 'target' ? { targets: nextList } : { overlays: nextList });
    },
    [targets, overlays, commit],
  );

  const removeItem = useCallback(
    (kind: Kind, index: number) => {
      const list = kind === 'target' ? targets : overlays;
      const nextList = list.filter((_, i) => i !== index);
      commit(kind === 'target' ? { targets: nextList } : { overlays: nextList });
      setSelection(null);
    },
    [targets, overlays, commit],
  );

  const moveInQueue = useCallback(
    (index: number, dir: -1 | 1) => {
      const j = index + dir;
      if (j < 0 || j >= targets.length) return;
      const nextList = targets.slice();
      const a = nextList[index];
      const b = nextList[j];
      if (!a || !b) return;
      nextList[index] = b;
      nextList[j] = a;
      commit({ targets: nextList });
      setSelection({ kind: 'target', index: j });
    },
    [targets, commit],
  );

  async function handleBackgroundUpload(file: File | undefined) {
    if (!file) return;
    setBgBusy(true);
    setBgError(null);
    try {
      const asset = await api.uploadAsset(file);
      setNatural(null);
      commit({ backgroundImage: asset.url });
    } catch (e) {
      setBgError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setBgBusy(false);
    }
  }

  async function handleAddItem(kind: Kind, file: File | undefined) {
    if (!file) return;
    setAddBusy(kind);
    try {
      const asset = await api.uploadAsset(file);
      // Place new item at the centre of the background (pixel coords).
      const cx = natural ? natural.w / 2 : 0;
      const cy = natural ? natural.h / 2 : 0;
      const item: SceneItem = {
        image: asset.url,
        x: cx,
        y: cy,
        rotation: 0,
        colorFilter: '',
        zIndex: maxZIndex(targets, overlays) + 1,
        scale: 1,
      };
      if (kind === 'target') {
        const nextList = [...targets, item];
        commit({ targets: nextList });
        setSelection({ kind: 'target', index: nextList.length - 1 });
      } else {
        const nextList = [...overlays, item];
        commit({ overlays: nextList });
        setSelection({ kind: 'overlay', index: nextList.length - 1 });
      }
    } catch {
      // upload errors are surfaced by background widget; keep palette quiet
    } finally {
      setAddBusy(null);
    }
  }

  const selectedItem: SceneItem | null =
    selection === null
      ? null
      : (selection.kind === 'target' ? targets : overlays)[selection.index] ?? null;

  return (
    <div className='foe'>
      {/* Background controls */}
      <div className='foe-bg-bar'>
        <label className='foe-upload-btn'>
          {bgBusy ? 'Загрузка…' : backgroundImage ? 'Заменить фон' : '+ Загрузить фон'}
          <input
            type='file'
            accept={IMAGE_ACCEPT}
            hidden
            disabled={bgBusy}
            onChange={(e) => void handleBackgroundUpload(e.target.files?.[0] ?? undefined)}
          />
        </label>
        {backgroundImage && <span className='foe-bg-url'>{backgroundImage}</span>}
        {bgError && <span className='foe-error'>{bgError}</span>}
        <div className='foe-bar-spacer' />
        <label className='foe-preview-toggle'>
          <input
            type='checkbox'
            checked={preview}
            onChange={(e) => {
              setPreview(e.target.checked);
              if (e.target.checked) setSelection(null);
            }}
          />
          <span>Предпросмотр</span>
        </label>
      </div>

      <div className='foe-main'>
        {/* Stage */}
        <div className='foe-stage-wrap'>
          {backgroundImage ? (
            <div className='foe-stage' ref={stageRef}>
              <img
                className='foe-stage-bg'
                src={backgroundImage}
                alt=''
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                }}
                onClick={() => setSelection(null)}
              />
              {/* overlays first, then targets — z-index handles real stacking */}
              {overlays.map((it, i) => (
                <StageItem
                  key={`o-${i}`}
                  item={it}
                  scale={scale}
                  kind='overlay'
                  preview={preview}
                  selected={selection?.kind === 'overlay' && selection.index === i}
                  onSelect={() => setSelection({ kind: 'overlay', index: i })}
                  onMove={(x, y) => updateItem('overlay', i, { x, y })}
                />
              ))}
              {targets.map((it, i) => (
                <StageItem
                  key={`t-${i}`}
                  item={it}
                  scale={scale}
                  kind='target'
                  badge={i + 1}
                  preview={preview}
                  selected={selection?.kind === 'target' && selection.index === i}
                  onSelect={() => setSelection({ kind: 'target', index: i })}
                  onMove={(x, y) => updateItem('target', i, { x, y })}
                />
              ))}
            </div>
          ) : (
            <div className='foe-stage-empty'>Загрузите фоновое изображение, чтобы начать.</div>
          )}

          {/* Floating toolbar for the selected item */}
          {!preview && selection && selectedItem && (
            <ItemToolbar
              item={selectedItem}
              kind={selection.kind}
              index={selection.index}
              isFirst={selection.index === 0}
              isLast={selection.index === (selection.kind === 'target' ? targets.length : overlays.length) - 1}
              onPatch={(patch) => updateItem(selection.kind, selection.index, patch)}
              onZ={(dir) =>
                updateItem(selection.kind, selection.index, {
                  zIndex: selectedItem.zIndex + dir,
                })
              }
              onQueue={(dir) => moveInQueue(selection.index, dir)}
              onRemove={() => removeItem(selection.kind, selection.index)}
            />
          )}
        </div>

        {/* Palette */}
        {!preview && (
          <div className='foe-palette'>
            <ItemList
              title='Цели (по порядку)'
              kind='target'
              items={targets}
              selection={selection}
              busy={addBusy === 'target'}
              ordered
              onSelect={(i) => setSelection({ kind: 'target', index: i })}
              onAdd={(f) => void handleAddItem('target', f)}
            />
            <ItemList
              title='Декорации'
              kind='overlay'
              items={overlays}
              selection={selection}
              busy={addBusy === 'overlay'}
              onSelect={(i) => setSelection({ kind: 'overlay', index: i })}
              onAdd={(f) => void handleAddItem('overlay', f)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage item — rendered over the background, draggable
// ---------------------------------------------------------------------------

interface StageItemProps {
  item: SceneItem;
  scale: number;
  kind: Kind;
  badge?: number;
  preview: boolean;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}

function StageItem({ item, scale, kind, badge, preview, selected, onSelect, onMove }: StageItemProps) {
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(
    null,
  );

  function handlePointerDown(e: React.PointerEvent) {
    if (preview) return;
    e.stopPropagation();
    onSelect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: item.x,
      baseY: item.y,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || scale <= 0) return;
    const dxPx = (e.clientX - d.startX) / scale;
    const dyPx = (e.clientY - d.startY) / scale;
    if (Math.abs(dxPx) > 0.5 || Math.abs(dyPx) > 0.5) d.moved = true;
    onMove(Math.round(d.baseX + dxPx), Math.round(d.baseY + dyPx));
  }

  function handlePointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    if (d) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  }

  const cls = [
    'foe-item',
    selected && !preview ? 'foe-item--selected' : '',
    kind === 'target' ? 'foe-item--target' : 'foe-item--overlay',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={{
        left: `${item.x * scale}px`,
        top: `${item.y * scale}px`,
        zIndex: item.zIndex,
        cursor: preview ? 'default' : 'move',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {item.image ? (
        <img
          className='foe-item-img'
          src={item.image}
          alt=''
          draggable={false}
          style={{
            transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})`,
            filter: item.colorFilter || undefined,
          }}
        />
      ) : (
        <div className='foe-item-placeholder' style={{ transform: 'translate(-50%, -50%)' }}>
          ?
        </div>
      )}
      {!preview && badge !== undefined && <span className='foe-item-badge'>{badge}</span>}
      {!preview && kind === 'overlay' && <span className='foe-item-dot' />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating toolbar for the selected item
// ---------------------------------------------------------------------------

interface ItemToolbarProps {
  item: SceneItem;
  kind: Kind;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (patch: Partial<SceneItem>) => void;
  onZ: (dir: 1 | -1) => void;
  onQueue: (dir: 1 | -1) => void;
  onRemove: () => void;
}

function ItemToolbar({ item, kind, index, isFirst, isLast, onPatch, onZ, onQueue, onRemove }: ItemToolbarProps) {
  const presetMatch = FILTER_PRESETS.find((p) => p.value === item.colorFilter);

  return (
    <div className='foe-toolbar' onPointerDown={(e) => e.stopPropagation()}>
      <div className='foe-toolbar-title'>
        {kind === 'target' ? `Цель #${index + 1}` : 'Декорация'}
      </div>

      <label className='foe-tb-row'>
        <span>Поворот</span>
        <input
          type='range'
          min={-180}
          max={180}
          step={1}
          value={item.rotation}
          onChange={(e) => onPatch({ rotation: Number(e.target.value) })}
        />
        <span className='foe-tb-val'>{item.rotation}°</span>
      </label>

      <label className='foe-tb-row'>
        <span>Масштаб</span>
        <input
          type='range'
          min={0.2}
          max={3}
          step={0.05}
          value={item.scale}
          onChange={(e) => onPatch({ scale: Number(e.target.value) })}
        />
        <span className='foe-tb-val'>{item.scale.toFixed(2)}</span>
      </label>

      <label className='foe-tb-row'>
        <span>Фильтр</span>
        <select
          value={presetMatch ? presetMatch.value : '__custom__'}
          onChange={(e) => {
            if (e.target.value === '__custom__') return;
            onPatch({ colorFilter: e.target.value });
          }}
        >
          {FILTER_PRESETS.map((p) => (
            <option key={p.value || 'none'} value={p.value}>
              {p.label}
            </option>
          ))}
          {!presetMatch && <option value='__custom__'>(своё)</option>}
        </select>
      </label>

      <label className='foe-tb-row'>
        <span>CSS</span>
        <input
          type='text'
          className='foe-tb-filter-input'
          value={item.colorFilter}
          placeholder='напр. blur(2px)'
          onChange={(e) => onPatch({ colorFilter: e.target.value })}
        />
      </label>

      <div className='foe-tb-row foe-tb-buttons'>
        <span>Слой z={item.zIndex}</span>
        <button type='button' title='Поднять слой' onClick={() => onZ(1)}>
          ↑
        </button>
        <button type='button' title='Опустить слой' onClick={() => onZ(-1)}>
          ↓
        </button>
      </div>

      {kind === 'target' && (
        <div className='foe-tb-row foe-tb-buttons'>
          <span>Очередь</span>
          <button type='button' title='Раньше в очереди' disabled={isFirst} onClick={() => onQueue(-1)}>
            ↑
          </button>
          <button type='button' title='Позже в очереди' disabled={isLast} onClick={() => onQueue(1)}>
            ↓
          </button>
        </div>
      )}

      <button type='button' className='foe-tb-remove' onClick={onRemove}>
        Удалить
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette list (targets or overlays)
// ---------------------------------------------------------------------------

interface ItemListProps {
  title: string;
  kind: Kind;
  items: SceneItem[];
  selection: Selection | null;
  busy: boolean;
  ordered?: boolean;
  onSelect: (index: number) => void;
  onAdd: (file: File | undefined) => void;
}

function ItemList({ title, kind, items, selection, busy, ordered, onSelect, onAdd }: ItemListProps) {
  return (
    <div className='foe-list'>
      <div className='foe-list-title'>{title}</div>
      <div className='foe-list-items'>
        {items.map((it, i) => {
          const sel = selection?.kind === kind && selection.index === i;
          return (
            <button
              key={i}
              type='button'
              className={`foe-list-item${sel ? ' foe-list-item--selected' : ''}`}
              onClick={() => onSelect(i)}
            >
              {ordered && <span className='foe-list-num'>{i + 1}</span>}
              {it.image ? (
                <img className='foe-list-thumb' src={it.image} alt='' />
              ) : (
                <span className='foe-list-thumb foe-list-thumb--empty'>?</span>
              )}
            </button>
          );
        })}
        {items.length === 0 && <span className='foe-list-empty'>пусто</span>}
      </div>
      <label className='foe-upload-btn foe-list-add'>
        {busy ? 'Загрузка…' : '+ Загрузить'}
        <input
          type='file'
          accept={IMAGE_ACCEPT}
          hidden
          disabled={busy}
          onChange={(e) => onAdd(e.target.files?.[0] ?? undefined)}
        />
      </label>
    </div>
  );
}
