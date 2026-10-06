import React from 'react';

/**
 * View mode selector for Phase 5 V2 Roster:
 * - Current (Authoritative working roster)
 * - Planned (Immutable originally published snapshot)
 * - Changes (Chronological confirmed amendment history)
 */
export default function RosterViewModeSelector({
  mode = 'CURRENT',
  onChange,
  amendmentCount = 0,
  disabled = false
}) {
  return (
    <div
      className="inline-flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200 shadow-xs"
      role="tablist"
      aria-label="Roster view modes"
    >
      <button
        type="button"
        role="tab"
        id="view-mode-current"
        aria-selected={mode === 'CURRENT'}
        disabled={disabled}
        onClick={() => onChange('CURRENT')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
          mode === 'CURRENT'
            ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200/80'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span>📋</span>
        <span>Current</span>
      </button>

      <button
        type="button"
        role="tab"
        id="view-mode-planned"
        aria-selected={mode === 'PLANNED'}
        disabled={disabled}
        onClick={() => onChange('PLANNED')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
          mode === 'PLANNED'
            ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200/80'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span>🔒</span>
        <span>Planned</span>
      </button>

      <button
        type="button"
        role="tab"
        id="view-mode-changes"
        aria-selected={mode === 'CHANGES'}
        disabled={disabled}
        onClick={() => onChange('CHANGES')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
          mode === 'CHANGES'
            ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200/80'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span>📜</span>
        <span>Changes</span>
        {amendmentCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-extrabold rounded-full bg-purple-100 text-purple-700 border border-purple-200">
            {amendmentCount}
          </span>
        )}
      </button>

      <button
        type="button"
        role="tab"
        id="view-mode-entitlements"
        data-testid="view-mode-entitlements"
        aria-selected={mode === 'ENTITLEMENTS'}
        disabled={disabled}
        onClick={() => onChange('ENTITLEMENTS')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
          mode === 'ENTITLEMENTS'
            ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200/80'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
        } disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
      >
        <span>⚖️</span>
        <span>Entitlements</span>
      </button>
    </div>
  );
}
