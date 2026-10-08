import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { getHolidayName } from '../../../utils/holidays.js';
import QuickShiftPalette from './QuickShiftPalette.jsx';
import KeyboardShortcutsModal from './KeyboardShortcutsModal.jsx';

/**
 * Current Roster View:
 * Authoritative working roster and high-speed DRAFT roster builder.
 * Reflects:
 *   - Working assignments
 *   - Active absences (with coverage state: Uncovered vs Covered by Dr X)
 *   - Replacement covering duties (with covering lineage: Covering Dr Y)
 *   - Changed badge for mutated cells
 * Exposes admin actions:
 *   - Rapid keyboard-first DRAFT roster entry (Spreadsheet roving focus, Quick palette, Repeat last, Copy/Paste, Multi-selection, Bulk edits)
 *   - "Record absence" on working assignments (PUBLISHED / AMENDED)
 *   - "Assign replacement" on uncovered absent duties (PUBLISHED / AMENDED)
 *   - Shift amendments / swaps (PUBLISHED / AMENDED)
 * Read-only for viewers or when CLOSED.
 */
export default function CurrentRosterView({
  currentAssignments = [],
  plannedAssignments = [],
  people = [],
  period,
  isAdmin = false,
  lifecycleState = 'PUBLISHED',
  mutationsEnabled = false,
  onSelectCellForAmend,
  onSelectDutyForAbsence,
  onSelectDutyForReplacement,
  onOpenAbsenceModal,
  onSelectDutyForEntitlement,
  onSelectPersonForEntitlement,
  onOpenEntitlementsPanel,
  // Phase 8 Slice 2 DRAFT Fast Editing Props
  onDraftCellChange,
  onBulkDraftChange,
  onUndoDraft,
  onRedoDraft,
  canUndoDraft = false,
  canRedoDraft = false,
  isSavingDraft = false,
  draftSaveStatus = 'saved'
}) {
  const normState = String(lifecycleState || 'PUBLISHED').toUpperCase();
  const isDraft = normState === 'DRAFT';
  const isClosed = normState === 'CLOSED';
  const canAmend = Boolean(
    isAdmin &&
    mutationsEnabled &&
    ['PUBLISHED', 'AMENDED'].includes(normState)
  );
  const canEditDraft = Boolean(isAdmin && mutationsEnabled && isDraft);

  // People map for fast authoritative name lookup
  const peopleMap = useMemo(() => {
    const map = new Map();
    (people || []).forEach(p => {
      const id = p.personId || p.PersonId;
      const name = p.name || p.PersonNameSnapshot || p.personNameSnapshot || id;
      if (id) map.set(id, name);
    });
    (currentAssignments || []).forEach(a => {
      if (a.personId && !map.has(a.personId)) {
        map.set(a.personId, a.personNameSnapshot || a.personId);
      }
    });
    return map;
  }, [people, currentAssignments]);

  const getDoctorName = (id, fallback) => {
    if (!id) return fallback || '';
    return peopleMap.get(id) || fallback || id;
  };

  // Index planned assignments by authoritative (PersonId + Date + DutyDomain)
  const plannedMap = useMemo(() => {
    const map = new Map();
    plannedAssignments.forEach((a) => {
      const key = `${a.personId}::${a.date}::${a.dutyDomain}`;
      map.set(key, a.shiftCode || '');
    });
    return map;
  }, [plannedAssignments]);

  // Group current assignments by Person & Domain (including any people from people prop)
  const groupedByPerson = useMemo(() => {
    const map = new Map();
    (people || []).forEach(p => {
      const id = p.personId || p.PersonId;
      const domain = p.dutyDomain || p.role || 'MO';
      const name = p.name || p.CurrentDisplayName || p.PersonNameSnapshot || id;
      if (id) {
        const groupKey = `${id}::${domain}`;
        map.set(groupKey, {
          personId: id,
          personNameSnapshot: name,
          dutyDomain: domain,
          cells: {}
        });
      }
    });

    currentAssignments.forEach((a) => {
      const groupKey = `${a.personId}::${a.dutyDomain}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          personId: a.personId,
          personNameSnapshot: a.personNameSnapshot || getDoctorName(a.personId, a.personId),
          dutyDomain: a.dutyDomain,
          cells: {}
        });
      }
      map.get(groupKey).cells[a.date] = a;
    });

    return Array.from(map.values()).sort((a, b) => {
      const domainWeight = (d) => (d === 'MO' ? 0 : d === 'EP' ? 1 : 2);
      const dwA = domainWeight(a.dutyDomain);
      const dwB = domainWeight(b.dutyDomain);
      if (dwA !== dwB) return dwA - dwB;
      return (a.personNameSnapshot || '').localeCompare(b.personNameSnapshot || '');
    });
  }, [currentAssignments, people, peopleMap]);

  // Extract unique sorted dates for header (generates full month if empty)
  const sortedDates = useMemo(() => {
    const dates = new Set();
    currentAssignments.forEach((a) => {
      if (a.date) dates.add(a.date);
    });
    plannedAssignments.forEach((a) => {
      if (a.date) dates.add(a.date);
    });
    if (dates.size === 0 && period && /^\d{4}-\d{2}$/.test(period)) {
      const [year, month] = period.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        dates.add(`${period}-${String(day).padStart(2, '0')}`);
      }
    }
    return Array.from(dates).sort();
  }, [currentAssignments, plannedAssignments, period]);

  // Memoized date metadata map (weekday, weekend, holiday, today) for high-density rendering
  const dateMetaMap = useMemo(() => {
    const map = new Map();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const weekdayShorts = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    sortedDates.forEach((d) => {
      const parts = d.split('-').map(Number);
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const holidayName = getHolidayName(d);
      const isHoliday = Boolean(holidayName);
      const isToday = d === todayStr;
      const dayNum = String(parts[2]).padStart(2, '0');
      const weekday = weekdayShorts[dayOfWeek] || '';

      map.set(d, {
        date: d,
        dayNum,
        weekday,
        dayOfWeek,
        isWeekend,
        isHoliday,
        holidayName,
        isToday
      });
    });
    return map;
  }, [sortedDates]);

  // =========================================================================
  // ROVING KEYBOARD FOCUS & MULTI-CELL SELECTION STATE
  // =========================================================================
  const [activeCoord, setActiveCoord] = useState({ r: 0, c: 0 });
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [selectionTarget, setSelectionTarget] = useState(null);
  const [lastAssignedShift, setLastAssignedShift] = useState('AM');
  const internalClipboardRef = useRef(null);

  // Quick palette state
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteFilter, setPaletteFilter] = useState('');
  const [paletteTargetCell, setPaletteTargetCell] = useState(null);
  const [palettePosition, setPalettePosition] = useState({});

  // Help modal & bulk confirmation state
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [bulkConfirmTarget, setBulkConfirmTarget] = useState(null);
  const [bulkStatusMsg, setBulkStatusMsg] = useState(null);

  // Clear selection on period switch
  useEffect(() => {
    setSelectionAnchor(null);
    setSelectionTarget(null);
    setIsPaletteOpen(false);
    setBulkConfirmTarget(null);
    setBulkStatusMsg(null);
  }, [period]);

  // Compute selected cell keys set
  const selectedCellKeys = useMemo(() => {
    const set = new Set();
    if (selectionAnchor && selectionTarget) {
      const minR = Math.min(selectionAnchor.r, selectionTarget.r);
      const maxR = Math.max(selectionAnchor.r, selectionTarget.r);
      const minC = Math.min(selectionAnchor.c, selectionTarget.c);
      const maxC = Math.max(selectionAnchor.c, selectionTarget.c);
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const row = groupedByPerson[r];
          const d = sortedDates[c];
          if (row && d) {
            set.add(`${row.personId}::${d}::${row.dutyDomain}`);
          }
        }
      }
    } else {
      const activeRow = groupedByPerson[activeCoord.r];
      const activeDate = sortedDates[activeCoord.c];
      if (activeRow && activeDate) {
        set.add(`${activeRow.personId}::${activeDate}::${activeRow.dutyDomain}`);
      }
    }
    return set;
  }, [selectionAnchor, selectionTarget, activeCoord, groupedByPerson, sortedDates]);

  // Programmatic focus helper
  const focusCell = useCallback((r, c) => {
    if (r < 0 || r >= groupedByPerson.length || c < 0 || c >= sortedDates.length) return;
    setActiveCoord({ r, c });
    const row = groupedByPerson[r];
    const date = sortedDates[c];
    const btnId = `btn-amend-${row.personId}-${date}-${row.dutyDomain}`;
    const el = document.getElementById(btnId) || document.getElementById(`cell-${row.personId}-${date}-${row.dutyDomain}`);
    if (el) el.focus({ preventScroll: false });
  }, [groupedByPerson, sortedDates]);

  // Clear multi-cell range selection
  const clearSelection = useCallback(() => {
    setSelectionAnchor(null);
    setSelectionTarget(null);
  }, []);

  // Open Quick Palette at cell
  const openPaletteForCell = useCallback((cellData, initialFilt = '') => {
    if (!cellData) return;
    const btnId = `btn-amend-${cellData.personId}-${cellData.date}-${cellData.dutyDomain}`;
    const btnEl = document.getElementById(btnId);
    let pos = { top: '35%', left: '40%' };
    if (btnEl) {
      const rect = btnEl.getBoundingClientRect();
      const top = Math.min(window.innerHeight - 240, Math.max(10, rect.bottom + 6));
      const left = Math.min(window.innerWidth - 300, Math.max(10, rect.left));
      pos = { top: `${top}px`, left: `${left}px` };
    }
    setPaletteTargetCell(cellData);
    setPaletteFilter(initialFilt);
    setPalettePosition(pos);
    setIsPaletteOpen(true);
  }, []);

  // Direct mutation dispatcher
  const applyShiftToSelection = useCallback((shiftCode) => {
    if (!isDraft || !canEditDraft) return;

    // Gather target cells from selection
    const targetCells = [];
    selectedCellKeys.forEach((key) => {
      const [personId, date, dutyDomain] = key.split('::');
      if (dutyDomain !== 'EP') {
        targetCells.push({ personId, date, dutyDomain });
      }
    });

    if (targetCells.length === 0) return;

    // Safety threshold check: if > 10 cells, require explicit confirmation modal
    if (targetCells.length > 10) {
      setBulkConfirmTarget({ shiftCode, cells: targetCells });
      return;
    }

    // Execute directly for <= 10 cells
    if (onBulkDraftChange && targetCells.length > 1) {
      onBulkDraftChange(targetCells.map(c => ({ ...c, shiftCode })));
    } else if (onDraftCellChange) {
      targetCells.forEach(c => {
        onDraftCellChange(c.personId, c.date, c.dutyDomain, shiftCode);
      });
    }

    setLastAssignedShift(shiftCode || 'OFF');
    setBulkStatusMsg(`Applied ${shiftCode || 'None'} to ${targetCells.length} selected cells`);
    setTimeout(() => setBulkStatusMsg(null), 3000);
    setIsPaletteOpen(false);

    // Maintain focus on active cell
    focusCell(activeCoord.r, activeCoord.c);
  }, [isDraft, canEditDraft, selectedCellKeys, onBulkDraftChange, onDraftCellChange, focusCell, activeCoord]);

  // Execute confirmed large bulk apply
  const handleConfirmBulkApply = () => {
    if (!bulkConfirmTarget) return;
    const { shiftCode, cells } = bulkConfirmTarget;
    if (onBulkDraftChange) {
      onBulkDraftChange(cells.map(c => ({ ...c, shiftCode })));
    } else if (onDraftCellChange) {
      cells.forEach(c => onDraftCellChange(c.personId, c.date, c.dutyDomain, shiftCode));
    }
    setLastAssignedShift(shiftCode || 'OFF');
    setBulkStatusMsg(`Applied ${shiftCode || 'None'} to ${cells.length} cells`);
    setTimeout(() => setBulkStatusMsg(null), 3000);
    setBulkConfirmTarget(null);
    clearSelection();
    focusCell(activeCoord.r, activeCoord.c);
  };

  // Keyboard navigation & shortcut listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Guard: Do not intercept if focus is inside input, textarea, select, or modal
      const tag = e.target.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) {
        return;
      }
      if (isPaletteOpen || isShortcutsOpen || bulkConfirmTarget) {
        return; // Modal or palette handles its own keys
      }

      const R = groupedByPerson.length;
      const C = sortedDates.length;
      if (R === 0 || C === 0) return;

      let r = activeCoord.r;
      let c = activeCoord.c;
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      if (activeEl && (activeEl.id?.startsWith('btn-amend-') || activeEl.id?.startsWith('cell-'))) {
        for (let rowIdx = 0; rowIdx < groupedByPerson.length; rowIdx++) {
          const row = groupedByPerson[rowIdx];
          for (let colIdx = 0; colIdx < sortedDates.length; colIdx++) {
            const date = sortedDates[colIdx];
            if (activeEl.id === `btn-amend-${row.personId}-${date}-${row.dutyDomain}` ||
                activeEl.id === `cell-${row.personId}-${date}-${row.dutyDomain}`) {
              r = rowIdx;
              c = colIdx;
              break;
            }
          }
        }
      }

      // 1. Arrow Navigation & Multi-Cell Range Selection
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextC = Math.min(C - 1, c + 1);
        if (e.shiftKey && isDraft) {
          if (!selectionAnchor) setSelectionAnchor({ r, c });
          setSelectionTarget({ r, c: nextC });
        } else {
          clearSelection();
        }
        focusCell(r, nextC);
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const nextC = Math.max(0, c - 1);
        if (e.shiftKey && isDraft) {
          if (!selectionAnchor) setSelectionAnchor({ r, c });
          setSelectionTarget({ r, c: nextC });
        } else {
          clearSelection();
        }
        focusCell(r, nextC);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextR = Math.min(R - 1, r + 1);
        if (e.shiftKey && isDraft) {
          if (!selectionAnchor) setSelectionAnchor({ r, c });
          setSelectionTarget({ r: nextR, c });
        } else {
          clearSelection();
        }
        focusCell(nextR, c);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextR = Math.max(0, r - 1);
        if (e.shiftKey && isDraft) {
          if (!selectionAnchor) setSelectionAnchor({ r, c });
          setSelectionTarget({ r: nextR, c });
        } else {
          clearSelection();
        }
        focusCell(nextR, c);
        return;
      }

      // Home & End Navigation
      if (e.key === 'Home') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          clearSelection();
          focusCell(0, 0);
        } else {
          clearSelection();
          focusCell(r, 0);
        }
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          clearSelection();
          focusCell(R - 1, C - 1);
        } else {
          clearSelection();
          focusCell(r, C - 1);
        }
        return;
      }

      // Escape: Clear range selection
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      // Repeat Last Shift: Ctrl + Enter
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (isDraft && canEditDraft && lastAssignedShift) {
          applyShiftToSelection(lastAssignedShift);
        }
        return;
      }

      // Enter: Open Quick Palette (DRAFT) or open Phase 5 Amendment Modal (PUBLISHED/AMENDED)
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const activeRow = groupedByPerson[r];
        const activeDate = sortedDates[c];
        if (!activeRow || !activeDate) return;
        const cellData = activeRow.cells[activeDate] || {
          personId: activeRow.personId,
          personNameSnapshot: activeRow.personNameSnapshot,
          date: activeDate,
          dutyDomain: activeRow.dutyDomain,
          shiftCode: 'OFF'
        };

        if (isDraft && canEditDraft) {
          openPaletteForCell(cellData);
        } else if (canAmend && onSelectCellForAmend) {
          onSelectCellForAmend(cellData);
        }
        return;
      }

      // Clipboard: Copy (Ctrl + C)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        const activeRow = groupedByPerson[r];
        const activeDate = sortedDates[c];
        if (activeRow && activeDate) {
          const shift = activeRow.cells[activeDate]?.shiftCode || 'OFF';
          internalClipboardRef.current = shift;
        }
        return;
      }

      // Clipboard: Paste (Ctrl + V)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (isDraft && canEditDraft && internalClipboardRef.current) {
          applyShiftToSelection(internalClipboardRef.current);
        }
        return;
      }

      // History: Undo (Ctrl + Z)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (isDraft && onUndoDraft) {
          onUndoDraft();
        }
        return;
      }

      // History: Redo (Ctrl + Shift + Z or Ctrl + Y)
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (isDraft && onRedoDraft) {
          onRedoDraft();
        }
        return;
      }

      // Direct Shift Entry Shortcuts in DRAFT (A, P, O, 1, 2, N, H, Del)
      if (isDraft && canEditDraft && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeRow = groupedByPerson[r];
        const activeDate = sortedDates[c];
        if (!activeRow || !activeDate) return;
        const cellData = activeRow.cells[activeDate] || {
          personId: activeRow.personId,
          personNameSnapshot: activeRow.personNameSnapshot,
          date: activeDate,
          dutyDomain: activeRow.dutyDomain,
          shiftCode: 'OFF'
        };

        const k = e.key.toUpperCase();
        if (k === 'A') {
          e.preventDefault();
          openPaletteForCell(cellData, 'AM');
        } else if (k === 'P') {
          e.preventDefault();
          openPaletteForCell(cellData, 'PM');
        } else if (k === 'O') {
          e.preventDefault();
          openPaletteForCell(cellData, 'OFF');
        } else if (k === '1') {
          e.preventDefault();
          openPaletteForCell(cellData, 'ON1');
        } else if (k === '2') {
          e.preventDefault();
          openPaletteForCell(cellData, 'ON2');
        } else if (k === 'N') {
          e.preventDefault();
          openPaletteForCell(cellData, 'PN');
        } else if (k === 'H') {
          e.preventDefault();
          openPaletteForCell(cellData, 'HKA');
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          applyShiftToSelection('');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeCoord,
    groupedByPerson,
    sortedDates,
    isDraft,
    canEditDraft,
    canAmend,
    selectionAnchor,
    lastAssignedShift,
    isPaletteOpen,
    isShortcutsOpen,
    bulkConfirmTarget,
    focusCell,
    clearSelection,
    openPaletteForCell,
    applyShiftToSelection,
    onSelectCellForAmend,
    onUndoDraft,
    onRedoDraft
  ]);

  return (
    <div className="space-y-4" aria-label="Current Authoritative Roster" id="current-roster-view">
      {/* Top Banner / Guidance */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3.5 lg:p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 gap-2">
        <div>
          <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
            <span>{isDraft ? '✏️' : '📋'}</span>
            <span>{isDraft ? 'Draft Roster Workspace' : 'Authoritative Working Roster'}</span>
          </h4>
          <p className="text-xs text-indigo-800/80 mt-0.5">
            {isDraft
              ? 'Keyboard-first drafting active. Use arrow keys to navigate, type A/P/O for quick shifts, Ctrl+Enter to repeat.'
              : canAmend
              ? 'Click duty cells to modify shifts, record absences, assign replacements, or use entitlements.'
              : 'Displaying authoritative schedule. Amendments require administrator authorization.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Shortcuts Help Button */}
          <button
            type="button"
            id="btn-keyboard-help"
            data-testid="btn-keyboard-help"
            onClick={() => setIsShortcutsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 active:scale-95 transition shadow-2xs cursor-pointer"
            aria-label="View keyboard shortcuts"
          >
            <span>⌨️</span>
            <span className="hidden sm:inline">Shortcuts</span>
          </button>

          {onOpenEntitlementsPanel && (
            <button
              type="button"
              id="btn-toolbar-entitlements"
              data-testid="btn-toolbar-entitlements"
              onClick={onOpenEntitlementsPanel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-teal-800 border border-teal-200 hover:bg-teal-50 active:scale-95 transition shadow-2xs cursor-pointer"
            >
              <span>⚖️</span>
              <span>Entitlements</span>
            </button>
          )}

          {canAmend && onOpenAbsenceModal && (
            <button
              type="button"
              id="btn-toolbar-record-absence"
              data-testid="btn-toolbar-record-absence"
              onClick={onOpenAbsenceModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 active:scale-95 transition shadow-2xs cursor-pointer"
            >
              <span>🩺</span>
              <span>Record Absence</span>
            </button>
          )}

          {canAmend && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
              <span>✏️</span> Amendment Mode
            </span>
          )}

          {isDraft && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
              <span>⚡</span> Fast Entry Mode
            </span>
          )}
        </div>
      </div>

      {/* Floating Status Notice if bulk action applied */}
      {bulkStatusMsg && (
        <div
          id="bulk-status-msg"
          data-testid="bulk-status-msg"
          className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-xs font-semibold text-emerald-800 flex items-center justify-between shadow-xs animate-in fade-in"
        >
          <span>✓ {bulkStatusMsg}</span>
          <button
            type="button"
            onClick={() => setBulkStatusMsg(null)}
            className="text-emerald-700 hover:text-emerald-900 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {groupedByPerson.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-slate-300 bg-white">
          <p className="text-sm font-semibold text-slate-700">No doctors or assignments found for {period}</p>
        </div>
      ) : (
        <div
          className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden roster-desktop-grid-container relative"
          id="current-roster-grid-container"
          data-testid="current-roster-grid-container"
        >
          <div
            className="overflow-auto max-h-[calc(100vh-220px)] lg:max-h-[calc(100vh-190px)] roster-scroll-viewport focus:outline-none"
            tabIndex={0}
            aria-label="Current roster table scroll area"
          >
            <table className="w-full text-left text-xs border-collapse border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 bg-slate-50 shadow-xs">
                <tr className="bg-slate-50 text-slate-600">
                  <th
                    className="p-2 lg:p-2.5 font-bold sticky left-0 top-0 bg-slate-50 min-w-[150px] lg:min-w-[170px] z-30 border-r border-b border-slate-200 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                    scope="col"
                  >
                    <span>Doctor / Staff</span>
                  </th>
                  <th
                    className="p-2 lg:p-2.5 font-bold min-w-[55px] lg:min-w-[65px] text-center border-r border-b border-slate-200 bg-slate-50 sticky top-0 z-20"
                    scope="col"
                  >
                    <span>Domain</span>
                  </th>
                  {sortedDates.map((d) => {
                    const meta = dateMetaMap.get(d) || { dayNum: d.split('-')[2], weekday: '', isWeekend: false, isHoliday: false, isToday: false };
                    const headerAria = `${d}, ${meta.weekday}${meta.holidayName ? `, Public Holiday: ${meta.holidayName}` : ''}${meta.isToday ? ', Today' : ''}`;
                    return (
                      <th
                        key={d}
                        scope="col"
                        aria-label={headerAria}
                        className={`p-1 lg:p-1.5 font-bold text-center min-w-[48px] lg:min-w-[46px] max-w-[65px] border-r border-b border-slate-200 sticky top-0 z-20 transition-colors ${
                          meta.isToday
                            ? 'bg-indigo-50/95 text-indigo-900 ring-2 ring-inset ring-indigo-400'
                            : meta.isHoliday
                            ? 'bg-rose-50/90 text-rose-900'
                            : meta.isWeekend
                            ? 'bg-slate-100/90 text-slate-700'
                            : 'bg-slate-50 text-slate-600'
                        }`}
                        title={meta.holidayName ? `${d} (${meta.holidayName})` : d}
                        data-is-weekend={meta.isWeekend ? 'true' : undefined}
                        data-is-holiday={meta.isHoliday ? 'true' : undefined}
                        data-is-today={meta.isToday ? 'true' : undefined}
                      >
                        <span className={`block text-[9px] font-semibold uppercase tracking-wider ${
                          meta.isHoliday
                            ? 'text-rose-600 font-bold'
                            : meta.isWeekend
                            ? 'text-slate-600 font-bold'
                            : 'text-slate-400'
                        }`}>
                          {meta.weekday}
                        </span>
                        <span className={`block text-xs lg:text-sm font-extrabold leading-tight ${
                          meta.isToday ? 'text-indigo-600' : 'text-slate-700'
                        }`}>
                          {meta.dayNum}
                        </span>
                        {meta.isHoliday && (
                          <span
                            className="inline-block text-[8px] font-bold text-rose-700 bg-rose-100 px-1 py-0.2 rounded border border-rose-300 leading-none mt-0.5 truncate max-w-[44px]"
                            title={meta.holidayName}
                            data-testid={`header-holiday-${d}`}
                          >
                            PH
                          </span>
                        )}
                        {meta.isToday && (
                          <span
                            className="inline-block text-[8px] font-bold text-indigo-700 bg-indigo-100 px-1 py-0.2 rounded border border-indigo-300 leading-none mt-0.5 truncate max-w-[44px]"
                            data-testid={`header-today-${d}`}
                          >
                            Today
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupedByPerson.map((row, rIdx) => (
                  <tr key={`${row.personId}-${row.dutyDomain}`} className="hover:bg-slate-50/80 transition-colors">
                    {/* Sticky Doctor Name */}
                    <td className="p-2 lg:p-2.5 font-bold text-slate-800 sticky left-0 z-10 bg-white border-r border-b border-slate-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate max-w-[120px] lg:max-w-[140px]" title={row.personNameSnapshot}>
                          {row.personNameSnapshot}
                        </span>
                        {/* Entitlement action for MO in admin mode */}
                        {isAdmin && row.dutyDomain !== 'EP' && onSelectPersonForEntitlement && (
                          <button
                            type="button"
                            id={`btn-view-entitlements-${row.personId}`}
                            data-testid={`btn-view-entitlements-${row.personId}`}
                            onClick={() => onSelectPersonForEntitlement(row.personId)}
                            title={`View ${row.personNameSnapshot}'s Entitlement Balances`}
                            className="opacity-70 hover:opacity-100 p-0.5 rounded text-teal-700 hover:bg-teal-50 transition cursor-pointer"
                          >
                            ⚖️
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Domain badge */}
                    <td className="p-1 lg:p-1.5 text-center border-r border-b border-slate-100">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                        row.dutyDomain === 'EP'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-blue-100 text-blue-800 border border-blue-200'
                      }`}>
                        {row.dutyDomain}
                      </span>
                    </td>

                    {/* Duty cells */}
                    {sortedDates.map((date, cIdx) => {
                      const assignment = row.cells[date];
                      const meta = dateMetaMap.get(date) || { isWeekend: false, isHoliday: false, isToday: false };
                      const currentShift = assignment?.shiftCode || '';
                      const plannedShift = plannedMap.get(`${row.personId}::${date}::${row.dutyDomain}`) || '';

                      const isAbsence = assignment?.source === 'ABSENCE' ||
                        assignment?.coverageStatus === 'UNCOVERED' ||
                        (assignment?.coverageStatus === 'COVERED' && assignment?.absenceId);
                      const isUncovered = isAbsence && assignment?.coverageStatus !== 'COVERED';
                      const isCoveredAbsence = isAbsence && assignment?.coverageStatus === 'COVERED';
                      const isCovering = assignment?.source === 'REPLACEMENT' || Boolean(assignment?.coveringForPersonId);
                      const isChanged = Boolean(plannedShift && currentShift && currentShift !== plannedShift);
                      const isEntitlementDuty = currentShift === 'GOFF' || currentShift === 'GHKA';
                      const isWorking = currentShift && currentShift !== 'OFF' && currentShift !== 'HKA' && !isEntitlementDuty && !isAbsence && !isCovering;

                      let coveringDoctorName = '';
                      if (isCoveredAbsence && assignment?.replacementId) {
                        const replAssign = (currentAssignments || []).find(
                          a => a.replacementId === assignment.replacementId && a.source === 'REPLACEMENT'
                        );
                        if (replAssign) {
                          coveringDoctorName = replAssign.personNameSnapshot || getDoctorName(replAssign.personId, 'Covering Doctor');
                        }
                      }

                      let absentDoctorName = '';
                      if (isCovering && assignment?.coveringForPersonId) {
                        absentDoctorName = getDoctorName(assignment.coveringForPersonId, 'Absent Doctor');
                      }

                      const cellData = {
                        assignmentId: assignment?.assignmentId || null,
                        personId: row.personId,
                        personNameSnapshot: row.personNameSnapshot,
                        date: date,
                        dutyDomain: row.dutyDomain,
                        currentShiftCode: currentShift,
                        plannedShiftCode: plannedShift,
                        isAbsence: isAbsence,
                        isUncovered: isUncovered,
                        coverageStatus: assignment?.coverageStatus || null,
                        replacementId: assignment?.replacementId || null,
                        absenceId: assignment?.absenceId || null,
                        absentPersonId: row.personId,
                        absentPersonName: row.personNameSnapshot,
                        absenceType: isAbsence ? currentShift : null
                      };

                      // Accessible name for assistive technology and automated audits
                      const statusParts = [];
                      if (isAbsence) {
                        statusParts.push(`Absence ${currentShift}`);
                        statusParts.push(isUncovered ? 'Uncovered' : `Covered by ${coveringDoctorName || 'replacement'}`);
                      } else if (isCovering) {
                        statusParts.push(`${currentShift} Covering`);
                        statusParts.push(`Covering ${absentDoctorName || 'colleague'}`);
                      } else if (currentShift === 'GOFF') {
                        statusParts.push('GOFF Entitlement');
                      } else if (currentShift === 'GHKA') {
                        statusParts.push('GHKA Entitlement');
                      } else if (currentShift === 'HKA') {
                        statusParts.push('HKA Holiday Rest');
                      } else if (currentShift) {
                        statusParts.push(currentShift);
                      } else {
                        statusParts.push('OFF');
                      }
                      if (isChanged) {
                        statusParts.push(`amended from ${plannedShift || 'OFF'}`);
                      }
                      const cellAriaLabel = `${row.personNameSnapshot}, ${date}, ${statusParts.join(', ')}`;

                      const cellKey = `${row.personId}::${date}::${row.dutyDomain}`;
                      const isSelected = selectedCellKeys.has(cellKey);
                      const isFocused = activeCoord.r === rIdx && activeCoord.c === cIdx;

                      const cellBgClass = isSelected
                        ? 'bg-indigo-100/90 ring-2 ring-indigo-500 ring-inset z-10'
                        : isUncovered
                        ? 'bg-rose-50/70'
                        : isCoveredAbsence
                        ? 'bg-purple-50/50'
                        : isCovering
                        ? 'bg-emerald-50/50'
                        : currentShift === 'GOFF'
                        ? 'bg-teal-50/60'
                        : currentShift === 'GHKA'
                        ? 'bg-amber-50/60'
                        : currentShift === 'HKA'
                        ? 'bg-slate-100/50'
                        : isChanged
                        ? 'bg-amber-50/50'
                        : meta.isHoliday
                        ? 'bg-rose-50/20'
                        : meta.isWeekend
                        ? 'bg-slate-50/40'
                        : 'bg-white';

                      return (
                        <td
                          key={date}
                          id={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          data-testid={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          aria-selected={isSelected ? 'true' : undefined}
                          tabIndex={!canAmend && !canEditDraft ? (isFocused ? 0 : -1) : undefined}
                          onFocus={() => {
                            if (!canAmend && !canEditDraft) {
                              setActiveCoord({ r: rIdx, c: cIdx });
                            }
                          }}
                          className={`p-0.5 lg:p-1 text-center border-r border-b border-slate-100 align-middle transition ${cellBgClass} ${
                            meta.isToday && !isSelected ? 'ring-1 ring-inset ring-indigo-300/60' : ''
                          }`}
                          onClick={(e) => {
                            if (isDraft && canEditDraft) {
                              if (e.shiftKey) {
                                if (!selectionAnchor) setSelectionAnchor({ r: activeCoord.r, c: activeCoord.c });
                                setSelectionTarget({ r: rIdx, c: cIdx });
                              } else {
                                clearSelection();
                              }
                              focusCell(rIdx, cIdx);
                            }
                          }}
                        >
                          <div className="flex flex-col items-center justify-center gap-0.5 min-h-[36px] lg:min-h-[38px] py-0.5 px-0.5">
                            {/* Interactive Shift Button */}
                            {canAmend || canEditDraft ? (
                              <button
                                type="button"
                                id={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                data-testid={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                aria-label={cellAriaLabel}
                                aria-selected={isSelected ? 'true' : undefined}
                                tabIndex={isFocused ? 0 : -1}
                                onFocus={() => setActiveCoord({ r: rIdx, c: cIdx })}
                                onClick={() => {
                                  if (isDraft && canEditDraft) {
                                    openPaletteForCell(cellData);
                                  } else if (canAmend) {
                                    if (isUncovered && onSelectDutyForReplacement) {
                                      onSelectDutyForReplacement(cellData);
                                    } else if (onSelectCellForAmend) {
                                      onSelectCellForAmend(cellData);
                                    }
                                  }
                                }}
                                disabled={isClosed}
                                title={`Assignment: ${currentShift || '—'}${isChanged ? ` (Planned: ${plannedShift || 'OFF'})` : ''}`}
                                className={`w-full py-0.5 px-1 rounded-md text-xs font-mono font-bold transition active:scale-95 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-1 disabled:cursor-not-allowed ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white shadow-xs'
                                    : isUncovered
                                    ? 'text-rose-800 bg-rose-100 hover:bg-rose-200'
                                    : isCoveredAbsence
                                    ? 'text-purple-800 bg-purple-100 hover:bg-purple-200'
                                    : isCovering
                                    ? 'text-emerald-800 bg-emerald-100 hover:bg-emerald-200'
                                    : currentShift === 'GOFF'
                                    ? 'text-teal-900 bg-teal-100 hover:bg-teal-200'
                                    : currentShift === 'GHKA'
                                    ? 'text-amber-900 bg-amber-100 hover:bg-amber-200'
                                    : currentShift === 'HKA'
                                    ? 'text-slate-700 bg-slate-200 hover:bg-slate-300'
                                    : 'text-slate-800 hover:bg-indigo-100 hover:text-indigo-800'
                                }`}
                              >
                                {currentShift || '—'}
                              </button>
                            ) : (
                              <span
                                id={`cell-text-${row.personId}-${date}-${row.dutyDomain}`}
                                data-testid={`cell-text-${row.personId}-${date}-${row.dutyDomain}`}
                                className={`font-mono text-xs font-bold ${
                                  isUncovered
                                    ? 'text-rose-700'
                                    : isCoveredAbsence
                                    ? 'text-purple-700'
                                    : isCovering
                                    ? 'text-emerald-700'
                                    : currentShift === 'GOFF'
                                    ? 'text-teal-800'
                                    : currentShift === 'GHKA'
                                    ? 'text-amber-900'
                                    : currentShift === 'HKA'
                                    ? 'text-slate-700'
                                    : 'text-slate-800'
                                }`}
                              >
                                {currentShift || '—'}
                              </span>
                            )}

                            {/* Phase 7: Distinct Badges for GOFF, GHKA, HKA, GOFF* */}
                            {currentShift === 'GOFF' && (
                              <span
                                id={`badge-goff-${row.personId}-${date}-${row.dutyDomain}`}
                                className="inline-block text-[9px] font-extrabold text-teal-800 bg-teal-100 px-1 py-0.2 rounded border border-teal-300 leading-tight"
                                title="Weekly-off replacement entitlement used"
                                data-testid={`badge-goff-${row.personId}-${date}-${row.dutyDomain}`}
                              >
                                GOFF
                              </span>
                            )}
                            {currentShift === 'GHKA' && (
                              <span
                                id={`badge-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                                className="inline-block text-[9px] font-extrabold text-amber-900 bg-amber-100 px-1 py-0.2 rounded border border-amber-300 leading-tight"
                                title="Public holiday replacement entitlement used"
                                data-testid={`badge-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                              >
                                GHKA
                              </span>
                            )}
                            {currentShift === 'HKA' && (
                              <span
                                id={`badge-hka-${row.personId}-${date}-${row.dutyDomain}`}
                                className="inline-block text-[9px] font-bold text-slate-700 bg-slate-200 px-1 py-0.2 rounded border border-slate-300 leading-tight"
                                title="Public holiday rest"
                                data-testid={`badge-hka-${row.personId}-${date}-${row.dutyDomain}`}
                              >
                                HKA
                              </span>
                            )}
                            {currentShift === 'GOFF*' && (
                              <span
                                id={`badge-goff-legacy-${row.personId}-${date}-${row.dutyDomain}`}
                                className="inline-block text-[9px] font-bold text-slate-600 bg-slate-100 px-1 py-0.2 rounded border border-slate-300 leading-tight"
                                title="Legacy GOFF* marker"
                                data-testid={`badge-goff-legacy-${row.personId}-${date}-${row.dutyDomain}`}
                              >
                                GOFF*
                              </span>
                            )}

                            {/* Uncovered Absence Badge & Action */}
                            {isUncovered && (
                              <div className="flex flex-col items-center gap-0.5 mt-0.5">
                                <span
                                  className="uncovered-badge inline-block text-[9px] font-extrabold text-rose-700 bg-rose-100 px-1 py-0.2 rounded border border-rose-300 leading-tight"
                                  data-testid={`badge-uncovered-${row.personId}-${date}-${row.dutyDomain}`}
                                >
                                  Uncovered
                                </span>
                                {canAmend && onSelectDutyForReplacement && (
                                  <button
                                    type="button"
                                    id={`btn-assign-replacement-${row.personId}-${date}-${row.dutyDomain}`}
                                    data-testid={`btn-assign-replacement-${row.personId}-${date}-${row.dutyDomain}`}
                                    onClick={() => onSelectDutyForReplacement(cellData)}
                                    className="text-[9px] font-bold text-rose-700 hover:text-rose-900 bg-white hover:bg-rose-50 px-1 py-0.5 rounded border border-rose-300 shadow-2xs transition active:scale-95 cursor-pointer focus:outline-none focus:ring-1 focus:ring-rose-500"
                                  >
                                    Assign replacement
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Covered Absence Badge */}
                            {isCoveredAbsence && (
                              <span
                                className="covered-badge inline-block text-[9px] font-bold text-purple-700 bg-purple-100 px-1 py-0.2 rounded border border-purple-200 leading-tight max-w-[90px] truncate"
                                title={`Covered by ${coveringDoctorName || 'Replacement'}`}
                                data-testid={`badge-covered-${row.personId}-${date}-${row.dutyDomain}`}
                              >
                                {coveringDoctorName
                                  ? `Covered by ${coveringDoctorName.startsWith('Dr') ? coveringDoctorName : `Dr. ${coveringDoctorName}`}`
                                  : 'Covered'}
                              </span>
                            )}

                            {/* Covering Doctor Assignment Badge */}
                            {isCovering && (
                              <span
                                className="covering-badge inline-block text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1 py-0.2 rounded border border-emerald-300 leading-tight max-w-[90px] truncate"
                                title={`Covering ${absentDoctorName || 'Doctor'}`}
                                data-testid={`badge-covering-${row.personId}-${date}-${row.dutyDomain}`}
                              >
                                {absentDoctorName
                                  ? `Covering ${absentDoctorName.startsWith('Dr') ? absentDoctorName : `Dr. ${absentDoctorName}`}`
                                  : 'Covering'}
                              </span>
                            )}

                            {/* Standard Working Cell: Record Absence Action for Admin */}
                            {canAmend && isWorking && onSelectDutyForAbsence && (
                              <button
                                type="button"
                                id={`btn-record-absence-${row.personId}-${date}-${row.dutyDomain}`}
                                data-testid={`btn-record-absence-${row.personId}-${date}-${row.dutyDomain}`}
                                onClick={() => onSelectDutyForAbsence(cellData)}
                                title={`Record absence for ${row.personNameSnapshot} on ${date}`}
                                className="text-[9px] font-semibold text-slate-500 hover:text-indigo-700 hover:underline transition mt-0.5 leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              >
                                Record absence
                              </button>
                            )}

                            {/* Phase 7: Use GOFF / Use GHKA on working duty for MO only */}
                            {canAmend && isWorking && row.dutyDomain !== 'EP' && onSelectDutyForEntitlement && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <button
                                  type="button"
                                  id={`btn-use-goff-${row.personId}-${date}-${row.dutyDomain}`}
                                  data-testid={`btn-use-goff-${row.personId}-${date}-${row.dutyDomain}`}
                                  onClick={() => onSelectDutyForEntitlement(cellData, 'GOFF')}
                                  title={`Use GOFF for ${row.personNameSnapshot} on ${date}`}
                                  className="text-[9px] font-bold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-1 py-0.2 rounded border border-teal-200 transition leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500"
                                >
                                  Use GOFF
                                </button>
                                <button
                                  type="button"
                                  id={`btn-use-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                                  data-testid={`btn-use-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                                  onClick={() => onSelectDutyForEntitlement(cellData, 'GHKA')}
                                  title={`Use GHKA for ${row.personNameSnapshot} on ${date}`}
                                  className="text-[9px] font-bold text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 px-1 py-0.2 rounded border border-amber-200 transition leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500"
                                >
                                  Use GHKA
                                </button>
                              </div>
                            )}

                            {/* Changed Badge */}
                            {isChanged && !isAbsence && !isCovering && !isEntitlementDuty && (
                              <span
                                className="changed-badge inline-block text-[9px] font-extrabold text-amber-700 bg-amber-100/80 px-1 py-0.2 rounded border border-amber-300 shadow-2xs leading-none"
                                title={`Original Planned: ${plannedShift || 'OFF'} -> Current: ${currentShift}`}
                              >
                                Changed
                                <span className="hidden lg:inline text-[8px] text-amber-800 font-mono ml-0.5 font-normal">
                                  ({plannedShift || 'OFF'}→{currentShift})
                                </span>
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Floating Bulk Action Bar (DRAFT mode when > 1 cells selected) */}
          {selectedCellKeys.size > 1 && isDraft && canEditDraft && (
            <div
              id="bulk-edit-toolbar"
              data-testid="bulk-edit-toolbar"
              className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white px-4 py-2.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150 backdrop-blur-md text-xs font-semibold"
            >
              <div className="flex items-center gap-1.5 pr-2 border-r border-slate-700">
                <span className="text-indigo-400 font-bold">▦</span>
                <span>{selectedCellKeys.size} cells selected</span>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-slate-400 text-[11px] mr-1">Apply:</span>
                {['AM', 'PM', 'OFF', 'ON1', 'ON2', 'PN', 'HKA'].map((shift) => (
                  <button
                    key={shift}
                    type="button"
                    id={`btn-bulk-apply-${shift.toLowerCase()}`}
                    data-testid={`btn-bulk-apply-${shift.toLowerCase()}`}
                    onClick={() => applyShiftToSelection(shift)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-indigo-600 font-mono font-bold transition cursor-pointer text-[11px]"
                  >
                    {shift}
                  </button>
                ))}
              </div>
              <button
                type="button"
                id="btn-clear-selection"
                onClick={clearSelection}
                className="ml-2 text-slate-400 hover:text-white text-xs underline cursor-pointer"
              >
                Clear (Esc)
              </button>
            </div>
          )}

          {/* Large Bulk Range Confirmation Modal (>10 cells threshold) */}
          {bulkConfirmTarget && (
            <div
              id="bulk-confirm-modal"
              data-testid="bulk-confirm-modal"
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
            >
              <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl border border-slate-200">
                <div className="flex items-center gap-2.5 text-amber-600">
                  <span className="text-2xl">⚠️</span>
                  <h4 className="font-bold text-slate-900 text-base">Bulk Assignment Confirmation</h4>
                </div>
                <p className="text-xs text-slate-600">
                  Are you sure you want to apply shift{' '}
                  <strong className="text-slate-900 font-mono">{bulkConfirmTarget.shiftCode || 'OFF'}</strong> to{' '}
                  <strong className="text-slate-900">{bulkConfirmTarget.cells.length} cells</strong>?
                </p>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    id="btn-cancel-bulk-apply"
                    data-testid="btn-cancel-bulk-apply"
                    onClick={() => setBulkConfirmTarget(null)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id="btn-confirm-bulk-apply"
                    data-testid="btn-confirm-bulk-apply"
                    onClick={handleConfirmBulkApply}
                    className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                  >
                    Confirm Apply
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Shift Palette */}
      <QuickShiftPalette
        key={isPaletteOpen ? `${paletteTargetCell?.personId}-${paletteTargetCell?.date}-${paletteFilter}` : 'palette-closed'}
        isOpen={isPaletteOpen}
        targetCell={paletteTargetCell}
        initialFilter={paletteFilter}
        positionStyle={palettePosition}
        onSelectShift={(shift) => applyShiftToSelection(shift)}
        onClose={() => setIsPaletteOpen(false)}
      />

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}
