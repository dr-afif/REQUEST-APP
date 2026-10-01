import DraftQueuePanel, { rosterPanelEnabled } from '../features/roster/components/DraftQueuePanel.jsx';
import LifecycleControls from '../features/roster/components/LifecycleControls.jsx';
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { normalizeForComparison, toIsoDate } from '../utils/normalise';
import { mapName } from '../utils/adapters';
import { openRosterPdfExport } from '../utils/rosterPdfExport';
import { getHolidayName } from '../utils/holidays';
import { APP_ICONS } from '../constants/icons';

const formatEmergencyPhysicianName = (entry) => {
  const rawName = typeof entry === 'string' ? entry : entry?.name || '';
  const name = rawName.trim();
  if (!name) return '';
  return name.toLowerCase().startsWith('dr') ? name : `Dr. ${name}`;
};

const splitEmergencyPhysicianNames = (value) => String(value || '')
  .split(/[,\n]+/)
  .map((name) => name.trim())
  .filter(Boolean);

function EpPainterToolbar({
  physicians = [],
  activeStamp,
  onSelectStamp,
  onClearStamp,
  onBatchFillWeekdays,
  onBatchFillWeekends,
}) {
  const options = useMemo(() => physicians
    .map(formatEmergencyPhysicianName)
    .filter(Boolean)
    .filter((name, index, all) => (
      all.findIndex((candidate) => normalizeForComparison(candidate) === normalizeForComparison(name)) === index
    )), [physicians]);

  return (
    <div className="mb-4 rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50/95 via-emerald-50/80 to-teal-50/95 p-3 sm:p-4 shadow-sm transition-all animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-2.5 mb-2.5 border-b border-teal-200/60">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-600 text-white text-base shadow-xs shrink-0">
            🎨
          </span>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-teal-900 flex items-center gap-2 flex-wrap">
              <span>EP 1-Click Painter</span>
              {activeStamp ? (
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                  activeStamp === '__CLEAR__'
                    ? 'bg-rose-100 text-rose-700 border border-rose-300'
                    : 'bg-teal-600 text-white shadow-xs'
                }`}>
                  {activeStamp === '__CLEAR__' ? '🧹 Eraser Active' : `Active Stamp: ${activeStamp}`}
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-teal-700/80 bg-teal-100/70 px-2.5 py-0.5 rounded-full">
                  Click a doctor to start stamping
                </span>
              )}
            </h3>
            <p className="text-[10px] sm:text-xs text-teal-700/80 mt-0.5">
              Select a doctor badge below, then click any <strong className="font-semibold text-teal-950">Office Hour</strong> or <strong className="font-semibold text-teal-950">On Call</strong> cell to stamp immediately with 1 click.
            </p>
          </div>
        </div>

        {activeStamp && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClearStamp}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-teal-800 bg-white border border-teal-300 rounded-xl hover:bg-teal-50 hover:border-teal-400 transition shadow-2xs cursor-pointer"
            >
              <span>✕ Deselect Stamp</span>
              <kbd className="text-[9px] bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded font-mono">Esc</kbd>
            </button>
          </div>
        )}
      </div>

      {/* Badges Palette */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {options.map((name) => {
          const isActive = activeStamp === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelectStamp(isActive ? null : name)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 active:scale-95 cursor-pointer ${
                isActive
                  ? 'bg-teal-600 text-white ring-2 ring-teal-400 ring-offset-1 shadow-sm scale-105'
                  : 'bg-white text-teal-900 border border-teal-200 hover:bg-teal-100/80 hover:border-teal-300'
              }`}
            >
              <span>{name}</span>
              {isActive && <span className="text-[10px] font-extrabold">✓</span>}
            </button>
          );
        })}

        {/* Eraser Button */}
        <button
          type="button"
          onClick={() => onSelectStamp(activeStamp === '__CLEAR__' ? null : '__CLEAR__')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 active:scale-95 cursor-pointer ${
            activeStamp === '__CLEAR__'
              ? 'bg-rose-600 text-white ring-2 ring-rose-400 ring-offset-1 shadow-sm scale-105'
              : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 hover:border-rose-300'
          }`}
          title="Click to activate Eraser. Clicking any EP cell will clear it."
        >
          <span>🧹 Eraser</span>
          {activeStamp === '__CLEAR__' && <span className="text-[10px] font-extrabold">✓</span>}
        </button>

        {/* Quick Batch Tools (Shown when an EP is selected) */}
        {activeStamp && activeStamp !== '__CLEAR__' && (
          <div className="flex flex-wrap items-center gap-1.5 pl-2 ml-1 border-l border-teal-300/80">
            <button
              type="button"
              onClick={() => onBatchFillWeekdays(activeStamp)}
              className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white text-teal-800 border border-teal-300 hover:bg-teal-50 hover:border-teal-400 transition shadow-2xs flex items-center gap-1 cursor-pointer"
              title={`Assign ${activeStamp} to all weekdays (Mon-Fri) Office Hour for this month`}
            >
              <span>⚡ Fill Weekdays (Office)</span>
            </button>
            <button
              type="button"
              onClick={() => onBatchFillWeekends(activeStamp)}
              className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white text-teal-800 border border-teal-300 hover:bg-teal-50 hover:border-teal-400 transition shadow-2xs flex items-center gap-1 cursor-pointer"
              title={`Assign ${activeStamp} to all weekends (Sat-Sun) On Call for this month`}
            >
              <span>⚡ Fill Weekends (On Call)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmergencyPhysicianMultiSelect({
  id,
  value,
  physicians = [],
  onChange,
  onNavigateKeyDown,
  isWeekend,
  activeEpStamp = null,
  yesterdayValue = '',
  slotLabel = '',
  dateLabel = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMultiMode, setIsMultiMode] = useState(false);
  const [draftNames, setDraftNames] = useState(() => splitEmergencyPhysicianNames(value));
  const [searchQuery, setSearchQuery] = useState('');
  const [isStampedFlash, setIsStampedFlash] = useState(false);

  const options = useMemo(() => physicians
    .map(formatEmergencyPhysicianName)
    .filter(Boolean)
    .filter((name, index, all) => (
      all.findIndex((candidate) => normalizeForComparison(candidate) === normalizeForComparison(name)) === index
    )), [physicians]);

  useEffect(() => {
    if (!isOpen) {
      setDraftNames(splitEmergencyPhysicianNames(value));
      setSearchQuery('');
    } else {
      const currentList = splitEmergencyPhysicianNames(value);
      setIsMultiMode(currentList.length > 1);
    }
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const isSelected = (name) => draftNames.some(
    (selectedName) => normalizeForComparison(selectedName) === normalizeForComparison(name)
  );

  const toggleName = (name) => {
    setDraftNames((current) => (
      current.some((selectedName) => normalizeForComparison(selectedName) === normalizeForComparison(name))
        ? current.filter((selectedName) => normalizeForComparison(selectedName) !== normalizeForComparison(name))
        : [...current, name]
    ));
  };

  const handleDirectSelect = (name) => {
    onChange(name);
    setIsOpen(false);
  };

  const handleApplyMulti = () => {
    onChange(draftNames.join(', '));
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const handleCopyYesterday = () => {
    if (yesterdayValue) {
      onChange(yesterdayValue);
      setIsOpen(false);
    }
  };

  const handleClick = () => {
    if (activeEpStamp) {
      if (activeEpStamp === '__CLEAR__') {
        onChange('');
      } else {
        onChange(activeEpStamp);
      }
      setIsStampedFlash(true);
      setTimeout(() => setIsStampedFlash(false), 350);
      return;
    }
    setIsOpen(true);
  };

  const handleButtonKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && activeEpStamp) {
      event.preventDefault();
      onChange('');
      setIsStampedFlash(true);
      setTimeout(() => setIsStampedFlash(false), 350);
      return;
    }
    onNavigateKeyDown?.(event);
  };

  const visibleOptions = options.filter((name) => (
    normalizeForComparison(name).includes(normalizeForComparison(searchQuery))
  ));
  const selectedNames = splitEmergencyPhysicianNames(value);

  return (
    <>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Select emergency physicians. ${selectedNames.length} selected.`}
        title={
          activeEpStamp
            ? activeEpStamp === '__CLEAR__'
              ? 'Click to erase EP assignment'
              : `Click to stamp ${activeEpStamp}`
            : 'Click to edit EP assignment'
        }
        onClick={handleClick}
        onKeyDown={handleButtonKeyDown}
        className={`w-full h-full min-h-[3.5rem] px-1 py-1 text-center text-[9px] sm:text-xs font-bold bg-transparent outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500 transition-all ${
          activeEpStamp
            ? activeEpStamp === '__CLEAR__'
              ? 'cursor-crosshair hover:bg-rose-100/70 hover:ring-2 hover:ring-rose-400 hover:ring-inset'
              : 'cursor-crosshair hover:bg-teal-100/80 hover:ring-2 hover:ring-teal-400 hover:ring-inset'
            : 'cursor-pointer hover:bg-teal-50/60 focus:bg-white'
        } ${
          isStampedFlash ? 'bg-teal-300/80 ring-2 ring-teal-500 scale-105' : ''
        } ${
          isWeekend ? 'text-teal-800' : 'text-teal-700'
        }`}
      >
        {selectedNames.length > 0 ? (
          <span className="flex flex-col items-center gap-0.5">
            {selectedNames.slice(0, 2).map((name) => (
              <span key={name} className="leading-tight truncate max-w-[5.5rem] sm:max-w-none">{name}</span>
            ))}
            {selectedNames.length > 2 && (
              <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[8px] text-teal-800">
                +{selectedNames.length - 2} more
              </span>
            )}
          </span>
        ) : (
          <span className="text-slate-400 italic">Select EP</span>
        )}
      </button>

      {isOpen && createPortal((
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-xs animate-fadeIn"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-5 shadow-2xl animate-scaleUp"
          >
            {/* Context Header */}
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
                    {slotLabel || 'Emergency Physician'}
                  </span>
                  {dateLabel && (
                    <span className="text-xs font-bold text-slate-500">
                      {dateLabel}
                    </span>
                  )}
                </div>
                <h2 id={`${id}-title`} className="mt-1 text-base font-bold text-slate-800">
                  Assign Physician
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close picker"
                onClick={() => setIsOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none cursor-pointer"
              >
                <APP_ICONS.close className="h-4 w-4" />
              </button>
            </div>

            {/* Quick Actions (Copy Yesterday / Clear) */}
            {(yesterdayValue || selectedNames.length > 0) && (
              <div className="mb-3 flex flex-col gap-1.5 p-2 bg-slate-50 rounded-2xl border border-slate-150">
                {yesterdayValue && yesterdayValue !== value && (
                  <button
                    type="button"
                    onClick={handleCopyYesterday}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-bold text-teal-800 bg-white border border-teal-200 rounded-xl hover:bg-teal-50 hover:border-teal-300 transition shadow-2xs cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span>📋 Copy Yesterday:</span>
                      <span className="font-extrabold text-teal-900 truncate">{yesterdayValue}</span>
                    </span>
                    <span className="shrink-0 text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded-md font-semibold">
                      1-Tap
                    </span>
                  </button>
                )}

                {selectedNames.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-bold text-rose-600 bg-white border border-rose-200 rounded-xl hover:bg-rose-50 transition cursor-pointer"
                  >
                    ✕ Clear Assignment
                  </button>
                )}
              </div>
            )}

            {/* Mode Switcher */}
            <div className="mb-2 flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold text-slate-600">
                {isMultiMode ? 'Multiple Selection Mode' : 'Direct Select (1-Tap)'}
              </span>
              <button
                type="button"
                onClick={() => setIsMultiMode(!isMultiMode)}
                className="text-[11px] font-bold text-teal-700 hover:text-teal-900 underline cursor-pointer"
              >
                {isMultiMode ? '← Switch to 1-Tap' : '+ Assign Multiple'}
              </button>
            </div>

            {/* Search Input (if > 3 physicians) */}
            {options.length > 3 && (
              <input
                id={`${id}-search`}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search physician name..."
                autoFocus
                className="mb-2.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100"
              />
            )}

            {/* Doctor Options */}
            <div className="max-h-60 space-y-1.5 overflow-y-auto pr-0.5">
              {visibleOptions.length > 0 ? (
                visibleOptions.map((name) => {
                  const isCur = selectedNames.some(
                    (s) => normalizeForComparison(s) === normalizeForComparison(name)
                  );

                  if (isMultiMode) {
                    const checked = isSelected(name);
                    return (
                      <label
                        key={name}
                        className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                          checked
                            ? 'border-teal-300 bg-teal-50 text-teal-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleName(name)}
                          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        <span>{name}</span>
                      </label>
                    );
                  }

                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleDirectSelect(name)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs font-bold rounded-xl transition text-left cursor-pointer ${
                        isCur
                          ? 'bg-teal-600 text-white shadow-xs'
                          : 'bg-white text-slate-700 hover:bg-teal-50 hover:text-teal-900 border border-slate-200 hover:border-teal-300'
                      }`}
                    >
                      <span>{name}</span>
                      {isCur ? (
                        <span className="text-[10px] font-extrabold bg-teal-700 px-1.5 py-0.5 rounded">✓ Selected</span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-normal">Tap to assign</span>
                      )}
                    </button>
                  );
                })
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                  No emergency physician matches this search.
                </p>
              )}
            </div>

            {/* Multi-mode Apply Buttons */}
            {isMultiMode && (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyMulti}
                  className="h-10 flex-1 rounded-xl bg-teal-600 px-3 text-xs font-bold text-white transition hover:bg-teal-700 shadow-sm cursor-pointer"
                >
                  Apply ({draftNames.length})
                </button>
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </>
  );
}

// Helper to parse standby status and extended shift status from a shift name string
const parseShiftValue = (rawVal) => {
  if (!rawVal) return { cleanShift: '', isStandby: false, isExtended: false };
  let str = String(rawVal).trim().toUpperCase();
  const isStandby = str.endsWith('(S)') || str.endsWith('-S') || str.includes('(S)');
  let isExtended = str.endsWith('(X)') || str.endsWith('-X') || str.includes('(X)');
  
  if (!isExtended && str.length > 1 && str.endsWith('X')) {
    isExtended = true;
    str = str.slice(0, -1);
  }

  const cleanShift = str
    .replace(/\(S\)/g, '')
    .replace(/-S/g, '')
    .replace(/\(X\)/g, '')
    .replace(/-X/g, '')
    .trim();
  return { cleanShift, isStandby, isExtended };
};

// Helper to identify working shifts (AM, PM, ON1, ON2, PN, plus NIGHT variants)
const isWorkingShift = (shiftVal) => {
  if (!shiftVal) return false;
  const clean = parseShiftValue(shiftVal).cleanShift.toUpperCase().trim();
  return ['AM', 'PM', 'ON1', 'ON2', 'PN', 'NIGHT', 'ON', 'N'].includes(clean);
};

const getCanonicalShiftKey = (rawVal) => {
  const { cleanShift, isStandby, isExtended } = parseShiftValue(rawVal);
  if (!cleanShift) return '';
  let canonical = cleanShift;
  if (isStandby) canonical += ' (S)';
  if (isExtended) canonical += ' (X)';
  return canonical;
};

const getDisplayShiftValue = (val) => {
  const { cleanShift, isStandby, isExtended } = parseShiftValue(val);
  if (!cleanShift) return '';
  let display = cleanShift;
  if (isStandby) display += 'S';
  if (isExtended) display += 'X';
  return display;
};

const normalizeShiftType = (shiftType) => {
  const up = String(shiftType || '').trim().toUpperCase();
  if (up === 'ON' || up === 'ON1' || up === 'ON2' || up === 'N' || up === 'NIGHT') {
    return 'NIGHT';
  }
  return up;
};

const getColumnStyle = (col) => {
  switch (col) {
    case 'AM':
      return {
        headerClass: 'bg-green-50/60 text-green-700 min-w-[3.2rem]',
        cellColor: 'text-green-700',
        cellBg: 'bg-green-50/30'
      };
    case 'PM':
      return {
        headerClass: 'bg-amber-50/60 text-amber-700 min-w-[3.2rem]',
        cellColor: 'text-amber-700',
        cellBg: 'bg-amber-50/30'
      };
    case 'NIGHT':
      return {
        headerClass: 'bg-red-50/60 text-red-700 min-w-[3.6rem]',
        cellColor: 'text-red-700',
        cellBg: 'bg-red-50/30'
      };
    case 'PN':
      return {
        headerClass: 'bg-purple-50/60 text-purple-700 min-w-[3.2rem]',
        cellColor: 'text-purple-700',
        cellBg: 'bg-purple-50/30'
      };
    case 'TOTAL LEAVES':
      return {
        headerClass: 'bg-indigo-50/60 text-indigo-700 min-w-[5.5rem]',
        cellColor: 'text-indigo-700',
        cellBg: 'bg-indigo-50/30'
      };
    case 'EMPTY':
      return {
        headerClass: 'bg-slate-100/60 text-slate-500 min-w-[4.5rem]',
        cellColor: 'text-slate-500',
        cellBg: 'bg-slate-50/50'
      };
    default:
      return {
        headerClass: 'bg-slate-100/60 text-slate-700 min-w-[3.8rem]',
        cellColor: 'text-slate-700',
        cellBg: ''
      };
  }
};

// Helper to identify night shift variants (NIGHT, N, ON, ON1, ON2)
const isNightShift = (shiftName) => {
  const up = String(shiftName || '').trim().toUpperCase();
  return up === 'NIGHT' || up === 'N' || up.includes('NIGHT') || up === 'ON' || up === 'ON1' || up === 'ON2';
};

// Helper to extract all night shift names from day assignments
const getNightShiftNamesFromGrid = (dayData) => {
  if (!dayData) return '';
  const namesSet = new Set();
  Object.keys(dayData).forEach((key) => {
    if (isNightShift(key)) {
      const valStr = dayData[key];
      if (valStr) {
        valStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean).forEach(n => namesSet.add(n));
      }
    }
  });
  return Array.from(namesSet).join(', ');
};

const splitRosterNames = (value) => String(value || '')
  .split(/[,\n]+/)
  .map((name) => name.trim())
  .filter(Boolean);

// Helper to clean up any duplicate name assignments on the same day when a standard shift (AM, PM, NIGHT) is modified
const cleanDayDataForNameOverlap = (dayData, modifiedShiftCol, newValue, allowDoubleShift = false) => {
  const nextDayData = { ...dayData };
  nextDayData[modifiedShiftCol] = newValue;
  
  if (allowDoubleShift) return nextDayData;

  const newNames = newValue
    ? newValue.split(/[\n,]+/).map(n => n.trim()).filter(Boolean)
    : [];
    
  if (newNames.length === 0) return nextDayData;
  
  const normalizedNewNames = newNames.map(n => normalizeForComparison(n));
  
  const removeNamesFromList = (namesStr) => {
    if (!namesStr) return '';
    return namesStr
      .split(/[\n,]+/)
      .map(n => n.trim())
      .filter(n => !normalizedNewNames.includes(normalizeForComparison(n)) && n !== '')
      .join(', ');
  };
  
  // Remove these names from all OTHER shift columns
  Object.keys(nextDayData).forEach((shiftKey) => {
    if (shiftKey !== modifiedShiftCol) {
      nextDayData[shiftKey] = removeNamesFromList(nextDayData[shiftKey]);
    }
  });
  
  return nextDayData;
};

export default function RosterPage({
  selectedName,
  names = [],
  masterRoster = [],
  onUploadMasterRoster,
  onRefresh,
  shiftTypes = [],
  requests = [],
  teamMembers = [],
  emergencyPhysicians = [],
  onSubmitRequest,
  onDeleteRequest,
  settings = {},
  onUpdateSetting,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCommentDetail, setActiveCommentDetail] = useState(null);
  const [adminCommentText, setAdminCommentText] = useState('');
  const [reassignShift, setReassignShift] = useState('');
  const [reassignStandby, setReassignStandby] = useState(false);
  const [reassignExtended, setReassignExtended] = useState(false);
  const [isReassigning, setIsReassigning] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isStandbyEditMode, setIsStandbyEditMode] = useState(false);
  const [isExtendedEditMode, setIsExtendedEditMode] = useState(false);
  const [isExcelTableEditMode, setIsExcelTableEditMode] = useState(false);
  const [allowDoubleShift, setAllowDoubleShift] = useState(false);
  const [editedGrid, setEditedGrid] = useState({});
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar' or 'table'
  const [activeEpStamp, setActiveEpStamp] = useState(null); // EP doctor name, '__CLEAR__', or null
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState({
    mainTitle: 'ED HSAAS',
    rosterType: 'MO & EP ROSTER',
    monthYear: '',
    version: 'v1.0',
    notes: '',
    preparedBy: '',
    checkedBy: '',
    approvedBy: '',
  });
  // Thresholds for shift tally alerts (persisted in localStorage)
  const [tallyThresholds, setTallyThresholds] = useState(() => {
    try {
      const saved = localStorage.getItem('rosterTallyThresholds');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    const defaultThresholds = {
      amMin: 1,
      pmMin: 1,
      nightMin: 1,
      nightMax: 2,
      totalLeaveMax: 4,
    };
    try {
      const saved = localStorage.getItem('rosterTallyThresholds');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.totalLeaveMax === 3) {
          parsed.totalLeaveMax = 4;
        }
        return { ...defaultThresholds, ...parsed };
      }
    } catch (e) {
      console.error(e);
    }
    return defaultThresholds;
  });

  useEffect(() => {
    localStorage.setItem('rosterTallyThresholds', JSON.stringify(tallyThresholds));
  }, [tallyThresholds]);

  // 1. Set the initial roster month to the current month (YYYY-MM)
  const [rosterMonth, setRosterMonth] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  });

  // Phase 4 Roster Lifecycle State
  const [lifecycleInfo, setLifecycleInfo] = useState({
    period: rosterMonth,
    isEnrolled: false,
    state: null,
    revision: null,
  });

  useEffect(() => {
    setLifecycleInfo({
      period: rosterMonth,
      isEnrolled: false,
      state: null,
      revision: null,
    });
  }, [rosterMonth]);

  const isPeriodLocked = Boolean(
    lifecycleInfo.isEnrolled &&
    lifecycleInfo.period === rosterMonth &&
    ['PUBLISHED', 'CLOSED'].includes(lifecycleInfo.state)
  );

  useEffect(() => {
    if (isPeriodLocked) {
      setIsEditMode(false);
      setIsStandbyEditMode(false);
      setIsExtendedEditMode(false);
      setIsExcelTableEditMode(false);
      setActiveEpStamp(null);
      setEditedGrid({});
    }
  }, [isPeriodLocked]);

  // Roster Memo Planner Modal States
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [memoMonth, setMemoMonth] = useState(rosterMonth);
  const [memoText, setMemoText] = useState('');

  // Sync memo text when month or settings changes
  useEffect(() => {
    if (isMemoModalOpen) {
      setMemoText(settings[`memo_${memoMonth}`] || '');
    }
  }, [memoMonth, settings, isMemoModalOpen]);

  // Sync memoMonth to the viewed rosterMonth when opened
  useEffect(() => {
    if (isMemoModalOpen) {
      setMemoMonth(rosterMonth);
    }
  }, [isMemoModalOpen, rosterMonth]);

  const todayStr = useMemo(() => toIsoDate(new Date()), []);

  // Check if the current rosterMonth is strictly in the future relative to the system today
  const isUpcomingMonth = useMemo(() => {
    const currentMonthStr = todayStr.substring(0, 7); // "YYYY-MM"
    return rosterMonth > currentMonthStr;
  }, [rosterMonth, todayStr]);

  // Group active requests for the selected month by doctor and date
  const requestsRosterMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(requests) || requests.length === 0) return map;
    
    requests.forEach((r) => {
      if (!r || typeof r !== 'object') return;
      const status = String(r.Status || r.status || '').toLowerCase();
      if (status !== 'active') return;
      
      const appStatus = r.ApprovalStatus || r.approvalStatus || '';
      const rType = r.RequestType || r.requestType || 'Leave';
      const isCustom = String(rType).toLowerCase() === 'admincomment';
      
      // Only consider Approved or Pending Admin requests, EXCEPT for custom comments
      if (!isCustom && appStatus !== 'Approved' && appStatus !== 'Pending Admin') return;
      
      const rawDate = r.Date || r.date;
      const dateStr = toIsoDate(rawDate);
      if (!dateStr) return;
      
      // Filter by the selected month
      if (!dateStr.startsWith(rosterMonth)) return;
      
      const nameRaw = mapName(r.Name || r.name || '');
      if (!nameRaw) return;
      const nameKey = normalizeForComparison(nameRaw);
      
      if (!map.has(nameKey)) {
        map.set(nameKey, new Map());
      }
      
      const requestedShift = String(r.Request || r.request || '').trim().toUpperCase();
      const reqObj = {
        id: r.id || r.ID || null,
        shift: requestedShift,
        type: rType,
        requestType: rType,
        approvalStatus: appStatus,
        comment: String(r.Comment || r.comment || '').trim(),
      };

      const existing = map.get(nameKey).get(dateStr);
      if (existing) {
        if (isCustom) {
          existing.customComment = reqObj;
        } else {
          const prevCustom = existing.customComment || (existing.type?.toLowerCase() === 'admincomment' ? { ...existing } : null);
          existing.id = reqObj.id;
          existing.shift = reqObj.shift;
          existing.type = reqObj.type;
          existing.requestType = reqObj.requestType;
          existing.approvalStatus = reqObj.approvalStatus;
          existing.comment = reqObj.comment;
          if (prevCustom) {
            existing.customComment = prevCustom;
          }
        }
      } else {
        const newEntry = { ...reqObj };
        if (isCustom) {
          newEntry.customComment = reqObj;
        }
        map.get(nameKey).set(dateStr, newEntry);
      }
    });
    return map;
  }, [requests, rosterMonth]);

  // 1.0 Get configured shift names from shiftTypes (excluding group formatting where needed)
  const dropdownShifts = useMemo(() => {
    if (shiftTypes && shiftTypes.length > 0) {
      return shiftTypes.filter(s => s && s.Name).map(s => String(s.Name).toUpperCase());
    }
    return ['AM', 'PM', 'NIGHT', 'OFF', 'AL', 'MC', 'HKA', 'GHKA', 'COURSE', 'EL'];
  }, [shiftTypes]);

  // Dynamic shift columns for Individual Member Shift Tally
  const memberTallyColumns = useMemo(() => {
    const core = ['EMPTY', 'AM', 'PM', 'NIGHT'];
    const others = [];
    dropdownShifts.forEach((s) => {
      if (!s) return;
      const norm = normalizeShiftType(s);
      if (!core.includes(norm) && !others.includes(norm)) {
        others.push(norm);
      }
    });
    return [...core, ...others, 'TOTAL LEAVES'];
  }, [dropdownShifts]);

  // Quick-tap common shift options for cell pop-up card
  const quickShiftOptions = useMemo(() => {
    const defaultList = ['AM', 'PM', 'ON1', 'ON2', 'NIGHT', 'PN', 'OFF', 'GOFF', 'AL', 'MC'];
    const available = [];
    defaultList.forEach((s) => {
      if (dropdownShifts.some((ds) => ds.toUpperCase() === s.toUpperCase()) || ['AM', 'PM', 'OFF'].includes(s)) {
        if (!available.includes(s)) available.push(s);
      }
    });
    return available;
  }, [dropdownShifts]);

  // 1.0.1 Helper to return CSS class names based on shift type value
  const getShiftBadgeClass = (val, isRequested = false) => {
    if (!val) return 'bg-slate-50 text-slate-400 border-slate-200';
    const { cleanShift } = parseShiftValue(val);
    const token = cleanShift.toLowerCase();
    
    if (token === 'total leave') return 'bg-indigo-50 text-indigo-900 border-indigo-200 font-extrabold';
    if (token === 'empty') return 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold';
    
    // am : green
    if (token === 'am') {
      return isRequested
        ? 'bg-green-600 text-white border-green-700 font-bold'
        : 'bg-green-50 text-green-800 border-green-500';
    }
    
    // pm : yellow
    if (token === 'pm') {
      return isRequested
        ? 'bg-amber-500 text-white border-amber-600 font-bold'
        : 'bg-amber-50 text-amber-800 border-amber-400';
    }
    
    // night (on/on1/on2) : red
    if (token === 'night' || token === 'n' || token === 'on' || token === 'on1' || token === 'on2' || token.includes('night')) {
      return isRequested
        ? 'bg-red-600 text-white border-red-700 font-bold'
        : 'bg-red-50 text-red-800 border-red-500';
    }
    
    // course : orange
    if (token.includes('course')) {
      return isRequested
        ? 'bg-orange-600 text-white border-orange-700 font-bold'
        : 'bg-orange-50 text-orange-800 border-orange-400';
    }
    
    // off : blue
    if (token === 'off') {
      return isRequested
        ? 'bg-blue-600 text-white border-blue-700 font-bold'
        : 'bg-blue-50 text-blue-800 border-blue-400';
    }
    
    // others : grey (AL/ hka/ ghka/ mc/ el/ goff etc)
    return isRequested
      ? 'bg-slate-600 text-white border-slate-700 font-bold'
      : 'bg-slate-50 text-slate-700 border-slate-300';
  };

  // 1.1 Group masterRoster by Name and Date for Table View (allowing all shift types)
  const doctorRosterMap = useMemo(() => {
    const map = new Map();
    masterRoster.forEach((row) => {
      const rawDate = row.Date || row.date;
      const dateStr = toIsoDate(rawDate);
      const nameRaw = mapName(row.Name || row.name || '');
      const shiftVal = row.Shift || row.shift;

      if (!dateStr || !nameRaw || !shiftVal) return;
      const nameKey = normalizeForComparison(nameRaw);
      const shiftRaw = String(shiftVal).trim().toUpperCase();

      if (!map.has(nameKey)) {
        map.set(nameKey, new Map());
      }
      const existing = map.get(nameKey).get(dateStr);
      if (existing) {
        const existingTokens = existing.split(',').map((s) => s.trim().toUpperCase());
        if (!existingTokens.includes(shiftRaw)) {
          map.get(nameKey).set(dateStr, existing + ',' + shiftRaw);
        }
      } else {
        map.get(nameKey).set(dateStr, shiftRaw);
      }
    });
    return map;
  }, [masterRoster]);


  const handlePrevMonth = () => {
    setRosterMonth((prev) => {
      let [year, month] = prev.split('-').map(Number);
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      return `${year}-${String(month).padStart(2, '0')}`;
    });
  };

  const handleNextMonth = () => {
    setRosterMonth((prev) => {
      let [year, month] = prev.split('-').map(Number);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      return `${year}-${String(month).padStart(2, '0')}`;
    });
  };

  const handleCurrentMonth = () => {
    const d = new Date();
    setRosterMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // 2. Generate month name in uppercase (e.g., "MAY 2026")
  const monthLabel = useMemo(() => {
    const [year, month] = rosterMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
  }, [rosterMonth]);

  useEffect(() => {
    setExportSettings((prev) => ({ ...prev, monthYear: prev.monthYear || monthLabel }));
  }, [monthLabel]);

  // 3. Generate all calendar days of the detected roster month
  const daysInMonthList = useMemo(() => {
    const [year, month] = rosterMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    const list = [];
    while (date.getMonth() === month - 1) {
      const dayNum = date.getDate();
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      const fullDateStr = `${yyyy}-${mm}-${dd}`;
      
      list.push({ dayNum, dayName, dateStr: fullDateStr });
      date.setDate(date.getDate() + 1);
    }
    return list;
  }, [rosterMonth]);

  // 4. Group baseline masterRoster by Date and Shift (AM, PM, NIGHT)
  const rosterGrid = useMemo(() => {
    const grid = {};
    
    masterRoster.forEach((row) => {
      const rawDate = row.Date || row.date;
      const dateStr = toIsoDate(rawDate);
      const nameRaw = mapName(row.Name || row.name || '');
      const shiftVal = row.Shift || row.shift;

      if (!dateStr || !nameRaw || !shiftVal) return;
      const name = String(nameRaw).trim();
      const shiftRaw = String(shiftVal).trim().toUpperCase();
      
      let shiftCol = '';
      if (shiftRaw === 'AM' || shiftRaw.includes('AM')) shiftCol = 'AM';
      else if (shiftRaw === 'PM' || shiftRaw.includes('PM')) shiftCol = 'PM';
      else if (isNightShift(shiftRaw)) shiftCol = 'NIGHT';
      else return;
      
      if (!grid[dateStr]) grid[dateStr] = { AM: [], PM: [], NIGHT: [] };
      if (!grid[dateStr][shiftCol].includes(name)) {
        grid[dateStr][shiftCol].push(name);
      }
    });

    // For upcoming months, if a doctor has an active request for AM, PM, or NIGHT, and is not in masterRoster, auto-populate
    if (isUpcomingMonth && requestsRosterMap) {
      const assignedOnDate = {}; // dateStr -> set of nameKeys
      masterRoster.forEach((row) => {
        const rawDate = row.Date || row.date;
        const dateStr = toIsoDate(rawDate);
        const nameRaw = mapName(row.Name || row.name || '');
        if (dateStr && nameRaw) {
          if (!assignedOnDate[dateStr]) assignedOnDate[dateStr] = new Set();
          assignedOnDate[dateStr].add(normalizeForComparison(nameRaw));
        }
      });

      requestsRosterMap.forEach((dateMap, nameKey) => {
        const docName = names.find(n => normalizeForComparison(n) === nameKey) || nameKey;
        
        dateMap.forEach((reqData, dateStr) => {
          const shiftRaw = String(reqData.shift || '');
          let shiftCol = '';
          if (shiftRaw === 'AM' || shiftRaw.includes('AM')) shiftCol = 'AM';
          else if (shiftRaw === 'PM' || shiftRaw.includes('PM')) shiftCol = 'PM';
          else if (isNightShift(shiftRaw)) shiftCol = 'NIGHT';
          
          if (shiftCol) {
            const isAssigned = assignedOnDate[dateStr]?.has(nameKey);
            if (!isAssigned) {
              if (!grid[dateStr]) grid[dateStr] = { AM: [], PM: [], NIGHT: [] };
              if (!grid[dateStr][shiftCol].includes(docName)) {
                grid[dateStr][shiftCol].push(docName);
              }
            }
          }
        });
      });
    }

    return grid;
  }, [masterRoster, isUpcomingMonth, requestsRosterMap, names]);

  const getEpAssignmentText = (dateStr, epKey) => {
    if (isEditMode) {
      return editedGrid[dateStr]?.[epKey] ?? '';
    }

    return masterRoster
      .filter((row) => {
        const date = toIsoDate(row.Date || row.date);
        const shift = String(row.Shift || row.shift || '').trim().toUpperCase();
        return date === dateStr && shift === epKey;
      })
      .map((row) => String(row.Name || row.name || '').trim())
      .filter(Boolean)
      .join(', ');
  };

  const exportRows = useMemo(() => {
    return daysInMonthList.map(({ dayNum, dayName, dateStr }) => {
      const dayAssignments = rosterGrid[dateStr] || { AM: [], PM: [], NIGHT: [] };
      return {
        date: dayNum,
        day: dayName,
        moAm: isEditMode ? (editedGrid[dateStr]?.AM ?? '') : (dayAssignments.AM || []).join(', '),
        moPm: isEditMode ? (editedGrid[dateStr]?.PM ?? '') : (dayAssignments.PM || []).join(', '),
        moNight: isEditMode ? getNightShiftNamesFromGrid(editedGrid[dateStr]) : (dayAssignments.NIGHT || []).join(', '),
        epAm: getEpAssignmentText(dateStr, 'EP_OFFICE_HOUR'),
        epOncall: getEpAssignmentText(dateStr, 'EP_ONCALL'),
        holidayName: getHolidayName(dateStr),
        isHoliday: !!getHolidayName(dateStr),
      };
    });
  }, [daysInMonthList, rosterGrid, isEditMode, editedGrid, masterRoster]);

  const exportContacts = useMemo(() => {
    const mapDirectoryList = (members) => {
      return members
        .map((member) => {
          const name = typeof member === 'string' ? member : member?.name;
          if (!name) return null;
          return {
            name,
            fullName: typeof member === 'string' ? '' : member?.fullName || '',
            phone: typeof member === 'string' ? '' : member?.phone || '',
          };
        })
        .filter(Boolean);
    };

    const moList = mapDirectoryList(teamMembers);
    const epList = emergencyPhysicians.length
      ? mapDirectoryList(emergencyPhysicians)
      : moList;

    return {
      mo: moList,
      ep: epList,
    };
  }, [teamMembers, emergencyPhysicians]);

  const isMatch = (name) => {
    if (!searchQuery) return false;
    return normalizeForComparison(name).includes(normalizeForComparison(searchQuery));
  };

  // --- SPREADSHEET ENGINE ---

  const initializeEditedGrid = () => {
    const cloned = {};
    
    // Populate from masterRoster directly to include all shift types (AM, PM, NIGHT, OFF, AL, MC, etc.)
    masterRoster.forEach((row) => {
      const rawDate = row.Date || row.date;
      const dateStr = toIsoDate(rawDate);
      const nameRaw = mapName(row.Name || row.name || '');
      const shiftVal = row.Shift || row.shift;

      if (!dateStr || !nameRaw || !shiftVal) return;
      const name = String(nameRaw).trim();
      const shiftRaw = String(shiftVal).trim().toUpperCase();

      if (!cloned[dateStr]) {
        cloned[dateStr] = {};
      }
      if (!cloned[dateStr][shiftRaw]) {
        cloned[dateStr][shiftRaw] = [];
      }
      if (!cloned[dateStr][shiftRaw].includes(name)) {
        cloned[dateStr][shiftRaw].push(name);
      }
    });

    // Convert arrays back to comma-separated strings
    Object.keys(cloned).forEach((dateStr) => {
      Object.keys(cloned[dateStr]).forEach((shift) => {
        cloned[dateStr][shift] = cloned[dateStr][shift].join(', ');
      });
    });

    // If upcoming month, pre-populate empty roster slots with active requests
    if (isUpcomingMonth) {
      names.forEach((docName) => {
        const docKey = normalizeForComparison(docName);
        const docRequests = requestsRosterMap.get(docKey);
        if (docRequests) {
          daysInMonthList.forEach(({ dateStr }) => {
            const reqData = docRequests.get(dateStr);
            if (reqData && reqData.shift) {
              // Check if this doctor is already assigned in cloned on this day
              const hasRosterShift = Object.keys(cloned[dateStr] || {}).some((shiftKey) => {
                const valStr = cloned[dateStr]?.[shiftKey] || '';
                return valStr.split(/[\n,]+/).map(n => normalizeForComparison(n.trim())).includes(docKey);
              });

              if (!hasRosterShift) {
                if (!cloned[dateStr]) cloned[dateStr] = {};
                const reqShift = reqData.shift;
                const currentListStr = cloned[dateStr][reqShift] || '';
                const currentList = currentListStr ? currentListStr.split(/[\n,]+/).map(n => n.trim()) : [];
                if (!currentList.includes(docName.trim())) {
                  currentList.push(docName.trim());
                }
                cloned[dateStr][reqShift] = currentList.join(', ');
              }
            }
          });
        }
      });
    }

    // Ensure AM, PM, NIGHT and EP columns are defined for all dates of the month in editedGrid
    daysInMonthList.forEach(({ dateStr }) => {
      if (!cloned[dateStr]) cloned[dateStr] = {};
      if (!cloned[dateStr].AM) cloned[dateStr].AM = '';
      if (!cloned[dateStr].PM) cloned[dateStr].PM = '';
      if (!cloned[dateStr].NIGHT) cloned[dateStr].NIGHT = '';
      if (cloned[dateStr].EP_OFFICE_HOUR === undefined) cloned[dateStr].EP_OFFICE_HOUR = '';
      if (cloned[dateStr].EP_ONCALL === undefined) cloned[dateStr].EP_ONCALL = '';
    });

    return cloned;
  };

  const toggleEditMode = () => {
    if (isPeriodLocked) return;
    if (isEditMode || isStandbyEditMode || isExtendedEditMode || isExcelTableEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setIsStandbyEditMode(false);
        setIsExtendedEditMode(false);
        setIsExcelTableEditMode(false);
        setAllowDoubleShift(false);
        setEditedGrid({});
      }
    } else {
      const cloned = initializeEditedGrid();
      setEditedGrid(cloned);
      setIsEditMode(true);
    }
  };

  const toggleStandbyEditMode = () => {
    if (isPeriodLocked) return;
    if (isEditMode || isStandbyEditMode || isExtendedEditMode || isExcelTableEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setIsStandbyEditMode(false);
        setIsExtendedEditMode(false);
        setIsExcelTableEditMode(false);
        setAllowDoubleShift(false);
        setEditedGrid({});
      }
    } else {
      const cloned = initializeEditedGrid();
      setEditedGrid(cloned);
      setIsStandbyEditMode(true);
      setActiveTab('table');
    }
  };

  const toggleExtendedEditMode = () => {
    if (isPeriodLocked) return;
    if (isEditMode || isStandbyEditMode || isExtendedEditMode || isExcelTableEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setIsStandbyEditMode(false);
        setIsExtendedEditMode(false);
        setIsExcelTableEditMode(false);
        setAllowDoubleShift(false);
        setEditedGrid({});
      }
    } else {
      const cloned = initializeEditedGrid();
      setEditedGrid(cloned);
      setIsExtendedEditMode(true);
      setActiveTab('table');
    }
  };

  const toggleExcelTableEditMode = () => {
    if (isPeriodLocked) return;
    if (isEditMode || isStandbyEditMode || isExtendedEditMode || isExcelTableEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setIsStandbyEditMode(false);
        setIsExtendedEditMode(false);
        setIsExcelTableEditMode(false);
        setAllowDoubleShift(false);
        setEditedGrid({});
      }
    } else {
      const cloned = initializeEditedGrid();
      setEditedGrid(cloned);
      setIsExcelTableEditMode(true);
      setActiveTab('table');
    }
  };

  // Reset EP Painter stamp when editing is cancelled, tab changes, or Escape is pressed
  useEffect(() => {
    if (!isEditMode || activeTab !== 'calendar') {
      setActiveEpStamp(null);
    }
  }, [isEditMode, activeTab]);

  useEffect(() => {
    if (!activeEpStamp) return undefined;
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        setActiveEpStamp(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeEpStamp]);

  const handleBatchFillWeekdays = (doctorName) => {
    if (isPeriodLocked || !doctorName || doctorName === '__CLEAR__') return;
    const confirmMsg = `Assign ${doctorName} to all weekdays (Mon-Fri) Office Hour for ${monthLabel}?`;
    if (!confirm(confirmMsg)) return;

    setEditedGrid((prev) => {
      const nextGrid = { ...prev };
      daysInMonthList.forEach(({ dayName, dateStr }) => {
        const isWknd = dayName === 'SAT' || dayName === 'SUN';
        if (!isWknd) {
          nextGrid[dateStr] = {
            ...(nextGrid[dateStr] || {}),
            EP_OFFICE_HOUR: doctorName,
          };
        }
      });
      return nextGrid;
    });
  };

  const handleBatchFillWeekends = (doctorName) => {
    if (isPeriodLocked || !doctorName || doctorName === '__CLEAR__') return;
    const confirmMsg = `Assign ${doctorName} to all weekends (Sat-Sun) On Call for ${monthLabel}?`;
    if (!confirm(confirmMsg)) return;

    setEditedGrid((prev) => {
      const nextGrid = { ...prev };
      daysInMonthList.forEach(({ dayName, dateStr }) => {
        const isWknd = dayName === 'SAT' || dayName === 'SUN';
        if (isWknd) {
          nextGrid[dateStr] = {
            ...(nextGrid[dateStr] || {}),
            EP_ONCALL: doctorName,
          };
        }
      });
      return nextGrid;
    });
  };

  const handleSaveAdminComment = async () => {
    if (!activeCommentDetail) return;
    const { doctorName, dateStr, val, customCommentId } = activeCommentDetail;
    const cleanComment = adminCommentText.trim();

    if (!cleanComment) {
      if (customCommentId) {
        await handleDeleteAdminComment();
      } else {
        setActiveCommentDetail(null);
      }
      return;
    }

    try {
      if (customCommentId) {
        await onSubmitRequest({
          id: customCommentId,
          name: doctorName,
          date: dateStr,
          request: parseShiftValue(val).cleanShift || 'OFF',
          comment: cleanComment,
          requestType: 'AdminComment',
        });
      } else {
        await onSubmitRequest({
          name: doctorName,
          date: dateStr,
          request: parseShiftValue(val).cleanShift || 'OFF',
          comment: cleanComment,
          requestType: 'AdminComment',
          approvalStatus: 'Approved',
        });
      }
      setActiveCommentDetail(null);
    } catch (err) {
      console.error('Failed to save admin comment:', err);
    }
  };

  const handleDeleteAdminComment = async () => {
    if (!activeCommentDetail || !activeCommentDetail.customCommentId) return;
    
    try {
      const { customCommentId, doctorName } = activeCommentDetail;
      if (onDeleteRequest) {
        await onDeleteRequest({ id: customCommentId, name: doctorName });
      }
      setActiveCommentDetail(null);
    } catch (err) {
      console.error('Failed to delete admin comment:', err);
    }
  };

  useEffect(() => {
    if (activeCommentDetail) {
      const parsed = parseShiftValue(activeCommentDetail.val);
      setReassignShift(parsed.cleanShift || '');
      setReassignStandby(parsed.isStandby);
      setReassignExtended(parsed.isExtended);
      setIsReassigning(false);
    }
  }, [activeCommentDetail?.doctorName, activeCommentDetail?.dateStr, activeCommentDetail?.val]);

  const handleDirectShiftReassignment = async (isClearing = false) => {
    if (isPeriodLocked || !activeCommentDetail || !onUploadMasterRoster) return;
    const { doctorName, dateStr } = activeCommentDetail;
    const normalizedTargetName = normalizeForComparison(doctorName);
    const targetDate = dateStr;
    
    setIsReassigning(true);

    let canonicalNewShift = '';
    if (!isClearing && reassignShift) {
      canonicalNewShift = reassignShift.trim().toUpperCase();
      if (reassignStandby) canonicalNewShift += ' (S)';
      if (reassignExtended) canonicalNewShift += ' (X)';
    }

    try {
      const currentMonthRows = [];
      masterRoster.forEach((row) => {
        const rawDate = row.Date || row.date;
        const iso = toIsoDate(rawDate);
        if (iso && iso.startsWith(rosterMonth)) {
          const rowName = normalizeForComparison(row.Name || row.name || '');
          if (rowName === normalizedTargetName && iso === targetDate) {
            return;
          }
          currentMonthRows.push({
            name: row.Name || row.name,
            date: iso,
            shift: row.Shift || row.shift,
          });
        }
      });

      if (canonicalNewShift) {
        currentMonthRows.push({
          name: doctorName,
          date: targetDate,
          shift: canonicalNewShift,
        });
      }

      await onUploadMasterRoster(currentMonthRows, rosterMonth);

      setActiveCommentDetail((prev) => {
        if (!prev) return null;
        const reqShift = prev.requestedShift || '';
        const cleanVal = parseShiftValue(canonicalNewShift).cleanShift;
        const hasOverride = !!(reqShift && cleanVal && cleanVal.toUpperCase() !== reqShift.toUpperCase());
        return {
          ...prev,
          val: canonicalNewShift,
          hasOverride,
        };
      });
    } catch (err) {
      console.error('Direct shift reassignment failed:', err);
    } finally {
      setIsReassigning(false);
    }
  };

  const handleToggleStandby = (dateStr, doctorName) => {
    setEditedGrid((prev) => {
      const dayData = prev[dateStr] || {};
      const normalizedName = normalizeForComparison(doctorName);
      
      const removeNameFromList = (namesStr) => {
        if (!namesStr) return '';
        return namesStr
          .split(/[\n,]+/)
          .map(n => n.trim())
          .filter(n => normalizeForComparison(n) !== normalizedName && n !== '')
          .join(', ');
      };

      const addNameToList = (namesStr) => {
        const list = namesStr ? namesStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean) : [];
        if (!list.some(n => normalizeForComparison(n) === normalizedName)) {
          list.push(doctorName.trim());
        }
        return list.join(', ');
      };

      // Find the current shift assigned to the doctor
      let currentShiftKey = '';
      Object.keys(dayData).forEach((shiftKey) => {
        const valStr = dayData[shiftKey] || '';
        const namesInShift = valStr.split(/[\n,]+/).map(n => normalizeForComparison(n.trim()));
        if (namesInShift.includes(normalizedName)) {
          currentShiftKey = shiftKey;
        }
      });

      if (!currentShiftKey) return prev; // No shift to attach standby to

      const { cleanShift, isStandby, isExtended } = parseShiftValue(currentShiftKey);
      
      // Determine the new shift key
      const nextStandby = !isStandby;
      let newShiftKey = cleanShift;
      if (nextStandby) newShiftKey += ' (S)';
      if (isExtended) newShiftKey += ' (X)';

      const nextDayData = { ...dayData };
      // Remove from old shift
      nextDayData[currentShiftKey] = removeNameFromList(nextDayData[currentShiftKey]);
      // Add to new shift
      nextDayData[newShiftKey] = addNameToList(nextDayData[newShiftKey] || '');

      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  const handleToggleExtended = (dateStr, doctorName) => {
    setEditedGrid((prev) => {
      const dayData = prev[dateStr] || {};
      const normalizedName = normalizeForComparison(doctorName);
      
      const removeNameFromList = (namesStr) => {
        if (!namesStr) return '';
        return namesStr
          .split(/[\n,]+/)
          .map(n => n.trim())
          .filter(n => normalizeForComparison(n) !== normalizedName && n !== '')
          .join(', ');
      };

      const addNameToList = (namesStr) => {
        const list = namesStr ? namesStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean) : [];
        if (!list.some(n => normalizeForComparison(n) === normalizedName)) {
          list.push(doctorName.trim());
        }
        return list.join(', ');
      };

      // Find the current shift assigned to the doctor
      let currentShiftKey = '';
      Object.keys(dayData).forEach((shiftKey) => {
        const valStr = dayData[shiftKey] || '';
        const namesInShift = valStr.split(/[\n,]+/).map(n => normalizeForComparison(n.trim()));
        if (namesInShift.includes(normalizedName)) {
          currentShiftKey = shiftKey;
        }
      });

      if (!currentShiftKey) return prev; // No shift to attach extended status to

      const { cleanShift, isStandby, isExtended } = parseShiftValue(currentShiftKey);
      
      // Determine the new shift key
      const nextExtended = !isExtended;
      let newShiftKey = cleanShift;
      if (isStandby) newShiftKey += ' (S)';
      if (nextExtended) newShiftKey += ' (X)';

      const nextDayData = { ...dayData };
      // Remove from old shift
      nextDayData[currentShiftKey] = removeNameFromList(nextDayData[currentShiftKey]);
      // Add to new shift
      nextDayData[newShiftKey] = addNameToList(nextDayData[newShiftKey] || '');

      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  const handleCellChange = (dateStr, shiftCol, value) => {
    setEditedGrid(prev => {
      const dayData = prev[dateStr] || { AM: '', PM: '', NIGHT: '' };
      
      let cleanedDayData = { ...dayData };
      if (shiftCol === 'NIGHT') {
        Object.keys(cleanedDayData).forEach((key) => {
          if (isNightShift(key) && key !== 'NIGHT') {
            cleanedDayData[key] = '';
          }
        });
      }
      
      const nextDayData = cleanDayDataForNameOverlap(cleanedDayData, shiftCol, value, allowDoubleShift);
      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  // 1.2 Get editing shift for doctor-date cell in Table View
  const getEditingShift = (dateStr, doctorName) => {
    const dayData = editedGrid[dateStr];
    if (!dayData) return '';
    
    const normalizedName = normalizeForComparison(doctorName);
    
    const checkNameInList = (namesStr) => {
      if (!namesStr) return false;
      return namesStr.split(/[\n,]+/).some(n => normalizeForComparison(n) === normalizedName);
    };

    // Find all keys in dayData containing the doctorName
    const assignedShifts = Object.keys(dayData).filter((shiftKey) => checkNameInList(dayData[shiftKey]));
    return assignedShifts.join(',') || '';
  };

  // 1.3 Handle Table View dropdown select shifts change
  const handleTableEditCellChange = (dateStr, doctorName, newShift) => {
    setEditedGrid((prev) => {
      const dayData = prev[dateStr] || { AM: '', PM: '', NIGHT: '' };
      const normalizedName = normalizeForComparison(doctorName);
      
      const removeNameFromList = (namesStr) => {
        if (!namesStr) return '';
        return namesStr
          .split(/[\n,]+/)
          .map(n => n.trim())
          .filter(n => normalizeForComparison(n) !== normalizedName && n !== '')
          .join(', ');
      };

      const addNameToList = (namesStr) => {
        const list = namesStr ? namesStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean) : [];
        if (!list.some(n => normalizeForComparison(n) === normalizedName)) {
          list.push(doctorName.trim());
        }
        return list.join(', ');
      };

      // 1. Remove doctorName from ALL keys (shifts) in dayData
      const nextDayData = {};
      Object.keys(dayData).forEach((shiftKey) => {
        nextDayData[shiftKey] = allowDoubleShift ? dayData[shiftKey] : removeNameFromList(dayData[shiftKey]);
      });

      // 2. Add to new shift if newShift is not empty
      const canonicalVal = getCanonicalShiftKey(newShift);
      if (canonicalVal) {
        nextDayData[canonicalVal] = addNameToList(nextDayData[canonicalVal] || '');
      }

      return {
        ...prev,
        [dateStr]: nextDayData
      };
    });
  };

  const rosterScrollRef = useRef(null);
  const tallyScrollRef = useRef(null);

  useEffect(() => {
    const rosterDiv = rosterScrollRef.current;
    const tallyDiv = tallyScrollRef.current;
    if (!rosterDiv || !tallyDiv) return;

    let isSyncingRoster = false;
    let isSyncingTally = false;

    const handleRosterScroll = () => {
      if (isSyncingTally) {
        isSyncingTally = false;
        return;
      }
      isSyncingRoster = true;
      tallyDiv.scrollLeft = rosterDiv.scrollLeft;
    };

    const handleTallyScroll = () => {
      if (isSyncingRoster) {
        isSyncingRoster = false;
        return;
      }
      isSyncingTally = true;
      rosterDiv.scrollLeft = tallyDiv.scrollLeft;
    };

    rosterDiv.addEventListener('scroll', handleRosterScroll, { passive: true });
    tallyDiv.addEventListener('scroll', handleTallyScroll, { passive: true });

    return () => {
      rosterDiv.removeEventListener('scroll', handleRosterScroll);
      tallyDiv.removeEventListener('scroll', handleTallyScroll);
    };
  }, [activeTab]);

  // 📏 Synchronize column widths between Roster spreadsheet and Shift Distribution Tally
  useEffect(() => {
    if (activeTab !== 'table') return;

    const rosterDiv = rosterScrollRef.current;
    if (!rosterDiv) return;

    const rosterTable = rosterDiv.querySelector('table');
    if (!rosterTable) return;

    let lastWidths = [];
    const syncWidths = () => {
      const tallyDiv = tallyScrollRef.current;
      if (!tallyDiv) return;

      const rosterHeaders = rosterTable.querySelectorAll('thead th');
      const tallyHeaders = tallyDiv.querySelectorAll('thead th');

      const minLength = Math.min(rosterHeaders.length, tallyHeaders.length);
      
      let changed = false;
      const newWidths = [];
      for (let i = 0; i < minLength; i++) {
        const rosterWidth = rosterHeaders[i].getBoundingClientRect().width;
        newWidths.push(rosterWidth);
        if (lastWidths.length === 0 || Math.abs(lastWidths[i] - rosterWidth) > 1) {
          changed = true;
        }
      }
      
      if (!changed) return;
      lastWidths = newWidths;

      for (let i = 0; i < minLength; i++) {
        tallyHeaders[i].style.width = `${newWidths[i]}px`;
        tallyHeaders[i].style.minWidth = `${newWidths[i]}px`;
        tallyHeaders[i].style.maxWidth = `${newWidths[i]}px`;
      }
    };

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        syncWidths();
      });
    });

    observer.observe(rosterTable);

    // Initial sync and a small delay sync to catch any rendering lag or font load shifts
    syncWidths();
    const timer = setTimeout(syncWidths, 100);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [activeTab, masterRoster, editedGrid, isEditMode, isStandbyEditMode, isExtendedEditMode, isExcelTableEditMode, names, teamMembers]);

  const tallyData = useMemo(() => {
    const dateMap = new Map();
    const inactiveNames = new Set(
      teamMembers
        .filter(m => typeof m === 'object' && m.active === false)
        .map(m => normalizeForComparison(m.name))
    );
    
    // Get all standard/configured shift types, normalized (avoiding duplicates like ON/ON1/ON2/N which are grouped under NIGHT)
    const baseShifts = new Set(['AM', 'PM', 'NIGHT']);
    dropdownShifts.forEach(s => {
      const up = s.trim().toUpperCase();
      if (up === 'ON' || up === 'ON1' || up === 'ON2' || up === 'N') {
        return;
      }
      baseShifts.add(up);
    });

    const activeShiftTypes = new Set(baseShifts);
    
    daysInMonthList.forEach((day) => {
      const dayTally = new Map();
      
      // Initialize all base shift types to 0
      baseShifts.forEach(shiftType => {
        dayTally.set(shiftType, 0);
      });
      
      dateMap.set(day.dateStr, dayTally);

      let blankCount = 0;
      names.forEach((name) => {
        let val = '';
        const nameMapped = mapName(name);
        const nameKey = normalizeForComparison(nameMapped);
        const isInactive = inactiveNames.has(nameKey);

        if (isEditMode || isExcelTableEditMode) {
          val = getEditingShift(day.dateStr, nameMapped);
        } else {
          val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
          if (!val && isUpcomingMonth) {
            const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
            if (reqData) {
              val = reqData.shift;
            }
          }
        }

        if (val) {
          const shiftVals = val.split(',').map(s => s.trim()).filter(Boolean);
          shiftVals.forEach(singleVal => {
            const { cleanShift } = parseShiftValue(singleVal);
            let shiftType = cleanShift.toUpperCase();
            if (shiftType === 'ON' || shiftType === 'ON1' || shiftType === 'ON2' || shiftType === 'N') {
              shiftType = 'NIGHT';
            }

            // If inactive, only count active shifts (AM, PM, NIGHT, PN, OH), ignore leave shifts (AL, OFF, etc.)
            const isActiveShift = ['AM', 'PM', 'NIGHT', 'PN', 'OH'].includes(shiftType);
            if (isInactive && !isActiveShift) {
              return;
            }

            dayTally.set(shiftType, (dayTally.get(shiftType) || 0) + 1);
            activeShiftTypes.add(shiftType);
          });
        } else {
          if (!isInactive) {
            blankCount++;
          }
        }
      });

      // Calculate "TOTAL LEAVE" for this day: sum of all non-AM/PM/NIGHT/PN/OH shift types
      let totalLeaveCount = 0;
      dayTally.forEach((count, sType) => {
        if (sType !== 'AM' && sType !== 'PM' && sType !== 'NIGHT' && sType !== 'PN' && sType !== 'OH') {
          totalLeaveCount += count;
        }
      });
      dayTally.set('TOTAL LEAVE', totalLeaveCount);
      dayTally.set('EMPTY', blankCount);
    });

    const getShiftIndex = (shiftType) => {
      let lookupType = shiftType;
      if (lookupType === 'NIGHT') {
        const nightIndex = dropdownShifts.findIndex(s => {
          const up = s.trim().toUpperCase();
          return up === 'NIGHT' || up === 'N' || up === 'ON' || up === 'ON1' || up === 'ON2';
        });
        if (nightIndex !== -1) return nightIndex;
      }
      return dropdownShifts.findIndex(s => s.trim().toUpperCase() === lookupType);
    };

    const sortedShifts = Array.from(activeShiftTypes).sort((a, b) => {
      const idxA = getShiftIndex(a);
      const idxB = getShiftIndex(b);
      const valA = idxA !== -1 ? idxA : 999;
      const valB = idxB !== -1 ? idxB : 999;
      if (valA !== valB) return valA - valB;
      return a.localeCompare(b);
    });

    sortedShifts.push('TOTAL LEAVE');
    sortedShifts.push('EMPTY');

    return {
      tallyMap: dateMap,
      shifts: sortedShifts,
    };
  }, [daysInMonthList, names, isEditMode, isExcelTableEditMode, editedGrid, doctorRosterMap, requestsRosterMap, isUpcomingMonth, dropdownShifts, teamMembers]);

  // Per-member shift tally for the current month
  // Tracks: AM, PM, NIGHT, and other configured shifts dynamically (with ON/ON1/ON2/N consolidated to NIGHT), plus TOTAL LEAVES
  const memberTallyData = useMemo(() => {
    const LEAVE_EXCLUDES = new Set(['AM', 'PM', 'NIGHT', 'PN', 'OH']);

    const memberMap = new Map();

    names.forEach((name) => {
      const nameMapped = mapName(name);
      const nameKey = normalizeForComparison(nameMapped);
      
      const counts = {};
      memberTallyColumns.forEach((col) => {
        if (col !== 'TOTAL LEAVES') {
          counts[col] = 0;
        }
      });
      counts.TOTAL_LEAVE = 0;

      memberMap.set(nameKey, { name: nameMapped, counts });
    });

    daysInMonthList.forEach((day) => {
      names.forEach((name) => {
        const nameMapped = mapName(name);
        const nameKey = normalizeForComparison(nameMapped);
        let val = '';
        if (isEditMode || isExcelTableEditMode) {
          val = getEditingShift(day.dateStr, nameMapped);
        } else {
          val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
          if (!val && isUpcomingMonth) {
            const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
            if (reqData) val = reqData.shift;
          }
        }

        if (!val) {
          const entry = memberMap.get(nameKey);
          if (entry && entry.counts['EMPTY'] !== undefined) {
            entry.counts['EMPTY'] += 1;
          }
          return;
        }
        const shiftVals = val.split(',').map(s => s.trim()).filter(Boolean);
        shiftVals.forEach(singleVal => {
          const { cleanShift } = parseShiftValue(singleVal);
          const shiftType = normalizeShiftType(cleanShift);

          const entry = memberMap.get(nameKey);
          if (!entry) return;

          if (entry.counts[shiftType] !== undefined) {
            entry.counts[shiftType] += 1;
          }
          
          // Total Leaves: everything except AM/PM/NIGHT/PN/OH
          if (!LEAVE_EXCLUDES.has(shiftType)) {
            entry.counts.TOTAL_LEAVE += 1;
          }
        });
      });
    });

    return Array.from(memberMap.values());
  }, [daysInMonthList, names, isEditMode, isExcelTableEditMode, editedGrid, doctorRosterMap, requestsRosterMap, isUpcomingMonth, memberTallyColumns]);

  const handleKeyDown = (e, dateStr, shiftCol, dayIndex, shiftIndex) => {
    const key = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) {
      if (key === 'Enter' && (e.altKey || e.shiftKey)) {
        return; // Allow native textarea newline for Alt+Enter
      }
      
      let nextDayIndex = dayIndex;
      let nextShiftIndex = shiftIndex;

      if (key === 'ArrowUp') nextDayIndex -= 1;
      if (key === 'ArrowDown' || key === 'Enter') nextDayIndex += 1;
      if (key === 'ArrowLeft' && shiftIndex > 0) nextShiftIndex -= 1;
      if (key === 'ArrowRight' && shiftIndex < 4) nextShiftIndex += 1;

      if (nextDayIndex >= 0 && nextDayIndex < daysInMonthList.length) {
        e.preventDefault();
        const nextId = `cell-${nextDayIndex}-${nextShiftIndex}`;
        document.getElementById(nextId)?.focus();
      }
    }
  };

  const handlePaste = (e, startDayIndex, startShiftIndex) => {
    e.preventDefault();
    const pasteText = e.clipboardData.getData('text');
    if (!pasteText) return;

    // Excel wraps cells with Alt+Enter newlines in double quotes
    let inQuotes = false;
    let normalizedText = '';
    for (let i = 0; i < pasteText.length; i++) {
      const char = pasteText[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        normalizedText += char;
      } else if (inQuotes && char === '\r') {
        // Skip \r inside quotes
      } else if (inQuotes && char === '\n') {
        normalizedText += '___NEWLINE___';
      } else {
        normalizedText += char;
      }
    }

    const rows = normalizedText.split(/\r?\n/).filter(r => r.trim() !== '');
    setEditedGrid(prev => {
      const nextGrid = { ...prev };
      
      rows.forEach((row, rIdx) => {
        const targetDayIndex = startDayIndex + rIdx;
        if (targetDayIndex >= daysInMonthList.length) return;
        
        const dateStr = daysInMonthList[targetDayIndex].dateStr;
        const cells = row.split('\t');
        
        cells.forEach((cellVal, cIdx) => {
          const targetShiftIndex = startShiftIndex + cIdx;
          if (targetShiftIndex > 4) return;
          
          let cleanVal = cellVal.replace(/___NEWLINE___/g, '\n');
          // Remove surrounding quotes if Excel added them
          if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
            cleanVal = cleanVal.slice(1, -1);
          }
          // Excel escapes internal quotes as ""
          cleanVal = cleanVal.replace(/""/g, '"');

          let shiftCol;
          if (targetShiftIndex === 0) shiftCol = 'AM';
          else if (targetShiftIndex === 1) shiftCol = 'PM';
          else if (targetShiftIndex === 2) shiftCol = 'NIGHT';
          else if (targetShiftIndex === 3) shiftCol = 'EP_OFFICE_HOUR';
          else shiftCol = 'EP_ONCALL';

          if (shiftCol === 'EP_OFFICE_HOUR' || shiftCol === 'EP_ONCALL') {
            // EP columns: simple overwrite, no name-overlap cleaning
            if (!nextGrid[dateStr]) nextGrid[dateStr] = { AM: '', PM: '', NIGHT: '', EP_OFFICE_HOUR: '', EP_ONCALL: '' };
            nextGrid[dateStr][shiftCol] = cleanVal.trim();
          } else {
            nextGrid[dateStr] = cleanDayDataForNameOverlap(
              nextGrid[dateStr] || { AM: '', PM: '', NIGHT: '', EP_OFFICE_HOUR: '', EP_ONCALL: '' },
              shiftCol,
              cleanVal.trim(),
              allowDoubleShift
            );
          }
        });
      });
      
      return nextGrid;
    });
  };

  const handleTablePaste = (e, startDayIndex, startNameIndex) => {
    e.preventDefault();
    const pasteText = e.clipboardData.getData('text');
    if (!pasteText) return;

    let inQuotes = false;
    let normalizedText = '';
    for (let i = 0; i < pasteText.length; i++) {
      const char = pasteText[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        normalizedText += char;
      } else if (inQuotes && char === '\r') {
        // Skip
      } else if (inQuotes && char === '\n') {
        normalizedText += '___NEWLINE___';
      } else {
        normalizedText += char;
      }
    }

    const rows = normalizedText.split(/\r?\n/).filter(r => r.trim() !== '');

    setEditedGrid(prev => {
      const nextGrid = { ...prev };

      rows.forEach((rowStr, rIdx) => {
        const targetNameIndex = startNameIndex + rIdx;
        if (targetNameIndex >= names.length) return;

        const docName = names[targetNameIndex];
        const normalizedName = normalizeForComparison(mapName(docName));
        const cells = rowStr.split('\t');

        cells.forEach((cellVal, cIdx) => {
          const targetDayIndex = startDayIndex + cIdx;
          if (targetDayIndex >= daysInMonthList.length) return;

          const dateStr = daysInMonthList[targetDayIndex].dateStr;

          let cleanVal = cellVal.replace(/___NEWLINE___/g, '\n');
          if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
            cleanVal = cleanVal.slice(1, -1);
          }
          cleanVal = cleanVal.replace(/""/g, '"');
          cleanVal = cleanVal.trim().toUpperCase();

          const dayData = nextGrid[dateStr] || { AM: '', PM: '', NIGHT: '', EP_OFFICE_HOUR: '', EP_ONCALL: '' };
          const nextDayData = { ...dayData };

          const removeNameFromList = (namesStr) => {
            if (!namesStr) return '';
            return namesStr
              .split(/[\n,]+/)
              .map(n => n.trim())
              .filter(n => normalizeForComparison(n) !== normalizedName && n !== '')
              .join(', ');
          };

          const addNameToList = (namesStr) => {
            const list = namesStr ? namesStr.split(/[\n,]+/).map(n => n.trim()).filter(Boolean) : [];
            if (!list.some(n => normalizeForComparison(n) === normalizedName)) {
              list.push(docName.trim());
            }
            return list.join(', ');
          };

          // Remove this doctor from all shift keys on this day
          Object.keys(dayData).forEach((shiftKey) => {
            nextDayData[shiftKey] = allowDoubleShift ? dayData[shiftKey] : removeNameFromList(dayData[shiftKey]);
          });

          // Add to new shift if it's a non-empty value
          const canonicalVal = getCanonicalShiftKey(cleanVal);
          if (canonicalVal) {
            nextDayData[canonicalVal] = addNameToList(nextDayData[canonicalVal] || '');
          }

          nextGrid[dateStr] = nextDayData;
        });
      });

      return nextGrid;
    });
  };

  const handleTableKeyDown = (e, dayIndex, nameIndex) => {
    const key = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].includes(key)) {
      let nextDayIndex = dayIndex;
      let nextNameIndex = nameIndex;

      if (key === 'ArrowUp') nextNameIndex -= 1;
      if (key === 'ArrowDown' || key === 'Enter') nextNameIndex += 1;
      if (key === 'ArrowLeft') nextDayIndex -= 1;
      if (key === 'ArrowRight') nextDayIndex += 1;

      if (key === 'Tab') {
        if (e.shiftKey) {
          nextDayIndex -= 1;
        } else {
          nextDayIndex += 1;
        }
      }

      // Check boundary
      if (
        nextDayIndex >= 0 &&
        nextDayIndex < daysInMonthList.length &&
        nextNameIndex >= 0 &&
        nextNameIndex < names.length
      ) {
        e.preventDefault();
        const nextId = `table-cell-${nextDayIndex}-${nextNameIndex}`;
        document.getElementById(nextId)?.focus();
      }
    }
  };

  const handleSave = async () => {
    if (isPeriodLocked) return;
    const flatRows = [];
    Object.keys(editedGrid).forEach((dateStr) => {
      Object.keys(editedGrid[dateStr]).forEach((shift) => {
        const namesStr = editedGrid[dateStr][shift];
        if (namesStr) {
          namesStr.split(/[\n,]+/).forEach(n => {
            const name = n.trim();
            if (name) {
              flatRows.push({ name, date: dateStr, shift });
            }
          });
        }
      });
    });
    
    if (!flatRows.length && !confirm("You are about to save an EMPTY roster. This will delete all shifts for the month. Continue?")) {
       return;
    }
    
    onUploadMasterRoster(flatRows, rosterMonth);
    setIsEditMode(false);
    setIsStandbyEditMode(false);
    setIsExtendedEditMode(false);
    setIsExcelTableEditMode(false);
    setActiveEpStamp(null);
    setEditedGrid({});
  };

  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';

  const openExportModal = () => {
    setExportSettings((prev) => ({
      ...prev,
      monthYear: monthLabel,
      preparedBy: prev.preparedBy || localStorage.getItem('roster_pdf_prepared_by') || '',
      checkedBy: prev.checkedBy || localStorage.getItem('roster_pdf_checked_by') || '',
      approvedBy: prev.approvedBy || localStorage.getItem('roster_pdf_approved_by') || '',
    }));
    setIsExportModalOpen(true);
  };

  const handleExportSettingChange = (key, value) => {
    setExportSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleExportSubmit = (e) => {
    e.preventDefault();
    const basePath = import.meta.env.BASE_URL || '/';
    const logoPath = `${basePath.replace(/\/$/, '')}/logo-ed-hsaas.png`;
    const logoUrl = new URL(logoPath, window.location.origin).href;

    try {
      if (exportSettings.rosterType === 'MO ROSTER') {
        const spreadsheetDoctors = names.map((name) => {
          const nameMapped = mapName(name);
          const nameKey = normalizeForComparison(nameMapped);

          // Find full name from teamMembers list
          const memberObj = teamMembers.find(m => normalizeForComparison(m.name) === nameKey || normalizeForComparison(m.fullName) === nameKey);
          const displayName = memberObj?.fullName?.trim() || nameMapped;

          const shifts = {};
          daysInMonthList.forEach((day) => {
            let val = '';
            if (isEditMode || isStandbyEditMode || isExtendedEditMode || isExcelTableEditMode) {
              val = getEditingShift(day.dateStr, nameMapped);
            } else {
              val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
              if (!val && isUpcomingMonth) {
                const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
                if (reqData) {
                  val = reqData.shift;
                }
              }
            }
            const { cleanShift, isStandby, isExtended } = parseShiftValue(val);
            shifts[day.dateStr] = {
              value: cleanShift,
              isStandby,
              isExtended,
            };
          });
          return {
            name: displayName,
            shifts,
          };
        });

        // Save signees to localStorage
        localStorage.setItem('roster_pdf_prepared_by', exportSettings.preparedBy || '');
        localStorage.setItem('roster_pdf_checked_by', exportSettings.checkedBy || '');
        localStorage.setItem('roster_pdf_approved_by', exportSettings.approvedBy || '');

        openRosterPdfExport({
          ...exportSettings,
          logoUrl,
          spreadsheetDays: daysInMonthList.map(day => ({
            ...day,
            holidayName: getHolidayName(day.dateStr),
          })),
          spreadsheetDoctors,
        });
      } else {
        openRosterPdfExport({
          ...exportSettings,
          logoUrl,
          rows: exportRows,
          contacts: exportContacts,
        });
      }
      setIsExportModalOpen(false);
    } catch (error) {
      alert(error.message || 'Unable to open PDF export.');
    }
  };

  return (
    <div className={`mx-auto px-2 sm:px-6 py-6 sm:py-8 md:px-8 animate-fadeIn ${
      activeTab === 'table' ? 'w-full max-w-none' : 'max-w-5xl'
    }`}>
      {selectedName?.trim().toLowerCase() === 'admin' && rosterPanelEnabled(settings) && <DraftQueuePanel key={rosterMonth} period={rosterMonth} settings={settings} />}
      {/* 🧭 Header Details */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold flex items-center gap-2">
              <span>📅</span>
              <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">Full Roster</span>
            </h1>
          </div>
          <p className="text-sm text-slate-500 mt-2">
            Displaying the official finalized schedule for <span className="font-bold text-slate-700">{monthLabel}</span>.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={handlePrevMonth}
              disabled={isEditMode || isExcelTableEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ‹ Prev
            </button>
            <button
              onClick={handleCurrentMonth}
              disabled={isEditMode || isExcelTableEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Current Month
            </button>
            <button
              onClick={handleNextMonth}
              disabled={isEditMode || isExcelTableEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next ›
            </button>
          </div>
        </div>

        {/* Phase 4 Roster Lifecycle Status & Controls */}
        <div className="flex flex-col sm:items-end gap-2 shrink-0">
          <LifecycleControls
            period={rosterMonth}
            settings={settings}
            isAdmin={isAdmin}
            onLifecycleStateChange={setLifecycleInfo}
          />
        </div>
      </div>

      {/* 🧭 Tab Control */}
      <div className="flex justify-between items-center border-b border-slate-200 mb-6 select-none">
        <div className="flex">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`py-2.5 px-4 text-xs sm:text-sm font-bold border-b-2 transition-all -mb-px ${
              activeTab === 'calendar'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            📅 Calendar View
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`py-2.5 px-4 text-xs sm:text-sm font-bold border-b-2 transition-all -mb-px ${
              activeTab === 'table'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            📊 Table View
          </button>
        </div>

        {/* Action Buttons on the Right */}
        {isAdmin && (
          <div className="flex items-center gap-2 pb-1.5 pr-2">
            {!isEditMode && !isStandbyEditMode && !isExtendedEditMode && !isExcelTableEditMode && (
              <>
                <button
                  type="button"
                  onClick={openExportModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                >
                  PDF Export
                </button>
                {activeTab === 'table' && (
                  <button
                    type="button"
                    onClick={() => setIsMemoModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100/80"
                  >
                    📝 Roster Memo
                  </button>
                )}
              </>
            )}
            {isPeriodLocked ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 shadow-sm" role="status">
                <span>🔒</span>
                <span>
                  {lifecycleInfo.state === 'PUBLISHED'
                    ? 'Planned Snapshot Locked'
                    : 'Period Closed (Read-Only)'}
                </span>
              </div>
            ) : (
              <>
                {!isStandbyEditMode && !isExtendedEditMode && (
              <>
                {!isExcelTableEditMode && (
                  <button
                    onClick={toggleEditMode}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                      isEditMode 
                        ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                        : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                    }`}
                  >
                    {isEditMode 
                      ? '✕ Cancel Edit' 
                      : activeTab === 'table' 
                        ? '✏️ Edit (Dropdown)' 
                        : '✏️ Edit Roster'}
                  </button>
                )}
                {activeTab === 'table' && !isEditMode && (
                  <button
                    onClick={toggleExcelTableEditMode}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                      isExcelTableEditMode 
                        ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                        : 'bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100'
                    }`}
                  >
                    {isExcelTableEditMode ? '✕ Cancel Copy/Paste' : '📋 Edit (Copy/Paste)'}
                  </button>
                )}
              </>
            )}
            {!isEditMode && !isExtendedEditMode && !isExcelTableEditMode && (
              <button
                onClick={toggleStandbyEditMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                  isStandbyEditMode 
                    ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                    : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                }`}
              >
                {isStandbyEditMode ? '✕ Cancel Standby' : '⭐ Edit Standby'}
              </button>
            )}
            {!isEditMode && !isStandbyEditMode && !isExcelTableEditMode && (
              <button
                onClick={toggleExtendedEditMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                  isExtendedEditMode 
                    ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                    : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                }`}
              >
                {isExtendedEditMode ? '✕ Cancel Extended' : '✨ Edit Extended'}
              </button>
            )}
            {(isEditMode || isStandbyEditMode || isExtendedEditMode || isExcelTableEditMode) && (
              <>
                {(isEditMode || isExcelTableEditMode) && (
                  <button
                    onClick={() => setAllowDoubleShift(!allowDoubleShift)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                      allowDoubleShift 
                        ? 'bg-rose-50 text-rose-700 border border-rose-300 ring-2 ring-rose-200' 
                        : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                    }`}
                    title="Allow a person to be assigned to multiple shifts on the same day"
                  >
                    {allowDoubleShift ? '🔓 Double Shift Allowed' : '🔒 Prevent Double Booking'}
                  </button>
                )}
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-70"
                >
                  💾 Save Changes
                </button>
              </>
            )}
              </>
            )}
          </div>
        )}
      </div>

      {isEditMode && (
         <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 shadow-sm animate-fadeIn">
           {activeTab === 'calendar' ? (
             <span>
               <strong className="font-bold">Excel Editing Mode Active (Calendar):</strong> You can type directly into cells. Multiple names must be separated by commas or <strong>Alt+Enter</strong>. You can use <strong>Arrow Keys</strong>, <strong>Enter</strong>, or <strong>Tab</strong> to navigate. You can also paste directly from an Excel spreadsheet range.
             </span>
           ) : (
             <span>
               <strong className="font-bold">Dropdown Editing Mode Active (Table):</strong> You can select the shift type for each team member from the dropdown menu on each day.
             </span>
           )}
         </div>
      )}

      {isExcelTableEditMode && (
         <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4 text-xs text-teal-800 shadow-sm animate-fadeIn">
           <span>
             <strong className="font-bold">Excel Copy/Paste Mode Active (Table):</strong> You can type shift codes directly into cells (e.g., AM, PM, NIGHT, OFF, AL). You can also copy a range from an Excel or Google Sheets spreadsheet and paste it directly starting at any cell to populate the grid. Use <strong>Arrow Keys</strong>, <strong>Enter</strong>, or <strong>Tab</strong> to navigate cells.
           </span>
         </div>
      )}

      {isStandbyEditMode && (
         <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 shadow-sm animate-fadeIn">
           <span>
             <strong className="font-bold">Standby Editing Mode Active:</strong> Click on any assigned shift or leave cell in the table below to toggle standby status (indicated by the amber <strong className="font-extrabold">S</strong> badge). <strong className="text-amber-950 font-bold underline decoration-amber-400">Non-working shifts (OFF, GOFF, Leaves)</strong> are highlighted in soft amber for quick assignment. Working shifts (AM, PM, ON1, ON2, PN) are muted. Your changes will be saved to Google Sheets.
           </span>
         </div>
      )}

      {isExtendedEditMode && (
         <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800 shadow-sm animate-fadeIn">
           <span>
             <strong className="font-bold">Extended Shift Editing Mode Active:</strong> You can click on any assigned shift or leave cell in the table below to toggle extended shift status (indicated by the blue <strong className="font-extrabold">EX</strong> badge). Your changes will be saved to Google Sheets.
           </span>
         </div>
      )}

      {daysInMonthList.length > 0 && activeTab === 'calendar' && (
        <>
          {isEditMode && (
            <EpPainterToolbar
              physicians={emergencyPhysicians.length ? emergencyPhysicians : (directoryMap?.ep || [])}
              activeStamp={activeEpStamp}
              onSelectStamp={(stamp) => setActiveEpStamp(stamp)}
              onClearStamp={() => setActiveEpStamp(null)}
              onBatchFillWeekdays={handleBatchFillWeekdays}
              onBatchFillWeekends={handleBatchFillWeekends}
            />
          )}

          {/* 📊 Finalized Monthly Table Card (Calendar View) */}
          <div className={`rounded-3xl border bg-white p-1 shadow-sm overflow-hidden transition-all duration-300 ${isEditMode ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-150/70'}`}>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-slate-300 text-center font-sans text-sm">
              <thead>
                {/* Row 1 Header */}
                <tr className="bg-slate-800 text-white border border-slate-800 select-none">
                  <th
                    rowSpan={2}
                    className="border border-slate-300 px-1 sm:px-4 py-2 sm:py-3 font-bold align-middle uppercase tracking-wider text-[9px] sm:text-xs w-8 sm:w-16"
                  >
                    DATE
                  </th>
                  <th
                    rowSpan={2}
                    className="border border-slate-300 px-1 sm:px-4 py-2 sm:py-3 font-bold align-middle uppercase tracking-wider text-[9px] sm:text-xs w-10 sm:w-16"
                  >
                    DAY
                  </th>
                  <th
                    colSpan={3}
                    className="border border-slate-300 px-1.5 sm:px-4 py-2 sm:py-2.5 font-bold uppercase tracking-wider text-[10px] sm:text-xs bg-slate-750"
                  >
                    MEDICAL OFFICER
                  </th>
                  <th
                    colSpan={2}
                    className="border border-slate-300 px-1.5 sm:px-4 py-2 sm:py-2.5 font-bold uppercase tracking-wider text-[10px] sm:text-xs bg-teal-700"
                  >
                    EMERGENCY PHYSICIAN
                  </th>
                </tr>
                {/* Row 2 Header */}
                <tr className="bg-slate-700 text-white border border-slate-700 select-none">
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5">
                    AM
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5">
                    PM
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5">
                    NIGHT
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5 bg-teal-700/80">
                    OFFICE HOUR
                  </th>
                  <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/5 bg-teal-700/80">
                    ON CALL
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {daysInMonthList.map(({ dayNum, dayName, dateStr }, dayIndex) => {
                  const dayAssignments = rosterGrid[dateStr] || { AM: [], PM: [], NIGHT: [] };
                  const isWeekend = dayName === 'SAT' || dayName === 'SUN';
                  const isToday = dateStr === todayStr;
                  const holidayName = getHolidayName(dateStr);
                  const isHoliday = !!holidayName;

                  return (
                    <tr
                      key={dateStr}
                      className={`transition-colors border border-slate-300 ${
                        isToday
                          ? 'bg-indigo-50/80 hover:bg-indigo-100/60 ring-1 ring-inset ring-indigo-300'
                          : isHoliday
                          ? 'bg-rose-50/60 hover:bg-rose-100/50'
                          : isWeekend 
                          ? 'bg-slate-100/80 hover:bg-slate-200/50' 
                          : 'bg-white hover:bg-slate-50/50'
                      }`}
                    >
                      {/* Date */}
                      <td className={`border border-slate-300 px-0.5 sm:px-4 py-1.5 sm:py-3 font-bold align-middle select-none text-[10px] sm:text-sm ${
                        isToday ? 'text-indigo-900 bg-indigo-100/50' : isHoliday ? 'text-rose-700' : 'text-slate-800'
                      }`}>
                        {dayNum}
                        {isToday && <span className="block text-[8px] sm:text-[9px] text-indigo-600 mt-0.5">TODAY</span>}
                        {isHoliday && !isToday && <span className="block text-[7px] sm:text-[8px] text-rose-500 font-extrabold mt-0.5 uppercase leading-tight">PH</span>}
                      </td>

                      {/* Day Name */}
                      <td className={`border border-slate-300 px-0.5 sm:px-4 py-1.5 sm:py-3 font-bold align-middle select-none text-[10px] sm:text-sm ${
                        isToday ? 'text-indigo-900 bg-indigo-100/50' : isHoliday ? 'text-rose-700' : isWeekend ? 'text-indigo-600' : 'text-slate-600'
                      }`}>
                        {dayName}
                        {isHoliday && <span className="block text-[7px] sm:text-[8px] text-rose-500 font-bold mt-0.5 normal-case truncate max-w-[4rem]" title={holidayName}>{holidayName}</span>}
                      </td>


                      {/* Medical Officer Shift Cells (AM, PM, NIGHT) */}
                      {['AM', 'PM', 'NIGHT'].map((shiftCol, shiftIndex) => (
                        <td key={shiftCol} className="border border-slate-300 p-0 align-middle h-14">
                          {isEditMode ? (
                            <textarea
                              id={`cell-${dayIndex}-${shiftIndex}`}
                              value={
                                shiftCol === 'NIGHT'
                                  ? getNightShiftNamesFromGrid(editedGrid[dateStr])
                                  : (editedGrid[dateStr]?.[shiftCol] ?? '')
                              }
                              onChange={(e) => handleCellChange(dateStr, shiftCol, e.target.value)}
                              onKeyDown={(e) => handleKeyDown(e, dateStr, shiftCol, dayIndex, shiftIndex)}
                              onPaste={(e) => handlePaste(e, dayIndex, shiftIndex)}
                              className={`w-full h-full min-h-[3.5rem] px-0.5 sm:px-4 py-1 sm:py-2 text-center text-[10px] sm:text-sm font-bold bg-transparent outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 transition-all hover:bg-slate-50 focus:bg-white resize-none overflow-hidden ${
                                isWeekend ? 'text-indigo-900' : 'text-slate-800'
                              }`}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-2">
                              {dayAssignments[shiftCol].length > 0 ? (
                                dayAssignments[shiftCol].map((name) => {
                                  const nameKey = normalizeForComparison(name);
                                  const rawShift = doctorRosterMap.get(nameKey)?.get(dateStr) || '';
                                  const isDocStandby = parseShiftValue(rawShift).isStandby;
                                  return (
                                    <span
                                      key={name}
                                      className={`inline-flex items-center gap-1 tracking-wide uppercase text-[9px] sm:text-xs font-bold transition-all px-1 sm:px-1.5 py-0.5 rounded-lg ${
                                        isMatch(name)
                                          ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300 animate-pulse scale-105 shadow-sm'
                                          : 'text-slate-700'
                                      }`}
                                    >
                                      <span>{name}</span>
                                      {isDocStandby && (
                                        <span className="inline-flex items-center justify-center px-0.5 rounded bg-amber-500 text-white text-[8px] font-extrabold min-w-[10px] h-[10px] select-none" title="Standby">
                                          S
                                        </span>
                                      )}
                                      {parseShiftValue(rawShift).isExtended && (
                                        <span className="inline-flex items-center justify-center px-0.5 rounded bg-blue-500 text-white text-[8px] font-extrabold min-w-[10px] h-[10px] select-none" title="Extended Shift">
                                          EX
                                        </span>
                                      )}
                                    </span>
                                  );
                                })
                              ) : (
                                <span className="text-slate-300 text-xs">-</span>
                              )}
                            </div>
                          )}
                        </td>
                      ))}

                      {/* Emergency Physician Cells (Office Hour + On Call) */}
                      {[['EP_OFFICE_HOUR', 3, 'Office Hour'], ['EP_ONCALL', 4, 'On Call']].map(([epKey, shiftIndex, slotLabel]) => {
                        const epVal = isEditMode
                          ? (editedGrid[dateStr]?.[epKey] ?? '')
                          : (() => {
                              // Read from masterRoster directly for EP fields
                              const raw = masterRoster.filter(r => {
                                const d = toIsoDate(r.Date || r.date);
                                const s = String(r.Shift || r.shift || '').trim().toUpperCase();
                                return d === dateStr && s === epKey;
                              });
                              return raw.map(r => String(r.Name || r.name || '').trim()).filter(Boolean).join(', ');
                            })();

                        const yesterdayDateStr = dayIndex > 0 ? daysInMonthList[dayIndex - 1]?.dateStr : null;
                        const yesterdayValue = yesterdayDateStr ? (editedGrid[yesterdayDateStr]?.[epKey] ?? '') : '';

                        return (
                          <td key={epKey} className={`border border-slate-300 p-0 align-middle h-14 ${
                            isToday ? 'bg-teal-50/30' : isWeekend ? 'bg-teal-50/20' : 'bg-teal-50/10'
                          }`}>
                            {isEditMode ? (
                              <EmergencyPhysicianMultiSelect
                                id={`cell-${dayIndex}-${shiftIndex}`}
                                value={epVal}
                                physicians={emergencyPhysicians.length ? emergencyPhysicians : (directoryMap?.ep || [])}
                                isWeekend={isWeekend}
                                activeEpStamp={activeEpStamp}
                                yesterdayValue={yesterdayValue}
                                slotLabel={slotLabel}
                                dateLabel={`${dayNum} (${dayName})`}
                                onChange={(val) => {
                                  setEditedGrid(prev => ({
                                    ...prev,
                                    [dateStr]: { ...(prev[dateStr] || {}), [epKey]: val }
                                  }));
                                }}
                                onNavigateKeyDown={(e) => handleKeyDown(e, dateStr, epKey, dayIndex, shiftIndex)}
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 sm:py-2">
                                {epVal ? (
                                  epVal.split(/[,\n]+/).map(n => n.trim()).filter(Boolean).map(name => (
                                    <span
                                      key={name}
                                      className={`inline-flex items-center tracking-wide text-[9px] sm:text-xs font-bold transition-all px-1 sm:px-1.5 py-0.5 rounded-lg ${
                                        isMatch(name)
                                          ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300 animate-pulse scale-105 shadow-sm'
                                          : 'text-teal-700'
                                      }`}
                                    >
                                      {name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-slate-300 text-xs">-</span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )}

      {daysInMonthList.length > 0 && activeTab === 'table' && (
        <>
          {/* 📊 Finalized Monthly Spreadsheet Card (Table View) */}
          <div className={`rounded-3xl border bg-white p-1 shadow-sm overflow-hidden transition-all duration-300 ${isEditMode ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-150/70'}`}>
            <div className="overflow-x-auto" ref={rosterScrollRef}>
              <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs text-center font-sans">
                <thead>
                  <tr className="bg-slate-800 text-white select-none">
                    <th className="sticky left-0 z-20 bg-slate-800 px-3 py-3 text-left font-bold uppercase tracking-wider shadow-sm ring-1 ring-slate-200 text-[10px] sm:text-xs min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate">
                      Name
                    </th>
                    {daysInMonthList.map((day) => {
                      const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                      const holidayName = getHolidayName(day.dateStr);
                      const isHoliday = !!holidayName;
                      return (
                        <th
                          key={day.dateStr}
                          className={`whitespace-nowrap border-b border-slate-200 px-2.5 py-3 font-bold uppercase tracking-wider text-[10px] sm:text-xs min-w-[3.8rem] ${
                            day.dayName === 'SUN' ? 'border-r-2 border-r-slate-500 border-b-slate-700/40' : 'border-r border-slate-700/40'
                          } ${
                            isHoliday ? 'bg-rose-950 text-rose-100 ring-1 ring-rose-900/20' : isWeekendDay ? 'bg-slate-900' : 'bg-slate-800'
                          }`}
                          title={isHoliday ? holidayName : undefined}
                        >
                          <div>{day.dayNum}</div>
                          <div className={`text-[8px] ${isHoliday ? 'text-rose-200 font-extrabold' : 'opacity-75'}`}>{day.dayName}</div>
                          {isHoliday && <div className="text-[7px] text-rose-300 font-bold truncate max-w-[3.5rem]">{holidayName.toUpperCase()}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
              <tbody>
                {names.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-xs sm:text-sm text-slate-500 text-left"
                      colSpan={daysInMonthList.length + 1}
                    >
                      No team members available.
                    </td>
                  </tr>
                ) : (
                  names.map((name, nameIndex) => {
                    const nameMapped = mapName(name);
                    const nameKey = normalizeForComparison(nameMapped);
                    const matched = isMatch(nameMapped);
                    return (
                      <tr key={name} className="hover:bg-slate-50/50 transition-colors">
                        <th
                          className={`sticky left-0 z-10 px-3 py-2 text-left font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 transition-colors min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate ${
                            matched
                              ? 'bg-amber-100 text-amber-900 ring-2 ring-amber-300'
                              : 'bg-white'
                          }`}
                        >
                          {nameMapped.toUpperCase()}
                        </th>
                        {daysInMonthList.map((day, dayIndex) => {
                          const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                          const isToday = day.dateStr === todayStr;
                          const holidayName = getHolidayName(day.dateStr);
                          const isHoliday = !!holidayName;
                          
                          let val = '';
                          if (isEditMode || isStandbyEditMode || isExtendedEditMode || isExcelTableEditMode) {
                            val = getEditingShift(day.dateStr, nameMapped);
                          } else {
                            val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
                            if (!val && isUpcomingMonth) {
                              const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
                              if (reqData) {
                                val = reqData.shift;
                              }
                            }
                          }
                          const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
                          const isCustomCommentOnly = !!(reqData && (reqData.type?.toLowerCase() === 'admincomment' || reqData.requestType?.toLowerCase() === 'admincomment'));
                          const hasRequestComment = !!(reqData && !isCustomCommentOnly && reqData.comment);
                          const hasCustomComment = !!(reqData && (isCustomCommentOnly ? reqData.comment : reqData.customComment?.comment));
                          const customCommentText = reqData ? (isCustomCommentOnly ? reqData.comment : reqData.customComment?.comment || '') : '';
                          const cleanVal = val ? parseShiftValue(val).cleanShift : '';
                          const isWorking = isWorkingShift(cleanVal);
                          const isNonWorkingShift = !!cleanVal && !isWorking;
                          const isRequested = !!(reqData && !isCustomCommentOnly && cleanVal.toUpperCase() === reqData.shift.toUpperCase());
                          const hasOverride = !!(reqData && !isCustomCommentOnly && cleanVal.toUpperCase() !== reqData.shift.toUpperCase());
                          const hasIndicator = hasRequestComment || hasCustomComment || hasOverride;
                          const isCellInteractive = (hasIndicator || (isAdmin && !isPeriodLocked)) && !isEditMode && !isStandbyEditMode && !isExtendedEditMode && !isExcelTableEditMode;

                          let cellBg = isToday 
                            ? 'bg-indigo-50/40' 
                            : isHoliday
                            ? 'bg-rose-100/60'
                            : isWeekendDay 
                            ? 'bg-slate-100/80' 
                            : 'bg-white';

                          if (isStandbyEditMode) {
                            if (isNonWorkingShift) {
                              cellBg = isToday 
                                ? 'bg-amber-100/80' 
                                : isHoliday
                                ? 'bg-amber-100/60'
                                : isWeekendDay 
                                ? 'bg-amber-50/90' 
                                : 'bg-amber-50/70';
                            } else if (isWorking) {
                              cellBg = isToday ? 'bg-indigo-50/20' : 'bg-slate-50/40';
                            }
                          }

                          let cellTooltip = '';
                          const tooltips = [];
                          if (reqData) {
                            if (isCustomCommentOnly) {
                              tooltips.push(`Comment: "${reqData.comment}"`);
                            } else {
                              if (hasOverride) {
                                tooltips.push(`Requested: ${reqData.shift}${reqData.comment ? `\nComment: "${reqData.comment}"` : ''}`);
                              } else if (reqData.comment) {
                                tooltips.push(`Request Comment: "${reqData.comment}"`);
                              }
                              if (reqData.customComment?.comment) {
                                tooltips.push(`Comment: "${reqData.customComment.comment}"`);
                              }
                            }
                          }
                          cellTooltip = tooltips.join('\n');

                          const selectClass = `w-full text-center text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} rounded-lg border px-1.5 py-1 outline-none transition-all cursor-pointer ${getShiftBadgeClass(val, isRequested)}`;

                          return (
                            <td
                              key={day.dateStr}
                              onClick={() => {
                                if (isCellInteractive) {
                                  setActiveCommentDetail({
                                    doctorName: nameMapped,
                                    dateStr: day.dateStr,
                                    dayName: day.dayName,
                                    dayNum: day.dayNum,
                                    val,
                                    comment: reqData && !isCustomCommentOnly ? reqData.comment || '' : '',
                                    requestedShift: reqData && !isCustomCommentOnly ? reqData.shift || '' : '',
                                    hasOverride,
                                    reqId: reqData && !isCustomCommentOnly ? reqData.id || null : null,
                                    reqType: reqData && !isCustomCommentOnly ? reqData.type || null : null,
                                    isCustomComment: isCustomCommentOnly,
                                    hasCustomComment,
                                    customCommentText,
                                    customCommentId: isCustomCommentOnly ? reqData?.id : reqData?.customComment?.id || null,
                                  });
                                  setAdminCommentText(customCommentText);
                                }
                              }}
                              className={`border-b p-1.5 h-10 min-w-[3.8rem] align-middle ${
                                day.dayName === 'SUN' ? 'border-r-2 border-r-slate-300 border-b-slate-100' : 'border-r border-slate-100'
                              } ${cellBg} ${isCellInteractive ? 'cursor-pointer hover:bg-indigo-50/30' : ''} ${
                                isStandbyEditMode && isNonWorkingShift ? 'ring-1 ring-inset ring-amber-300/70' : ''
                              }`}
                            >
                              <div className="relative w-full h-full flex items-center justify-center">
                                {isStandbyEditMode ? (
                                  val ? (
                                    <button
                                      onClick={() => handleToggleStandby(day.dateStr, name)}
                                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} transition-all shadow-sm active:scale-95 cursor-pointer ${
                                        parseShiftValue(val).isStandby
                                          ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 ring-2 ring-amber-400/60 font-bold shadow-md'
                                          : isNonWorkingShift
                                          ? 'bg-amber-50/90 hover:bg-amber-100 text-amber-950 border-amber-300 font-semibold hover:border-amber-400 shadow-2xs hover:scale-105'
                                          : 'bg-white hover:bg-slate-50 text-slate-400 border-slate-200/80 opacity-60 hover:opacity-100'
                                      }`}
                                      title={
                                        parseShiftValue(val).isStandby
                                          ? "Click to remove standby"
                                          : isNonWorkingShift
                                          ? `Non-working shift (${cleanVal}): click to assign standby`
                                          : `Working shift (${cleanVal}) - standby is intended for non-working shifts`
                                      }
                                    >
                                      <span>{parseShiftValue(val).cleanShift}</span>
                                      <span className={`inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold leading-none min-w-[12px] h-[12px] ${
                                        parseShiftValue(val).isStandby
                                          ? 'bg-white text-amber-600 shadow-2xs'
                                          : isNonWorkingShift
                                          ? 'bg-amber-200/90 text-amber-900 border border-amber-300'
                                          : 'bg-slate-150 text-slate-400'
                                      }`}>
                                        S
                                      </span>
                                      {parseShiftValue(val).isExtended && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-blue-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Extended Shift">
                                          EX
                                        </span>
                                      )}
                                    </button>
                                  ) : (
                                    <span className="text-slate-250 cursor-help" title={cellTooltip}>-</span>
                                  )
                                ) : isExtendedEditMode ? (
                                  val ? (
                                    <button
                                      onClick={() => handleToggleExtended(day.dateStr, name)}
                                      className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg border text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} transition-all shadow-sm active:scale-95 ${
                                        parseShiftValue(val).isExtended
                                          ? 'bg-blue-500 hover:bg-blue-600 text-white border-blue-600'
                                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                                      }`}
                                      title={parseShiftValue(val).isExtended ? "Click to remove extended shift" : "Click to set extended shift"}
                                    >
                                      <span>{parseShiftValue(val).cleanShift}</span>
                                      {parseShiftValue(val).isStandby && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-amber-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Standby">
                                          S
                                        </span>
                                      )}
                                      <span className={`inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold leading-none min-w-[12px] h-[12px] ${
                                        parseShiftValue(val).isExtended ? 'bg-white text-blue-600' : 'bg-slate-200 text-slate-600'
                                      }`}>
                                        EX
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="text-slate-250 cursor-help" title={cellTooltip}>-</span>
                                  )
                                ) : isEditMode ? (
                                  <select
                                    value={parseShiftValue(val).cleanShift}
                                    onChange={(e) => handleTableEditCellChange(day.dateStr, name, e.target.value)}
                                    className={selectClass}
                                    title={cellTooltip}
                                  >
                                    <option value="">-</option>
                                    {dropdownShifts.map((shiftOpt) => (
                                      <option key={shiftOpt} value={shiftOpt}>
                                        {shiftOpt}
                                      </option>
                                    ))}
                                  </select>
                                ) : isExcelTableEditMode ? (
                                  <input
                                    type="text"
                                    id={`table-cell-${dayIndex}-${nameIndex}`}
                                    value={getDisplayShiftValue(val)}
                                    onChange={(e) => handleTableEditCellChange(day.dateStr, name, e.target.value)}
                                    onKeyDown={(e) => handleTableKeyDown(e, dayIndex, nameIndex)}
                                    onPaste={(e) => handleTablePaste(e, dayIndex, nameIndex)}
                                    className={`w-full text-center text-[10px] sm:text-xs font-bold rounded-lg border px-1.5 py-1 outline-none transition-all cursor-text bg-white border-slate-200 text-slate-700 focus:ring-2 focus:ring-teal-500 focus:bg-white`}
                                    title={cellTooltip}
                                  />
                                ) : (
                                  val ? (
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[10px] sm:text-xs ${isRequested ? 'font-bold' : 'font-normal'} ${getShiftBadgeClass(val, isRequested)}`} title={cellTooltip}>
                                      {parseShiftValue(val).cleanShift}
                                      {parseShiftValue(val).isStandby && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-amber-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Standby">
                                          S
                                        </span>
                                      )}
                                      {parseShiftValue(val).isExtended && (
                                        <span className="inline-flex items-center justify-center px-1 rounded-full text-[8px] font-extrabold bg-blue-500 text-white leading-none min-w-[12px] h-[12px] shadow-sm select-none" title="Extended Shift">
                                          EX
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-slate-250 cursor-help" title={cellTooltip}>-</span>
                                  )
                                )}
                                {hasRequestComment && (
                                  <span className="absolute -top-1 -left-1 flex h-2 w-2 cursor-help" title={cellTooltip}>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                                  </span>
                                )}
                                {hasCustomComment && (
                                  <span className="absolute -bottom-1 -left-1 flex h-2 w-2 cursor-help" title={cellTooltip}>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-300 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400"></span>
                                  </span>
                                )}
                                {hasOverride && (
                                  <span className="absolute -top-1 -right-1 flex h-2 w-2 cursor-help" title={cellTooltip}>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 📊 Shift Distribution Tally Card */}
        {isAdmin && (
          <div className="mt-6 rounded-3xl border border-slate-150/70 bg-white p-1 shadow-sm overflow-hidden transition-all duration-300">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <span>📊</span> Shift Distribution Tally
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">Counts per shift type</span>
          </div>
          <div className="overflow-x-auto/no-scrollbar" ref={tallyScrollRef} style={{ overflowX: 'auto' }}>
            <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs text-center font-sans">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-100 select-none">
                  <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-bold uppercase tracking-wider shadow-sm ring-1 ring-slate-100 text-[10px] sm:text-xs min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate">
                    Shift Type
                  </th>
                  {daysInMonthList.map((day) => {
                    const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                    const holidayName = getHolidayName(day.dateStr);
                    const isHoliday = !!holidayName;
                    return (
                      <th
                        key={day.dateStr}
                        className={`whitespace-nowrap border-b px-2.5 py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs min-w-[3.8rem] ${
                          day.dayName === 'SUN' ? 'border-r-2 border-r-slate-300 border-b-slate-100' : 'border-r border-slate-100'
                        } ${
                          isHoliday ? 'bg-rose-100/60 text-rose-800' : isWeekendDay ? 'bg-slate-200/60' : 'bg-slate-50'
                        }`}
                        title={isHoliday ? holidayName : undefined}
                      >
                        <div>{day.dayNum}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tallyData.shifts.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-xs text-slate-500 text-left"
                      colSpan={daysInMonthList.length + 1}
                    >
                      No active shifts assigned.
                    </td>
                  </tr>
                ) : (
                  tallyData.shifts.map((shiftType) => {
                    const isTotalLeave = shiftType === 'TOTAL LEAVE';
                    const isEmptyRow = shiftType === 'EMPTY';
                    return (
                      <tr key={shiftType} className={`hover:bg-slate-50/50 transition-colors ${isTotalLeave || isEmptyRow ? 'bg-slate-50/80 border-t border-slate-200 font-extrabold shadow-sm' : ''}`}>
                        <th className={`sticky left-0 z-10 px-3 py-1.5 text-left font-bold text-slate-700 shadow-sm ring-1 ring-slate-100 min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate ${isTotalLeave || isEmptyRow ? 'bg-slate-50/90 font-extrabold' : 'bg-white'}`}>
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${getShiftBadgeClass(shiftType)}`}>
                            {shiftType === 'EMPTY' ? 'BLANK/EMPTY' : shiftType}
                          </span>
                        </th>
                        {daysInMonthList.map((day) => {
                          const isWeekendDay = day.dayName === 'SAT' || day.dayName === 'SUN';
                          const isToday = day.dateStr === todayStr;
                          const holidayName = getHolidayName(day.dateStr);
                          const isHoliday = !!holidayName;
                          
                          let cellBg = isToday 
                            ? 'bg-indigo-50/40' 
                            : isHoliday
                            ? 'bg-rose-100/60'
                            : isWeekendDay 
                            ? 'bg-slate-100/80' 
                            : 'bg-white';
                          
                          if ((isTotalLeave || isEmptyRow) && !isToday) {
                            cellBg = isWeekendDay ? 'bg-indigo-50/10' : 'bg-indigo-50/5';
                          }
                          
                          const count = tallyData.tallyMap.get(day.dateStr)?.get(shiftType) || 0;
                          const amCount = tallyData.tallyMap.get(day.dateStr)?.get('AM') || 0;
                          const pmCount = tallyData.tallyMap.get(day.dateStr)?.get('PM') || 0;
 
                          let hasAlert = false;
                          let alertMsg = '';
                          if (shiftType === 'AM') {
                            if (count < tallyThresholds.amMin) {
                              hasAlert = true;
                              alertMsg = `Alert: Below AM minimum of ${tallyThresholds.amMin}`;
                            } else if (count > pmCount) {
                              hasAlert = true;
                              alertMsg = `Alert: AM count (${count}) exceeds PM count (${pmCount})`;
                            }
                          } else if (shiftType === 'PM') {
                            if (count < tallyThresholds.pmMin) {
                              hasAlert = true;
                              alertMsg = `Alert: Below PM minimum of ${tallyThresholds.pmMin}`;
                            } else if (count < amCount) {
                              hasAlert = true;
                              alertMsg = `Alert: PM count (${count}) is less than AM count (${amCount})`;
                            }
                          } else if (shiftType === 'NIGHT') {
                            if (count < tallyThresholds.nightMin) {
                              hasAlert = true;
                              alertMsg = `Alert: Below Night minimum of ${tallyThresholds.nightMin}`;
                            } else if (count > tallyThresholds.nightMax) {
                              hasAlert = true;
                              alertMsg = `Alert: Exceeds Night maximum of ${tallyThresholds.nightMax}`;
                            }
                          } else if (shiftType === 'TOTAL LEAVE' && count > tallyThresholds.totalLeaveMax) {
                            hasAlert = true;
                            alertMsg = `Alert: Exceeds Total Leave maximum of ${tallyThresholds.totalLeaveMax}`;
                          } else if (shiftType === 'EMPTY' && count > 0) {
                            alertMsg = `${count} member${count > 1 ? 's' : ''} unassigned on this day`;
                          }
 
                          let cellClass = `border-b p-1.5 h-8 min-w-[3.8rem] align-middle transition-colors font-bold ${
                            day.dayName === 'SUN' ? 'border-r-2 border-r-slate-300 border-b-slate-100' : 'border-r border-slate-100'
                          }`;
                          if (hasAlert) {
                            cellClass += ` bg-rose-50 text-rose-700 ring-1 ring-rose-200`;
                          } else if (isEmptyRow && count > 0) {
                            cellClass += ` bg-amber-50/70 text-amber-850 ring-1 ring-amber-200/50 ${cellBg}`;
                          } else {
                            cellClass += ` ${isTotalLeave ? 'text-indigo-700' : isEmptyRow ? 'text-amber-800' : 'text-slate-800'} ${cellBg}`;
                          }
 
                          return (
                            <td
                              key={day.dateStr}
                              className={cellClass}
                              title={alertMsg || `${shiftType === 'EMPTY' ? 'BLANK/EMPTY' : shiftType} count: ${count}`}
                            >
                              {count > 0 ? (
                                <span className={`text-xs font-extrabold ${hasAlert ? 'text-rose-700' : isEmptyRow ? 'text-amber-850' : isTotalLeave ? 'text-indigo-700' : 'text-slate-900'}`}>
                                  {count}
                                  {hasAlert && <span className="ml-0.5 text-[9px]">⚠️</span>}
                                  {isEmptyRow && <span className="ml-0.5 text-[9px] select-none">⚠️</span>}
                                </span>
                              ) : (
                                <span className={hasAlert ? 'text-rose-400 font-extrabold text-xs' : 'text-slate-350'}>
                                  {hasAlert ? '0 ⚠️' : '-'}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* 👤 Individual Member Shift Tally Card */}
        {isAdmin && (
          <div className="mt-6 rounded-3xl border border-slate-150/70 bg-white shadow-sm overflow-hidden transition-all duration-300">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <span>👤</span> Individual Member Shift Tally
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">{memberTallyData.length} members · {daysInMonthList.length} days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs text-center font-sans">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-100 select-none">
                  <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2.5 text-left font-bold uppercase tracking-wider shadow-sm ring-1 ring-slate-100 text-[10px] sm:text-xs min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate">
                    Name
                  </th>
                  {memberTallyColumns.map((col) => {
                    const style = getColumnStyle(col);
                    return (
                      <th
                        key={col}
                        className={`px-3 py-2.5 font-bold uppercase tracking-wider text-[10px] sm:text-xs whitespace-nowrap border-l border-slate-100 ${style.headerClass}`}
                      >
                        {col}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {memberTallyData.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-xs text-slate-500 text-left" colSpan={memberTallyColumns.length + 1}>
                      No team members available.
                    </td>
                  </tr>
                ) : (
                  memberTallyData.map((entry) => {
                    const nameKey = normalizeForComparison(entry.name);
                    const matched = isMatch(entry.name);
                    return (
                      <tr
                        key={nameKey}
                        className={`hover:bg-slate-50/60 transition-colors border-b border-slate-100/80 ${
                          matched ? 'bg-amber-50/40 ring-1 ring-inset ring-amber-200' : ''
                        }`}
                      >
                        <th
                          className={`sticky left-0 z-10 px-3 py-1.5 text-left font-semibold text-slate-800 shadow-sm ring-1 ring-slate-100 min-w-[7.5rem] max-w-[7.5rem] w-[7.5rem] truncate text-[10px] sm:text-xs ${
                            matched ? 'bg-amber-50 text-amber-900' : 'bg-white'
                          }`}
                        >
                          {entry.name.toUpperCase()}
                        </th>
                        {memberTallyColumns.map((col) => {
                          const style = getColumnStyle(col);
                          const val = col === 'TOTAL LEAVES' ? entry.counts.TOTAL_LEAVE : entry.counts[col];
                          return (
                            <td
                              key={col}
                              className={`px-3 py-1.5 border-l border-slate-100 font-bold align-middle ${
                                val > 0 ? style.cellColor : 'text-slate-300'
                              } ${val > 0 ? style.cellBg : ''}`}
                            >
                              {val > 0 ? val : <span className="text-slate-300">-</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* ⚙️ Tally Alert Threshold Settings Card */}
        {isAdmin && (
          <div className="mt-6 rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm transition-all duration-300 animate-fadeIn">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
              <span className="text-lg">⚙️</span>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Tally Alert Threshold Settings
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">AM Min</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.amMin}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, amMin: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">PM Min</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.pmMin}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, pmMin: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Night Min</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.nightMin}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, nightMin: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Night Max</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.nightMax}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, nightMax: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                <label className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Max Total Leave</label>
                <input
                  type="number"
                  min="0"
                  value={tallyThresholds.totalLeaveMax}
                  onChange={(e) => setTallyThresholds(p => ({ ...p, totalLeaveMax: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:bg-white transition-all w-full text-center"
                />
              </div>
            </div>
          </div>
        )}
      </>
    )}

      {daysInMonthList.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <span className="text-4xl block mb-2">📅</span>
          <p className="font-semibold text-sm">No roster records detected for the selected month.</p>
        </div>
      )}
      {isExportModalOpen && createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">Roster PDF Export</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Creates a print-ready roster document using the export layout.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="rounded-full px-2 py-1 text-lg font-bold leading-none text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleExportSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Main title
                </label>
                <input
                  type="text"
                  value={exportSettings.mainTitle}
                  onChange={(e) => handleExportSettingChange('mainTitle', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Roster type
                  </label>
                  <select
                    value={exportSettings.rosterType}
                    onChange={(e) => handleExportSettingChange('rosterType', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                  >
                    <option value="MO & EP ROSTER">MO &amp; EP ROSTER</option>
                    <option value="EP ROSTER">EP ROSTER</option>
                    <option value="MO ROSTER">MO ROSTER</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Month/year
                  </label>
                  <input
                    type="text"
                    value={exportSettings.monthYear}
                    onChange={(e) => handleExportSettingChange('monthYear', e.target.value.toUpperCase())}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold uppercase outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>
              </div>

              {exportSettings.rosterType === 'MO ROSTER' && (
                <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 space-y-3">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-1">
                    Signature Config
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Prepared By
                      </label>
                      <input
                        type="text"
                        value={exportSettings.preparedBy || ''}
                        onChange={(e) => handleExportSettingChange('preparedBy', e.target.value)}
                        placeholder="Name"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Checked By
                      </label>
                      <input
                        type="text"
                        value={exportSettings.checkedBy || ''}
                        onChange={(e) => handleExportSettingChange('checkedBy', e.target.value)}
                        placeholder="Name"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Approved By
                      </label>
                      <input
                        type="text"
                        value={exportSettings.approvedBy || ''}
                        onChange={(e) => handleExportSettingChange('approvedBy', e.target.value)}
                        placeholder="Name"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold outline-none focus:border-indigo-400"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Version
                </label>
                <input
                  type="text"
                  value={exportSettings.version}
                  onChange={(e) => handleExportSettingChange('version', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Optional notes
                </label>
                <textarea
                  rows="3"
                  value={exportSettings.notes}
                  onChange={(e) => handleExportSettingChange('notes', e.target.value)}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              <div className="flex gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsExportModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-indigo-600 py-2 text-xs font-bold text-white shadow-md shadow-indigo-100 transition hover:bg-indigo-700"
                >
                  Generate PDF
                </button>
              </div>
            </form>
          </div>
        </div>
      ), document.body)}

      {activeCommentDetail && createPortal((
        <div 
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-900/60 p-4 backdrop-blur-sm animate-fadeIn" 
          onClick={() => setActiveCommentDetail(null)}
        >
          <div 
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl animate-slideUp text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar for mobile bottom sheet cue */}
            <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden"></div>

            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 mb-4">
              <div>
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                  Roster Details
                </span>
                <h3 className="text-base font-extrabold text-slate-800 mt-1 uppercase tracking-wide">
                  {activeCommentDetail.doctorName}
                </h3>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  {activeCommentDetail.dayNum} {activeCommentDetail.dayName} · {activeCommentDetail.dateStr}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCommentDetail(null)}
                className="rounded-full bg-slate-100 p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
              >
                <span className="block w-5 h-5 text-center leading-none text-lg font-bold">×</span>
              </button>
            </div>

            <div className="space-y-4">
              {/* Assigned Shift Status */}
              <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-3">
                <span className="font-bold text-slate-500 uppercase tracking-wide">Assigned Shift</span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${getShiftBadgeClass(activeCommentDetail.val)}`}>
                  {parseShiftValue(activeCommentDetail.val).cleanShift || 'OFF'}
                  {parseShiftValue(activeCommentDetail.val).isStandby && (
                    <span className="inline-flex items-center justify-center px-1 rounded-full text-[9px] font-extrabold bg-amber-500 text-white min-w-[12px] h-[12px] shadow-sm select-none" title="Standby">S</span>
                  )}
                  {parseShiftValue(activeCommentDetail.val).isExtended && (
                    <span className="inline-flex items-center justify-center px-1 rounded-full text-[9px] font-extrabold bg-blue-500 text-white min-w-[12px] h-[12px] shadow-sm select-none" title="Extended Shift">EX</span>
                  )}
                </span>
              </div>

              {/* Assignment Override Details */}
              {activeCommentDetail.hasOverride && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 animate-fadeIn">
                  <h4 className="text-xs font-extrabold text-amber-800 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                    <span>⚠️</span> Assignment Override
                  </h4>
                  <div className="text-xs text-amber-900 space-y-1">
                    <p>This assignment differs from the request submitted by the doctor.</p>
                    <p className="font-semibold">Requested: <span className="bg-amber-100 px-1.5 py-0.5 rounded font-extrabold">{activeCommentDetail.requestedShift}</span></p>
                  </div>
                </div>
              )}

              {/* Direct Shift Re-assignment (Admin Only) */}
              {isAdmin && !isPeriodLocked && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 animate-fadeIn space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-extrabold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>✏️</span> Re-assign Shift
                    </h4>
                    {activeCommentDetail.val && (
                      <span className="text-[10px] font-semibold text-indigo-600 bg-white/80 border border-indigo-200 px-2 py-0.5 rounded-full">
                        Current: {parseShiftValue(activeCommentDetail.val).cleanShift || 'OFF'}
                      </span>
                    )}
                  </div>

                  {/* Quick-Tap Shift Badges */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Quick-Tap Common Shifts:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {quickShiftOptions.map((opt) => {
                        const isSelected = reassignShift.toUpperCase() === opt.toUpperCase();
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setReassignShift(opt)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-300 shadow-sm scale-105'
                                : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/60'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setReassignShift('');
                          setReassignStandby(false);
                          setReassignExtended(false);
                        }}
                        className={`px-2 py-1 rounded-lg text-xs font-bold border border-dashed transition-all cursor-pointer ${
                          !reassignShift
                            ? 'bg-rose-600 text-white border-rose-700 ring-2 ring-rose-300 shadow-sm'
                            : 'bg-white text-slate-400 border-slate-300 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50/50'
                        }`}
                        title="Clear Shift Assignment"
                      >
                        ✕ Clear
                      </button>
                    </div>
                  </div>

                  {/* All Shifts Dropdown */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Or Select From All Shifts:
                    </div>
                    <select
                      value={reassignShift}
                      onChange={(e) => setReassignShift(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-xs font-bold text-slate-700 shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">-- Clear / Unassign (Blank) --</option>
                      {dropdownShifts.map((shift) => (
                        <option key={shift} value={shift}>
                          {shift}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Shift Modifiers: Standby and Extended Shift toggles */}
                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={reassignStandby}
                        onChange={(e) => setReassignStandby(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                      />
                      <span>Standby <strong className="text-amber-600 font-extrabold">(S)</strong></span>
                    </label>

                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={reassignExtended}
                        onChange={(e) => setReassignExtended(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                      />
                      <span>Extended <strong className="text-blue-600 font-extrabold">(X)</strong></span>
                    </label>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-2 border-t border-indigo-100/80">
                    <button
                      type="button"
                      disabled={isReassigning}
                      onClick={() => handleDirectShiftReassignment(false)}
                      className="flex-1 rounded-xl bg-indigo-600 py-2 px-3 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 active:scale-95 transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {isReassigning ? (
                        <>
                          <span className="animate-spin text-sm">⏳</span>
                          <span>Updating...</span>
                        </>
                      ) : (
                        <>
                          <span>💾</span>
                          <span>{reassignShift ? `Assign "${reassignShift}${reassignStandby ? ' (S)' : ''}${reassignExtended ? ' (X)' : ''}"` : 'Clear Assignment'}</span>
                        </>
                      )}
                    </button>

                    {activeCommentDetail.val && (
                      <button
                        type="button"
                        disabled={isReassigning}
                        onClick={() => handleDirectShiftReassignment(true)}
                        className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 active:scale-95 transition disabled:opacity-50 cursor-pointer"
                        title="Remove current shift assignment"
                      >
                        Remove Shift
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isAdmin && isPeriodLocked && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 flex items-center gap-2">
                  <span>🔒</span>
                  <span>Shift reassignment is disabled because this period is {lifecycleInfo.state === 'CLOSED' ? 'Closed' : 'Published'}.</span>
                </div>
              )}

              {/* Request Comment */}
              {activeCommentDetail.comment && (
                <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4 animate-fadeIn">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 mb-1.5 text-purple-800">
                    <span>💬</span> Request Comment
                  </h4>
                  <p className="text-xs italic font-semibold leading-relaxed text-purple-900">
                    "{activeCommentDetail.comment}"
                  </p>
                </div>
              )}

              {/* Custom Comment */}
              {activeCommentDetail.hasCustomComment && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 animate-fadeIn">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 mb-1.5 text-slate-700">
                    <span>💬</span> Custom Comment
                  </h4>
                  <p className="text-xs italic font-semibold leading-relaxed text-slate-800">
                    "{activeCommentDetail.customCommentText}"
                  </p>
                </div>
              )}

              {/* Admin Custom Comment Editor */}
              {isAdmin && (
                <div className="mt-4 pt-4 border-t border-slate-100 animate-fadeIn">
                  <label htmlFor="adminCommentInput" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    ✍️ Admin Custom Comment
                  </label>
                  <textarea
                    id="adminCommentInput"
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none"
                    placeholder="Add a custom comment for this cell..."
                    value={adminCommentText}
                    onChange={(e) => setAdminCommentText(e.target.value)}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveAdminComment}
                      className="flex-1 rounded-xl bg-indigo-600 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
                    >
                      Save Comment
                    </button>
                    {activeCommentDetail.hasCustomComment && (
                      <button
                        type="button"
                        onClick={handleDeleteAdminComment}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 transition"
                      >
                        Delete Custom Comment
                      </button>
                    )}
                    {activeCommentDetail.comment && !activeCommentDetail.hasCustomComment && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm("Clear doctor's request comment?")) {
                            try {
                              await onSubmitRequest({
                                id: activeCommentDetail.reqId,
                                name: activeCommentDetail.doctorName,
                                date: activeCommentDetail.dateStr,
                                request: activeCommentDetail.requestedShift || 'OFF',
                                comment: '',
                                requestType: activeCommentDetail.reqType || 'Leave',
                              });
                              setActiveCommentDetail(null);
                            } catch (err) {
                              console.error('Failed to clear request comment:', err);
                            }
                          }
                        }}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 transition"
                      >
                        Delete Request Comment
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveCommentDetail(null)}
              className="mt-6 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-800 transition"
            >
              Close
            </button>
          </div>
        </div>
      ), document.body)}

      {isMemoModalOpen && createPortal((
        <div 
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-900/60 p-4 backdrop-blur-sm animate-fadeIn" 
          onClick={() => setIsMemoModalOpen(false)}
        >
          <div 
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl animate-slideUp text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar for mobile bottom sheet cue */}
            <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden"></div>

            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 mb-4">
              <div>
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                  Planning Tool
                </span>
                <h3 className="text-base font-extrabold text-slate-800 mt-1 uppercase tracking-wide">
                  📝 Roster Memos
                </h3>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  Store reference notes and comments for planning.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMemoModalOpen(false)}
                className="rounded-full bg-slate-100 p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
              >
                <span className="block w-5 h-5 text-center leading-none text-lg font-bold">×</span>
              </button>
            </div>

            <div className="space-y-4">
              {/* Month Picker Selection Row */}
              <div className="flex flex-col gap-1 text-xs">
                <label htmlFor="memoMonthPicker" className="font-bold text-slate-500 uppercase tracking-wide">
                  Target Month
                </label>
                <input
                  id="memoMonthPicker"
                  type="month"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  value={memoMonth}
                  onChange={(e) => setMemoMonth(e.target.value)}
                />
              </div>

              {/* Memo Content Editor Area */}
              <div className="flex flex-col gap-1 text-xs">
                <label htmlFor="memoTextEditor" className="font-bold text-slate-500 uppercase tracking-wide">
                  Planning Notes
                </label>
                <textarea
                  id="memoTextEditor"
                  rows={6}
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none"
                  placeholder={`Write reference notes for ${memoMonth} (e.g., specific leaves, course attendees, roster constraints)...`}
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                />
              </div>

              <div className="mt-6 flex gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (onUpdateSetting) {
                        await onUpdateSetting(`memo_${memoMonth}`, memoText);
                      }
                      setIsMemoModalOpen(false);
                    } catch (err) {
                      console.error('Failed to save roster memo:', err);
                    }
                  }}
                  className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-indigo-700 transition"
                >
                  Save Memo
                </button>
                <button
                  type="button"
                  onClick={() => setIsMemoModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
