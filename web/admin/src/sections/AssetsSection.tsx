import { useEffect, useRef, useState } from 'react';
import { api, type Asset, type Settings } from '../api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} МБ`;
  return `${(bytes / 1_000).toFixed(1)} КБ`;
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  image: 'Изображение',
  gif: 'GIF',
  audio: 'Аудио',
};

// ---------------------------------------------------------------------------
// Asset card
// ---------------------------------------------------------------------------

interface AssetCardProps {
  asset: Asset;
  onDelete: (id: string) => void;
}

function AssetCard({ asset, onDelete }: AssetCardProps) {
  function handleDelete() {
    if (window.confirm(`Удалить файл «${asset.originalName}»?`)) {
      onDelete(asset.id);
    }
  }

  return (
    <div className='asset-card'>
      <div className='asset-card-preview'>
        {(asset.kind === 'image' || asset.kind === 'gif') ? (
          <img src={asset.url} alt={asset.originalName} className='asset-thumb' />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio controls src={asset.url} className='asset-audio' />
        )}
      </div>
      <div className='asset-card-info'>
        <span className='asset-name' title={asset.originalName}>{asset.originalName}</span>
        <div className='asset-meta'>
          <span className={`asset-kind-badge asset-kind-badge--${asset.kind}`}>
            {KIND_LABEL[asset.kind]}
          </span>
          <span className='asset-size'>{formatSize(asset.sizeBytes)}</span>
        </div>
      </div>
      <button className='asset-delete-btn' onClick={handleDelete} title='Удалить'>
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sound picker modal
// ---------------------------------------------------------------------------

interface SoundPickerProps {
  audioAssets: Asset[];
  currentUrl: string | null;
  onSelect: (url: string | null) => void;
  onClose: () => void;
}

function SoundPicker({ audioAssets, currentUrl, onSelect, onClose }: SoundPickerProps) {
  return (
    <div className='modal-overlay' onClick={onClose}>
      <div
        className='modal-card'
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='modal-header'>
          <span className='modal-title'>Выбрать звук нажатия</span>
          <button className='modal-close' onClick={onClose}>✕</button>
        </div>
        <div className='modal-body'>
          {audioAssets.length === 0 ? (
            <p className='assets-empty'>Нет загруженных аудиофайлов</p>
          ) : (
            <div className='sound-picker-list'>
              {audioAssets.map((a) => (
                <button
                  key={a.id}
                  className={`sound-picker-item${currentUrl === a.url ? ' sound-picker-item--active' : ''}`}
                  onClick={() => { onSelect(a.url); onClose(); }}
                >
                  <span className='sound-picker-name'>{a.originalName}</span>
                  <span className='asset-size'>{formatSize(a.sizeBytes)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className='modal-actions'>
          <button onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function AssetsSection() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const [soundSaving, setSoundSaving] = useState(false);
  const [soundSaved, setSoundSaved] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load assets + settings on mount
  useEffect(() => {
    void Promise.all([api.getAssets(), api.getSettings()]).then(([list, s]) => {
      setAssets(list);
      setSettings(s);
      setSoundUrl(s.ui_click_sound_url);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleUpload(files: FileList) {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded: Asset[] = [];
      for (const file of Array.from(files)) {
        const asset = await api.uploadAsset(file);
        uploaded.push(asset);
      }
      setAssets((prev) => [...uploaded, ...prev]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      // If deleted asset was the current sound, clear it
      const deleted = assets.find((a) => a.id === id);
      if (deleted && soundUrl === deleted.url) {
        await saveSoundUrl(null);
      }
    } catch {
      // ignore
    }
  }

  async function saveSoundUrl(url: string | null) {
    setSoundSaving(true);
    try {
      const updated = await api.updateSettings({ ui_click_sound_url: url });
      setSoundUrl(updated.ui_click_sound_url);
      setSettings(updated);
      setSoundSaved(true);
      setTimeout(() => setSoundSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSoundSaving(false);
    }
  }

  const audioAssets = assets.filter((a) => a.kind === 'audio');
  const currentSoundAsset = soundUrl ? assets.find((a) => a.url === soundUrl) : undefined;

  return (
    <div className='assets-section'>
      {/* Upload zone */}
      <div className='assets-header'>
        <h3 className='assets-title'>Ассеты</h3>
        <label
          className={`assets-upload-zone${uploading ? ' assets-upload-zone--busy' : ''}`}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
              void handleUpload(e.dataTransfer.files);
            }
          }}
        >
          <input
            ref={fileInputRef}
            type='file'
            multiple
            accept='image/*,audio/*,.gif'
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleUpload(e.target.files);
                e.target.value = '';
              }
            }}
          />
          {uploading
            ? 'Загрузка…'
            : 'Перетащите файлы сюда или нажмите для выбора'}
        </label>
        {uploadError && <p className='assets-upload-error'>{uploadError}</p>}
      </div>

      {/* Sound setting block */}
      <div className='assets-sound-block'>
        <h4 className='assets-block-title'>Звук нажатия кнопок (мета)</h4>
        <div className='assets-sound-row'>
          {soundUrl ? (
            <>
              <span className='assets-sound-name'>
                {currentSoundAsset?.originalName ?? soundUrl}
              </span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={soundUrl} className='assets-sound-preview' />
            </>
          ) : (
            <span className='assets-sound-none'>Не задан</span>
          )}
        </div>
        <div className='assets-sound-actions'>
          <button
            disabled={soundSaving || audioAssets.length === 0}
            onClick={() => setShowPicker(true)}
          >
            Выбрать из загруженных
          </button>
          {soundUrl && (
            <button
              className='assets-sound-clear-btn'
              disabled={soundSaving}
              onClick={() => { void saveSoundUrl(null); }}
            >
              Очистить
            </button>
          )}
          {soundSaved && <span className='assets-sound-saved'>Сохранено ✓</span>}
        </div>
        {audioAssets.length === 0 && (
          <p className='assets-sound-hint'>
            Загрузите аудиофайл (mp3, ogg, wav) в ассеты, чтобы выбрать его здесь.
          </p>
        )}
      </div>

      {/* Asset grid */}
      {loading ? (
        <p className='assets-loading'>Загрузка…</p>
      ) : assets.length === 0 ? (
        <p className='assets-empty'>Нет загруженных ассетов</p>
      ) : (
        <div className='assets-grid'>
          {assets.map((a) => (
            <AssetCard key={a.id} asset={a} onDelete={(id) => { void handleDelete(id); }} />
          ))}
        </div>
      )}

      {showPicker && (
        <SoundPicker
          audioAssets={audioAssets}
          currentUrl={soundUrl}
          onSelect={(url) => { void saveSoundUrl(url); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
