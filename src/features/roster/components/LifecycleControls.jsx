import { useState, useEffect, useCallback } from 'react';
import { draftRuntime } from '../queue/runtime.js';
import { terminal } from '../queue/state.js';
import protocol from '../queue/protocol.js';

const ERROR_MESSAGES = {
  REVISION_CONFLICT: 'The roster or lifecycle state was updated from another session. Please refresh before proceeding.',
  CHECKSUM_MISMATCH: 'Checksum verification mismatch. Retrying will repair the target snapshot.',
  RECOVERY_REQUIRED: 'The operation outcome requires reconciliation. Retrying will resolve confirmed state.',
  SNAPSHOT_IMMUTABLE: 'This period is already published and its planned snapshot is locked.',
  INVALID_STATE: 'This lifecycle action is not allowed from the current period state.',
  INVALID_LIFECYCLE_TRANSITION: 'The requested transition is not permitted by the lifecycle state machine.',
  RECONCILIATION_FAILED: 'Cannot close period: pending or unconfirmed operations remain in the journal. Period remains Published.',
  REOPEN_REASON_REQUIRED: 'A non-empty reason is strictly required to reopen a closed period.',
  AMENDED_RESERVED_PHASE5: 'Amended roster workflow is reserved for Phase 5.',
  FEATURE_DISABLED: 'Lifecycle mutations are currently disabled in system settings.',
  LIFECYCLE_OPERATION_PENDING: 'Another lifecycle operation is currently in progress for this period.',
  NETWORK_AMBIGUOUS: 'Network response was interrupted. The operation is queued for automatic status reconciliation.',
  PERMANENT_FAILURE: 'The lifecycle operation failed permanently and cannot be retried unchanged.'
};

export function LifecycleBadge({ state, pendingOp, loading }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200" aria-live="polite">
        <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse" />
        Checking lifecycle…
      </span>
    );
  }

  if (pendingOp) {
    if (pendingOp.status === 'RECOVERY_REQUIRED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-300" aria-live="polite">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Recovery required
        </span>
      );
    }
    const actionLabel = pendingOp.operationType === 'PERIOD_PUBLISH'
      ? 'Publishing…'
      : pendingOp.operationType === 'PERIOD_CLOSE'
      ? 'Closing…'
      : pendingOp.operationType === 'PERIOD_REOPEN'
      ? 'Reopening…'
      : 'Processing…';

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200" aria-live="polite">
        <span className="h-2 w-2 rounded-full bg-indigo-500 animate-ping" />
        {actionLabel}
      </span>
    );
  }

  const normalized = String(state || 'DRAFT').toUpperCase();
  switch (normalized) {
    case 'PUBLISHED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-sm" title="Planned Snapshot is locked for editing">
          <span className="text-emerald-600">✓</span> Published
        </span>
      );
    case 'CLOSED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300 shadow-sm" title="Period is historically locked and read-only">
          <span className="text-slate-600">🔒</span> Closed
        </span>
      );
    case 'AMENDED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-300 shadow-sm">
          <span>✨</span> Amended
        </span>
      );
    case 'DRAFT':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Draft
        </span>
      );
  }
}

