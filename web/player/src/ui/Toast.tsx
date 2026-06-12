import { useEffect, useRef } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastProps {
  message: string;
  /** If set, the toast auto-dismisses after this many milliseconds. */
  autoDismissMs?: number | undefined;
  /** Action buttons rendered right-to-left (last = primary). */
  actions?: ToastAction[] | undefined;
  onDismiss: () => void;
}

/**
 * Non-blocking toast (bottom-center, dark).
 * Mount/unmount it to show/hide — no internal open/close state.
 */
export function Toast({ message, autoDismissMs, actions, onDismiss }: ToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoDismissMs === undefined) return;
    timerRef.current = setTimeout(onDismiss, autoDismissMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [autoDismissMs, onDismiss]);

  return (
    <div className="toast" role="alert" aria-live="assertive">
      <span className="toast-message">{message}</span>
      {(actions ?? []).length > 0 && (
        <div className="toast-actions">
          {(actions ?? []).map((a) => (
            <button
              key={a.label}
              className="toast-btn"
              type="button"
              onClick={() => { a.onClick(); onDismiss(); }}
            >
              {a.label}
            </button>
          ))}
          <button className="toast-btn toast-btn-dismiss" type="button" onClick={onDismiss}>
            Скрыть
          </button>
        </div>
      )}
    </div>
  );
}
