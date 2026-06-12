import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';

// ---------------------------------------------------------------------------
// Field with save-on-blur
// ---------------------------------------------------------------------------

interface NumFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  min?: number;
  step?: number;
}

function NumField({ label, value, onChange, onBlur, min, step }: NumFieldProps) {
  return (
    <div className='debug-field'>
      <label className='debug-field-label'>{label}</label>
      <input
        className='debug-num-input'
        type='number'
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function DebugSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [speedDraft, setSpeedDraft] = useState('');
  const [gpsDraft, setGpsDraft] = useState('');
  const [syncDraft, setSyncDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setDebugMode(s.debug_mode);
        setSpeedDraft(String(s.joystick_speed_mps));
        setGpsDraft(String(s.gps_timeout_min));
        setSyncDraft(String(s.sync_interval_s));
      })
      .catch(() => setError('Не удалось загрузить настройки'));
  }, []);

  async function patch(updates: Partial<Settings>) {
    setError(null);
    try {
      const updated = await api.updateSettings(updates);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Ошибка сохранения');
    }
  }

  function handleToggle(checked: boolean) {
    setDebugMode(checked);
    void patch({ debug_mode: checked });
  }

  function handleSpeedBlur() {
    const val = parseFloat(speedDraft);
    if (!isNaN(val) && val > 0) void patch({ joystick_speed_mps: val });
  }

  function handleGpsBlur() {
    const val = parseFloat(gpsDraft);
    if (!isNaN(val) && val > 0) void patch({ gps_timeout_min: val });
  }

  function handleSyncBlur() {
    const val = parseInt(syncDraft, 10);
    if (!isNaN(val) && val > 0) void patch({ sync_interval_s: val });
  }

  if (!settings) {
    return (
      <div className='debug-section'>
        {error ? (
          <p className='debug-error'>{error}</p>
        ) : (
          <p className='debug-hint'>Загрузка…</p>
        )}
      </div>
    );
  }

  return (
    <div className='debug-section'>
      <h3 className='debug-section-title'>Дебаг-режим</h3>

      {/* Toggle */}
      <div className='debug-toggle-row'>
        <span className='debug-field-label'>
          Глобальный дебаг-режим
          <span className='debug-hint-inline'>
            &nbsp;— включает виртуальный джойстик у всех пользователей
          </span>
        </span>
        <label className='switch'>
          <input
            type='checkbox'
            role='switch'
            checked={debugMode}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          <span className='switch-track'>
            <span className='switch-thumb' />
          </span>
        </label>
      </div>

      <div className='debug-fields'>
        <NumField
          label='Скорость джойстика (м/с)'
          value={speedDraft}
          onChange={setSpeedDraft}
          onBlur={handleSpeedBlur}
          min={0.1}
          step={0.1}
        />
        <NumField
          label='Таймаут потери GPS (мин)'
          value={gpsDraft}
          onChange={setGpsDraft}
          onBlur={handleGpsBlur}
          min={1}
          step={1}
        />
        <NumField
          label='Интервал синхронизации (сек)'
          value={syncDraft}
          onChange={setSyncDraft}
          onBlur={handleSyncBlur}
          min={1}
          step={1}
        />
      </div>

      {saved && <p className='debug-saved'>Сохранено ✓</p>}
      {error && <p className='debug-error'>{error}</p>}
    </div>
  );
}
