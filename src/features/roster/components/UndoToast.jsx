import React, { useState, useEffect, useRef } from 'react';

/**
 * 10-Second Undo toast notification.
 * UI convenience only: invokes real authoritative Phase 5 reversal.
 * Cleans up timers cleanly to prevent hanging tests.
 */
export default function UndoToast({
  undoEvent,
  onUndo,
  onExpire,
  durationMs = 10000
}) {
  const [secondsRemaining, setSecondsRemaining] = useState(() => Math.ceil(durationMs / 1000));
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoError, setUndoError] = useState(null);
  const timerRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!undoEvent) return;

    setSecondsRemaining(Math.ceil(durationMs / 1000));
    setIsUndoing(false);
    setUndoError(null);

    // 1-second countdown ticker for UX display
    intervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    if (typeof intervalRef.current?.unref === 'function') {
      intervalRef.current.unref();
    }

    // Expiration timer
    timerRef.current = setTimeout(() => {
      clearInterval(intervalRef.current);
      onExpire?.();
    }, durationMs);
    if (typeof timerRef.current?.unref === 'function') {
      timerRef.current.unref();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [undoEvent, durationMs, onExpire]);

  if (!undoEvent) return null;

  const handleUndoClick = async () => {
    if (isUndoing) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);

    setIsUndoing(true);
    setUndoError(null);
    try {
      await onUndo(undoEvent);
    } catch (err) {
      setUndoError(err.message || 'Undo failed');
      setIsUndoing(false);
    }
  };

  return (
    <div
      id="undo-toast-container"
      data-testid="undo-toast"
      className="fixed bottom-6 right-6 z-50 max-w-md rounded-2xl bg-slate-900 text-white p-4 shadow-2xl border border-slate-700/80 animate-slideUp flex flex-col gap-2"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-sm font-bold">
            ✓
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-200">
              {undoEvent.description || 'Change confirmed.'}
            </p>
            <p className="text-[11px] text-slate-400">
              Authoritative update saved. Undo available for {secondsRemaining}s.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            id="btn-undo-action"
            onClick={handleUndoClick}
            disabled={isUndoing}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 active:scale-95 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isUndoing ? (
              <>
                <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                <span>Reversing…</span>
              </>
            ) : (
              <>
                <span>↩️</span>
                <span>Undo</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (timerRef.current) clearTimeout(timerRef.current);
              if (intervalRef.current) clearInterval(intervalRef.current);
              onExpire?.();
            }}
            disabled={isUndoing}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Dismiss notification"
          >
            ✕
          </button>
        </div>
      </div>

      {undoError && (
        <div className="mt-1 p-2 rounded-lg bg-rose-950/80 border border-rose-800 text-[11px] text-rose-300">
          {undoError}
        </div>
      )}
    </div>
  );
}
