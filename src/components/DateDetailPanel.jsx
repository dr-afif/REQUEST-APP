import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeForComparison, toIsoDate } from '../utils/normalise';
import NewRequestForm from './NewRequestForm';

function formatDisplayDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const VARIANT_STYLES = {
  am:     { background: '#ecfdf5', color: '#047857', borderColor: '#34d399' },
  pm:     { background: '#fef3c7', color: '#b45309', borderColor: '#facc15' },
  night:  { background: '#fee2e2', color: '#b91c1c', borderColor: '#f87171' },
  on:     { background: '#fee2e2', color: '#b91c1c', borderColor: '#f87171' },
  course: { background: '#dbeafe', color: '#1d4ed8', borderColor: '#60a5fa' },
  off:    { background: '#ede9fe', color: '#5b21b6', borderColor: '#a855f7' },
  leave:  { background: '#ede9fe', color: '#5b21b6', borderColor: '#a855f7' },
  al:     { background: '#ede9fe', color: '#5b21b6', borderColor: '#a855f7' },
  hka:    { background: '#f3e8ff', color: '#7c3aed', borderColor: '#c084fc' },
  ghka:   { background: '#e0e7ff', color: '#4338ca', borderColor: '#6366f1' },
};

function getVariantStyle(request) {
  const key = (request ?? '').toString().trim().toLowerCase();
  return VARIANT_STYLES[key] ?? { background: '#f8fafc', color: '#0f172a', borderColor: '#e2e8f0' };
}

export default function DateDetailPanel({
  date,
  requests = [],
  selectedName,
  onClose,
  onEdit,
  onDelete,
  onSubmit,
  isSubmitting,
  editingRequest,
  shiftTypes = [],
  limitGroups = [],
  shiftBlocks = [],
  error = '',
  settings = {},
  names = [],
}) {
  const [open, setOpen] = useState(false);

  // Trigger entry animation on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close with exit animation
  const handleClose = () => {
    setOpen(false);
    setTimeout(() => onClose?.(), 320);
  };

  // Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Lock body scroll while panel is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const dateKey = toIsoDate(date);
  const displayDate = formatDisplayDate(date);

  // All active requests for this date
  const allDateRequests = requests.filter(
    (r) => r.status?.toLowerCase() === 'active' && toIsoDate(r.date) === dateKey,
  );

  // Pre-fill form with selected date (no id → new request mode)
  const formInitialValues = editingRequest ?? (dateKey ? { date: dateKey } : null);

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`date-panel__backdrop${open ? ' date-panel__backdrop--open' : ''}`}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`date-panel${open ? ' date-panel--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${displayDate}`}
      >
        {/* Drag handle (mobile) */}
        <div className="date-panel__handle" aria-hidden="true" />

        {/* Header */}
        <div className="date-panel__header">
          <div>
            <p className="date-panel__header-eyebrow">
              {editingRequest ? 'Editing request' : 'Date details'}
            </p>
            <h2 className="date-panel__header-title">{displayDate}</h2>
          </div>
          <button
            type="button"
            className="date-panel__close-btn"
            onClick={handleClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="date-panel__body">

          {/* Team requests for this date */}
          {allDateRequests.length > 0 && (
            <div className="date-panel__section">
              <h3 className="date-panel__section-title">
                {allDateRequests.length} request{allDateRequests.length !== 1 ? 's' : ''} on this day
              </h3>
              <ul className="date-panel__request-list">
                {allDateRequests.map((r) => {
                  const isSaving = r.isOptimistic;
                  const style = getVariantStyle(r.request);
                  const isOwn =
                    selectedName &&
                    normalizeForComparison(r.name) === normalizeForComparison(selectedName);
                  const itemClass = [
                    'date-panel__request-item',
                    isOwn ? 'date-panel__request-item--own' : '',
                    isSaving ? 'opacity-65 animate-pulse border border-dashed border-indigo-200/80 bg-indigo-50/20' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <li
                      key={r.id ?? `${r.name}-${r.date}-${r.request}`}
                      className={itemClass}
                    >
                      <div className="date-panel__request-info flex-1">
                        <span
                          className="date-panel__request-badge shrink-0"
                          style={{
                            background: style.background,
                            color: style.color,
                            borderColor: style.borderColor,
                          }}
                        >
                          {r.request}
                        </span>
                        <span className="date-panel__request-name">
                          {r.name}
                          {isSaving && (
                            <span className="ml-1.5 text-[10px] font-semibold text-indigo-500">
                              (Syncing...)
                            </span>
                          )}
                        </span>
                        {r.comment && (
                          <span className="date-panel__request-comment">{r.comment}</span>
                        )}
                      </div>
                      {isOwn && (
                        <div className="date-panel__request-actions shrink-0">
                          <button
                            type="button"
                            className="date-panel__btn date-panel__btn--edit disabled:opacity-40 disabled:pointer-events-none"
                            onClick={() => onEdit?.(r)}
                            disabled={isSaving}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="date-panel__btn date-panel__btn--delete disabled:opacity-40 disabled:pointer-events-none"
                            onClick={() => onDelete?.(r)}
                            disabled={isSaving}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="date-panel__error">{error}</div>
          )}

          {/* Request form */}
          <div className="date-panel__section">
            <h3 className="date-panel__section-title">
              {editingRequest ? 'Update request' : 'Add a request'}
            </h3>
            <NewRequestForm
              selectedName={selectedName}
              onSubmit={onSubmit}
              isSubmitting={isSubmitting}
              initialValues={formInitialValues}
              requests={requests}
              shiftTypes={shiftTypes}
              limitGroups={limitGroups}
              shiftBlocks={shiftBlocks}
              settings={settings}
              names={names}
            />
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
