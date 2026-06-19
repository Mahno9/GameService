import { useRef, useState } from 'react';
import { api } from '../api';

// ---------------------------------------------------------------------------
// JSON-Schema (draft-07) subset + x-type extensions
// ---------------------------------------------------------------------------

export interface Schema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  'x-type'?: string;
}

type Json = unknown;

interface FieldProps {
  schema: Schema;
  value: Json;
  onChange: (next: Json) => void;
  /** Label rendered next to/above the control. */
  label?: string | undefined;
}

// ---------------------------------------------------------------------------
// Default-value helper — produces a sensible blank value for a schema
// ---------------------------------------------------------------------------

function defaultFor(schema: Schema): Json {
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'object': {
      const obj: Record<string, Json> = {};
      if (schema.properties) {
        for (const [key, sub] of Object.entries(schema.properties)) {
          obj[key] = defaultFor(sub);
        }
      }
      return obj;
    }
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'integer':
    case 'number':
      return schema.minimum ?? 0;
    case 'string':
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Asset upload widget (image / gif / audio)
// ---------------------------------------------------------------------------

interface AssetWidgetProps {
  kind: 'image' | 'gif' | 'audio';
  value: string;
  onChange: (url: string) => void;
}

function AssetUploadWidget({ kind, value, onChange }: AssetWidgetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<'idle' | 'init' | 'rec'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const accept = kind === 'audio' ? 'audio/*' : kind === 'gif' ? 'image/gif,image/*' : 'image/*';

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await api.uploadAsset(file);
      onChange(asset.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (recorderRef.current) return;
    setError(null);
    setRecording('init');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = recorder.mimeType || 'audio/webm';
        const ext = mime.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        void handleFile(new File([blob], `mic-recording.${ext}`, { type: mime }));
        setRecording('idle');
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording('rec');
    } catch {
      setError('Нет доступа к микрофону');
      setRecording('idle');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
  }

  return (
    <div className='sf-asset'>
      <input
        type='file'
        accept={accept}
        disabled={busy}
        onChange={(e) => void handleFile(e.target.files?.[0] ?? undefined)}
      />
      {kind === 'audio' && (
        <button
          type='button'
          className={`sf-record-btn${recording === 'rec' ? ' sf-record-btn--active' : ''}`}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void startRecording(); }}
          onPointerUp={stopRecording}
          onPointerLeave={stopRecording}
          disabled={busy || recording === 'init'}
        >
          {recording === 'init' ? '⏳ Инициализация…' : recording === 'rec' ? '⏹ Запись… (отпустите)' : '🎙 Записать с микрофона'}
        </button>
      )}
      {busy && <span className='sf-asset-hint'>Загрузка…</span>}
      {error && <span className='sf-asset-error'>{error}</span>}
      {value && (kind === 'audio' ? (
        <audio className='sf-asset-preview' controls src={value} />
      ) : (
        <img className='sf-asset-preview' src={value} alt='' />
      ))}
      {value && (
        <button type='button' className='sf-asset-clear' onClick={() => onChange('')}>
          Убрать
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field dispatcher — picks a control based on type / x-type / enum
// ---------------------------------------------------------------------------

function Field({ schema, value, onChange, label }: FieldProps) {
  const title = label ?? schema.title;

  // enum → select
  if (schema.enum) {
    const current = value === undefined ? schema.default : value;
    return (
      <label className='sf-field'>
        {title && <span className='sf-label'>{title}</span>}
        <select
          value={String(current ?? '')}
          onChange={(e) => {
            const raw = e.target.value;
            const match = schema.enum?.find((o) => String(o) === raw);
            onChange(match ?? raw);
          }}
        >
          {schema.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // x-type asset widgets (string-typed)
  const xType = schema['x-type'];
  if (xType === 'asset:image' || xType === 'asset:gif' || xType === 'asset:audio') {
    const kind = xType === 'asset:audio' ? 'audio' : xType === 'asset:gif' ? 'gif' : 'image';
    return (
      <label className='sf-field'>
        {title && <span className='sf-label'>{title}</span>}
        <AssetUploadWidget
          kind={kind}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      </label>
    );
  }

  switch (schema.type) {
    case 'object':
      return <ObjectField schema={schema} value={value} onChange={onChange} label={title} />;

    case 'array':
      return <ArrayField schema={schema} value={value} onChange={onChange} label={title} />;

    case 'boolean':
      return (
        <label className='sf-field sf-field-check'>
          <input
            type='checkbox'
            checked={value === undefined ? Boolean(schema.default) : Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {title && <span className='sf-label'>{title}</span>}
        </label>
      );

    case 'integer':
    case 'number': {
      const current = value === undefined ? schema.default : value;
      return (
        <label className='sf-field'>
          {title && <span className='sf-label'>{title}</span>}
          <input
            type='number'
            value={current === undefined || current === null ? '' : String(current)}
            min={schema.minimum}
            max={schema.maximum}
            step={schema.type === 'integer' ? 1 : 'any'}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange(undefined);
                return;
              }
              const num = schema.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
              onChange(Number.isNaN(num) ? undefined : num);
            }}
          />
        </label>
      );
    }

    case 'string':
    default:
      // string + unknown x-type → plain text input
      return (
        <label className='sf-field'>
          {title && <span className='sf-label'>{title}</span>}
          <input
            type='text'
            value={typeof value === 'string' ? value : value === undefined ? String(schema.default ?? '') : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}

// ---------------------------------------------------------------------------
// Object field → fieldset of properties
// ---------------------------------------------------------------------------

function ObjectField({ schema, value, onChange, label }: FieldProps) {
  const obj = (value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {}) as Record<string, Json>;

  const props = schema.properties ?? {};

  function setKey(key: string, next: Json) {
    onChange({ ...obj, [key]: next });
  }

  return (
    <fieldset className='sf-fieldset'>
      {label && <legend className='sf-legend'>{label}</legend>}
      {Object.entries(props).map(([key, sub]) => (
        <Field
          key={key}
          schema={sub}
          value={obj[key]}
          onChange={(next) => setKey(key, next)}
          label={sub.title ?? key}
        />
      ))}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Array field → repeatable rows
// ---------------------------------------------------------------------------

function ArrayField({ schema, value, onChange, label }: FieldProps) {
  const items = Array.isArray(value) ? (value as Json[]) : [];
  const itemSchema = schema.items ?? { type: 'string' };

  function setItem(index: number, next: Json) {
    const copy = items.slice();
    copy[index] = next;
    onChange(copy);
  }

  function addItem() {
    onChange([...items, defaultFor(itemSchema)]);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <fieldset className='sf-fieldset sf-array'>
      {label && <legend className='sf-legend'>{label}</legend>}
      {items.map((item, index) => (
        <div className='sf-array-row' key={index}>
          <div className='sf-array-item'>
            <Field
              schema={itemSchema}
              value={item}
              onChange={(next) => setItem(index, next)}
            />
          </div>
          <button
            type='button'
            className='sf-array-remove'
            title='Удалить'
            onClick={() => removeItem(index)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type='button' className='sf-array-add' onClick={addItem}>
        + Добавить
      </button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Public component — controlled form over the whole config object
// ---------------------------------------------------------------------------

export interface SchemaFormProps {
  schema: Schema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  return (
    <div className='schema-form'>
      <ObjectField
        schema={schema}
        value={value}
        onChange={(next) => onChange((next ?? {}) as Record<string, unknown>)}
      />
    </div>
  );
}
