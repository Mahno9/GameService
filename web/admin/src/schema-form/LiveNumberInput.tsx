import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// LiveNumberInput — a number field that does NOT validate while you type:
// you can clear it completely, leave partial values like "0.000", etc. It only
// commits on blur (Enter blurs too). If the buffer isn't a valid number, it
// reverts to the previous value. This lets you retype from scratch and edit the
// significant digits of very small numbers without auto-coercion mid-edit.
// ---------------------------------------------------------------------------

interface Props {
  value: number | undefined;
  /** shown when value is undefined (e.g. a schema default) */
  fallback?: number | undefined;
  integer?: boolean;
  min?: number | undefined;
  max?: number | undefined;
  className?: string | undefined;
  onCommit: (n: number) => void;
}

function display(value: number | undefined, fallback: number | undefined): string {
  const v = value !== undefined ? value : fallback;
  return v === undefined || v === null ? '' : String(v);
}

export function LiveNumberInput({ value, fallback, integer, min, max, className, onCommit }: Props) {
  const [text, setText] = useState(() => display(value, fallback));
  const focusedRef = useRef(false);

  // Sync from the outside only while not being edited.
  useEffect(() => {
    if (!focusedRef.current) setText(display(value, fallback));
  }, [value, fallback]);

  function commit() {
    focusedRef.current = false;
    const t = text.trim();
    const n = Number(t);
    if (t === '' || !Number.isFinite(n)) {
      setText(display(value, fallback)); // invalid → revert
      return;
    }
    const final = integer ? Math.trunc(n) : n;
    onCommit(final);
    setText(String(final));
  }

  return (
    <input
      type='text'
      inputMode={integer ? 'numeric' : 'decimal'}
      className={className}
      value={text}
      min={min}
      max={max}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