export function PublishModal({ isOpen, onClose, onConfirm, isSubmitting, error, period }) {
  const [adminNote, setAdminNote] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAdminNote('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="publish-modal-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 animate-fadeIn">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 text-xl font-bold">
            📢
          </div>
          <div>
            <h3 id="publish-modal-title" className="text-lg font-bold text-slate-800">Publish Roster — {period}</h3>
            <p className="text-xs text-slate-500">Phase 4 Planned Snapshot Freeze</p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-200">
          <p className="font-semibold text-slate-700">Before publishing, please note:</p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600">
            <li>The current monthly roster will become the <strong>immutable Planned Snapshot</strong>.</li>
            <li>Normal draft editing for period <strong>{period}</strong> will stop.</li>
            <li>Any pending draft changes will be flushed and server-confirmed before publication.</li>
            <li>Future adjustments will belong to the post-publication amendment workflow.</li>
          </ul>
        </div>

        <div className="mt-4">
          <label htmlFor="publish-admin-note" className="block text-xs font-semibold text-slate-700 mb-1">
            Administrator Note (optional)
          </label>
          <input
            id="publish-admin-note"
            type="text"
            className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            placeholder="e.g. Official finalized roster approved by HOD"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700" role="alert">
            <p className="font-bold">Publication Error</p>
            <p>{ERROR_MESSAGES[error] || error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 shadow-md shadow-indigo-100"
            onClick={() => onConfirm(adminNote)}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Publishing…
              </>
            ) : (
              'Publish Roster'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CloseModal({ isOpen, onClose, onConfirm, isSubmitting, error, period }) {
  const [adminNote, setAdminNote] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAdminNote('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="close-modal-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 animate-fadeIn">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 text-xl font-bold">
            🔒
          </div>
          <div>
            <h3 id="close-modal-title" className="text-lg font-bold text-slate-800">Close Period — {period}</h3>
            <p className="text-xs text-slate-500">Historical Lock & Final Archival</p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-slate-600 bg-amber-50/60 p-4 rounded-xl border border-amber-200">
          <p className="font-semibold text-amber-900">Historical Lock Confirmation:</p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-amber-800">
            <li>Period <strong>{period}</strong> will become historically locked and read-only.</li>
            <li>Authoritative server reconciliation will run upon confirmation to verify all operations are settled.</li>
            <li>No further roster modifications can be performed while the period is closed.</li>
            <li>Only an authorized administrator can reopen this period with an explicit audit reason.</li>
          </ul>
        </div>

        <div className="mt-4">
          <label htmlFor="close-admin-note" className="block text-xs font-semibold text-slate-700 mb-1">
            Administrator Note (optional)
          </label>
          <input
            id="close-admin-note"
            type="text"
            className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
            placeholder="e.g. End-of-month final administrative close"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700" role="alert">
            <p className="font-bold">Close Blocked</p>
            <p>{ERROR_MESSAGES[error] || error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 shadow-md shadow-amber-100"
            onClick={() => onConfirm(adminNote)}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Closing Period…
              </>
            ) : (
              'Close Period'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReopenModal({ isOpen, onClose, onConfirm, isSubmitting, error, period }) {
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setValidationError('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setValidationError('A non-empty reason is strictly required to reopen a closed period.');
      return;
    }
    setValidationError('');
    onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="reopen-modal-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 animate-fadeIn">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 text-xl font-bold">
            🔓
          </div>
          <div>
            <h3 id="reopen-modal-title" className="text-lg font-bold text-slate-800">Reopen Period — {period}</h3>
            <p className="text-xs text-slate-500">Administrative Audit Reopening</p>
          </div>
        </div>

        <p className="text-xs text-slate-600 mb-3 leading-relaxed">
          Reopening period <strong>{period}</strong> returns it to <strong>Published</strong> state for audited administrative corrections. An explicit reason must be provided for the permanent audit log.
        </p>

        <div className="mt-3">
          <label htmlFor="reopen-reason" className="block text-xs font-semibold text-slate-700 mb-1">
            Reason for Reopening <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="reopen-reason"
            rows={3}
            className={`w-full rounded-lg border p-2 text-sm focus:ring-1 disabled:opacity-50 ${
              validationError ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'
            }`}
            placeholder="e.g. Approved retrospective schedule adjustment requested by clinical head..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (validationError && e.target.value.trim()) setValidationError('');
            }}
            disabled={isSubmitting}
          />
          {validationError && (
            <p className="mt-1 text-xs text-rose-600 font-medium">{validationError}</p>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700" role="alert">
            <p className="font-bold">Reopen Failed</p>
            <p>{ERROR_MESSAGES[error] || error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shadow-md shadow-blue-100"
            onClick={handleConfirm}
            disabled={isSubmitting || !reason.trim()}
          >
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Reopening…
              </>
            ) : (
              'Reopen Period'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LifecycleControls({
  period,
  settings,
  isAdmin = false,
  queue: externalQueue = null,
  runtimeFactory = draftRuntime,
  onLifecycleStateChange = null
}) {
  const [queue, setQueue] = useState(externalQueue);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [fetchedLifecycle, setFetchedLifecycle] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modals state
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [isCloseOpen, setIsCloseOpen] = useState(false);
  const [isReopenOpen, setIsReopenOpen] = useState(false);

  const key = `draft:${period}`;

  // Queue resolution and lifecycle fetching
  useEffect(() => {
    let live = true;
    let unsubscribe;
    setLoading(true);
    setIsEnrolled(false);
    setFetchedLifecycle(null);
    setActionError(null);
    setIsPublishOpen(false);
    setIsCloseOpen(false);
    setIsReopenOpen(false);

    (async () => {
      try {
        const q = externalQueue || await runtimeFactory(settings);
        if (!live) return;
        setQueue(q);

        unsubscribe = q.subscribe(() => {
          if (live) setTick((n) => n + 1);
        });

        await q.start?.();
        if (!live) return;

        // Fetch lifecycle state for this specific period
        const res = await q.getPeriodLifecycle(period).catch(() => ({ ok: false }));
        if (!live) return;

        if (res.ok && res.period) {
          setIsEnrolled(true);
          const state = res.period.State;
          const revision = Number(res.period.Revision || 0);
          setFetchedLifecycle({ state, revision });
          onLifecycleStateChange?.({
            period,
            isEnrolled: true,
            state,
            revision
          });
        } else {
          setIsEnrolled(false);
          setFetchedLifecycle(null);
          onLifecycleStateChange?.({
            period,
            isEnrolled: false,
            state: null,
            revision: null
          });
        }
      } catch (err) {
        if (live) {
          setIsEnrolled(false);
          setFetchedLifecycle(null);
          setActionError(err.code || err.message);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [period, settings, externalQueue, runtimeFactory]);

  const view = queue?.view(key);
  const confirmedState = String(view?.lifecycle?.state || fetchedLifecycle?.state || 'DRAFT').toUpperCase();
  const pendingOp = view?.operations?.find((o) => !terminal(o) && o.operationClass === 'LIFECYCLE');
  const mutationsEnabled = Boolean(queue?.enabled?.());

  // Propagate state update if view changes
  useEffect(() => {
    if (isEnrolled && view?.lifecycle?.state) {
      onLifecycleStateChange?.({
        period,
        isEnrolled: true,
        state: view.lifecycle.state,
        revision: view.lifecycle.revision
      });
    }
  }, [isEnrolled, view?.lifecycle?.state, view?.lifecycle?.revision, period, onLifecycleStateChange]);

  // Actions
  const handlePublishConfirm = useCallback(async (adminNote) => {
    if (!queue || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await queue.publish(period, { adminNote });
      setIsPublishOpen(false);
      if (res?.state) {
        setFetchedLifecycle({ state: res.state, revision: res.revision });
        onLifecycleStateChange?.({
          period,
          isEnrolled: true,
          state: res.state,
          revision: res.revision
        });
      }
    } catch (err) {
      setActionError(err.code || err.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [queue, period, isSubmitting, onLifecycleStateChange]);

  const handleCloseConfirm = useCallback(async (adminNote) => {
    if (!queue || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await queue.close(period, { adminNote });
      setIsCloseOpen(false);
      if (res?.state) {
        setFetchedLifecycle({ state: res.state, revision: res.revision });
        onLifecycleStateChange?.({
          period,
          isEnrolled: true,
          state: res.state,
          revision: res.revision
        });
      }
    } catch (err) {
      setActionError(err.code || err.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [queue, period, isSubmitting, onLifecycleStateChange]);

  const handleReopenConfirm = useCallback(async (reason) => {
    if (!queue || isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await queue.reopen(period, reason);
      setIsReopenOpen(false);
      if (res?.state) {
        setFetchedLifecycle({ state: res.state, revision: res.revision });
        onLifecycleStateChange?.({
          period,
          isEnrolled: true,
          state: res.state,
          revision: res.revision
        });
      }
    } catch (err) {
      setActionError(err.code || err.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [queue, period, isSubmitting, onLifecycleStateChange]);

  const handleRetryPending = useCallback(async () => {
    if (!queue || !pendingOp) return;
    setActionError(null);
    try {
      await queue.retry(key, pendingOp.operationId);
    } catch (err) {
      setActionError(err.code || err.message);
    }
  }, [queue, key, pendingOp]);

  // Non-enrolled periods are legacy: preserve existing behavior without rendering V2 lifecycle controls
  if (!loading && !isEnrolled) {
    return null;
  }

  const isLocked = confirmedState === 'PUBLISHED' || confirmedState === 'CLOSED';
  const hasActiveLifecycleOp = Boolean(pendingOp);

  return (
    <div className="flex flex-wrap items-center gap-3" aria-label="Roster lifecycle status and controls">
      <LifecycleBadge state={confirmedState} pendingOp={pendingOp} loading={loading} />

      {/* Recover / Retry action if operation is blocked */}
      {pendingOp?.status === 'RECOVERY_REQUIRED' && isAdmin && (
        <button
          type="button"
          onClick={handleRetryPending}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition-all shadow-sm"
        >
          <span>🔄</span> Retry / Reconcile
        </button>
      )}

      {/* Admin Action Buttons */}
      {isAdmin && !hasActiveLifecycleOp && !loading && (
        <div className="flex items-center gap-2">
          {confirmedState === 'DRAFT' && (
            <button
              type="button"
              disabled={!mutationsEnabled}
              title={!mutationsEnabled ? 'Lifecycle mutations disabled in settings' : undefined}
              onClick={() => {
                setActionError(null);
                setIsPublishOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>📢</span> Publish Roster
            </button>
          )}

          {confirmedState === 'PUBLISHED' && (
            <button
              type="button"
              disabled={!mutationsEnabled}
              title={!mutationsEnabled ? 'Lifecycle mutations disabled in settings' : undefined}
              onClick={() => {
                setActionError(null);
                setIsCloseOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-700 text-white hover:bg-slate-800 active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>🔒</span> Close Period
            </button>
          )}

          {confirmedState === 'CLOSED' && (
            <button
              type="button"
              disabled={!mutationsEnabled}
              title={!mutationsEnabled ? 'Lifecycle mutations disabled in settings' : undefined}
              onClick={() => {
                setActionError(null);
                setIsReopenOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>🔓</span> Reopen Period
            </button>
          )}
        </div>
      )}

      {/* Surface top-level queue or operation error if present */}
      {actionError && !isPublishOpen && !isCloseOpen && !isReopenOpen && (
        <span className="text-xs text-rose-600 font-medium" role="alert">
          {ERROR_MESSAGES[actionError] || actionError}
        </span>
      )}

      {/* Modals */}
      <PublishModal
        isOpen={isPublishOpen}
        onClose={() => setIsPublishOpen(false)}
        onConfirm={handlePublishConfirm}
        isSubmitting={isSubmitting}
        error={actionError}
        period={period}
      />

      <CloseModal
        isOpen={isCloseOpen}
        onClose={() => setIsCloseOpen(false)}
        onConfirm={handleCloseConfirm}
        isSubmitting={isSubmitting}
        error={actionError}
        period={period}
      />

      <ReopenModal
        isOpen={isReopenOpen}
        onClose={() => setIsReopenOpen(false)}
        onConfirm={handleReopenConfirm}
        isSubmitting={isSubmitting}
        error={actionError}
        period={period}
      />
    </div>
  );
}
