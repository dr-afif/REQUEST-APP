import React, { useEffect, useMemo, useRef, useState } from 'react';

export const QUICK_SHIFTS = [
  { code: 'AM', label: 'AM', category: 'day', keyHint: 'A' },
  { code: 'PM', label: 'PM', category: 'afternoon', keyHint: 'P' },
  { code: 'OFF', label: 'OFF', category: 'rest', keyHint: 'O' },
  { code: 'ON1', label: 'ON1', category: 'night', keyHint: '1' },
  { code: 'ON2', label: 'ON2', category: 'night', keyHint: '2' },
  { code: 'PN', label: 'PN', category: 'night', keyHint: 'N' },
  { code: 'HKA', label: 'HKA', category: 'holiday', keyHint: 'H' },
  { code: 'AMX', label: 'AMX', category: 'day', keyHint: '' },
  { code: 'PMX', label: 'PMX', category: 'afternoon', keyHint: '' },
  { code: '', label: 'None', category: 'clear', keyHint: 'Del' }
];

export default function QuickShiftPalette({
  isOpen,
  targetCell,
  initialFilter = '',
  onSelectShift,
  onClose,
  positionStyle = {}
}) {
  const [filter, setFilter] = useState(initialFilter || '');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Sync initial filter on open
  useEffect(() => {
    if (isOpen) {
      setFilter(initialFilter || '');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen, initialFilter]);

  // Compute filtered shifts list
  const shifts = useMemo(() => {
    if (!filter.trim()) return QUICK_SHIFTS;
    const q = filter.trim().toUpperCase();
    const matched = QUICK_SHIFTS.filter(s =>
      s.code.toUpperCase().includes(q) || s.label.toUpperCase().includes(q)
    );
    return matched.length > 0 ? matched : QUICK_SHIFTS;
  }, [filter]);

  // Highlight matching shift
  useEffect(() => {
    if (!isOpen) return;
    if (filter.trim()) {
      const q = filter.trim().toUpperCase();
      const matchIdx = shifts.findIndex(s => s.code.toUpperCase() === q);
      if (matchIdx !== -1) {
        setSelectedIndex(matchIdx);
        return;
      }
    }
    setSelectedIndex(0);
  }, [isOpen, filter, shifts]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => (prev + 1) % shifts.length);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => (prev - 1 + shifts.length) % shifts.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const selected = shifts[selectedIndex];
        if (selected) {
          onSelectShift(selected.code);
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, selectedIndex, shifts, onSelectShift, onClose]);

  if (!isOpen || !targetCell) return null;

  return (
    <div
      ref={containerRef}
      id="quick-shift-palette"
      data-testid="quick-shift-palette"
      tabIndex={-1}
      role="dialog"
      aria-label="Quick Shift Assignment Palette"
      className="fixed z-50 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 p-3 w-72 animate-in fade-in zoom-in-95 duration-100 outline-none"
      style={positionStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 text-xs">
        <div>
          <span className="font-bold text-slate-800">{targetCell.personNameSnapshot}</span>
          <span className="text-slate-500 ml-1.5 font-mono text-[11px]">{targetCell.date}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 rounded p-0.5 hover:bg-slate-100 cursor-pointer"
          aria-label="Close palette"
        >
          ✕
        </button>
      </div>

      {/* Quick Search / Filter Input */}
      <input
        ref={inputRef}
        id="quick-palette-search"
        data-testid="quick-palette-search"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter shift (A, P, O, 1, 2...)"
        className="w-full px-2.5 py-1 text-xs font-mono font-bold border border-slate-200 rounded-lg mb-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 text-slate-800"
      />

      <div className="grid grid-cols-4 gap-1.5" role="listbox" aria-label="Available shifts">
        {shifts.map((s, idx) => {
          const isSelected = idx === selectedIndex;
          const isCurrent = targetCell.currentShiftCode === s.code;

          let colorClasses = 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200';
          if (s.category === 'day') colorClasses = 'bg-blue-50 text-blue-800 hover:bg-blue-100 border-blue-200';
          if (s.category === 'afternoon') colorClasses = 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200';
          if (s.category === 'night') colorClasses = 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border-indigo-200';
          if (s.category === 'rest') colorClasses = 'bg-slate-100 text-slate-800 hover:bg-slate-200 border-slate-300';
          if (s.category === 'holiday') colorClasses = 'bg-rose-50 text-rose-800 hover:bg-rose-100 border-rose-200';
          if (s.category === 'clear') colorClasses = 'bg-slate-50 text-slate-500 hover:bg-slate-100 border-dashed border-slate-200';

          return (
            <button
              key={s.code || 'clear'}
              id={`palette-shift-${(s.code || 'clear').toLowerCase()}`}
              data-testid={`palette-shift-${(s.code || 'clear').toLowerCase()}`}
              role="option"
              aria-selected={isSelected}
              type="button"
              onClick={() => {
                onSelectShift(s.code);
                onClose();
              }}
              className={`p-1.5 rounded-xl text-center text-xs font-bold border transition relative cursor-pointer ${colorClasses} ${
                isSelected
                  ? 'ring-2 ring-indigo-500 ring-offset-1 scale-102 z-10 shadow-sm'
                  : 'opacity-90'
              }`}
            >
              <span className="block font-mono leading-none">{s.label}</span>
              {s.keyHint && (
                <span className="block text-[8px] opacity-50 font-normal mt-0.5">{s.keyHint}</span>
              )}
              {isCurrent && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" title="Current assignment" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
        <span>Enter: Confirm</span>
        <span>Arrows: Pick</span>
        <span>Esc: Cancel</span>
      </div>
    </div>
  );
}
