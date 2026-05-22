import { useState, useMemo } from 'react';
import { normalizeForComparison, toIsoDate } from '../utils/normalise';

export default function RosterPage({
  selectedName,
  names = [],
  masterRoster = [],
  onUploadMasterRoster,
  onRefresh,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedGrid, setEditedGrid] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const todayStr = useMemo(() => toIsoDate(new Date()), []);

  // 1. Set the initial roster month to the current month (YYYY-MM)
  const [rosterMonth, setRosterMonth] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  });

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
      // Normalize date: Google Sheets may return full ISO strings like "2026-05-01T16:00:00.000Z"
      // toIsoDate() converts any format to "YYYY-MM-DD" so it matches daysInMonthList keys
      const rawDate = row.Date || row.date;
      const dateStr = toIsoDate(rawDate);
      const nameRaw = row.Name || row.name;
      const shiftVal = row.Shift || row.shift;

      if (!dateStr || !nameRaw || !shiftVal) return;
      const name = nameRaw.trim();
      const shiftRaw = shiftVal.trim().toUpperCase();
      
      let shiftCol = '';
      if (shiftRaw === 'AM' || shiftRaw.includes('AM')) shiftCol = 'AM';
      else if (shiftRaw === 'PM' || shiftRaw.includes('PM')) shiftCol = 'PM';
      else if (shiftRaw === 'NIGHT' || shiftRaw === 'N' || shiftRaw.includes('NIGHT')) shiftCol = 'NIGHT';
      else return;
      
      if (!grid[dateStr]) grid[dateStr] = { AM: [], PM: [], NIGHT: [] };
      if (!grid[dateStr][shiftCol].includes(name)) {
        grid[dateStr][shiftCol].push(name);
      }
    });
    return grid;
  }, [masterRoster]);

  const isMatch = (name) => {
    if (!searchQuery) return false;
    return normalizeForComparison(name).includes(normalizeForComparison(searchQuery));
  };

  // --- SPREADSHEET ENGINE ---

  const toggleEditMode = () => {
    if (isEditMode) {
      if (confirm('Discard unsaved changes?')) {
        setIsEditMode(false);
        setEditedGrid({});
      }
    } else {
      const cloned = {};
      daysInMonthList.forEach(({ dateStr }) => {
        cloned[dateStr] = {
          AM: rosterGrid[dateStr]?.AM.join(', ') || '',
          PM: rosterGrid[dateStr]?.PM.join(', ') || '',
          NIGHT: rosterGrid[dateStr]?.NIGHT.join(', ') || ''
        };
      });
      setEditedGrid(cloned);
      setIsEditMode(true);
    }
  };

  const handleCellChange = (dateStr, shiftCol, value) => {
    setEditedGrid(prev => ({
      ...prev,
      [dateStr]: {
        ...prev[dateStr],
        [shiftCol]: value
      }
    }));
  };

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
      if (key === 'ArrowRight' && shiftIndex < 2) nextShiftIndex += 1;

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
          if (targetShiftIndex > 2) return;
          
          let cleanVal = cellVal.replace(/___NEWLINE___/g, '\n');
          // Remove surrounding quotes if Excel added them
          if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
            cleanVal = cleanVal.slice(1, -1);
          }
          // Excel escapes internal quotes as ""
          cleanVal = cleanVal.replace(/""/g, '"');
          
          const shiftCol = targetShiftIndex === 0 ? 'AM' : targetShiftIndex === 1 ? 'PM' : 'NIGHT';
          nextGrid[dateStr] = {
            ...nextGrid[dateStr],
            [shiftCol]: cleanVal.trim()
          };
        });
      });
      return nextGrid;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const flatRows = [];
      Object.keys(editedGrid).forEach((dateStr) => {
        ['AM', 'PM', 'NIGHT'].forEach((shift) => {
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
         setIsSaving(false);
         return;
      }
      
      await onUploadMasterRoster(flatRows);
      setIsEditMode(false);
      setIsSaving(false);
      // Show refreshing state while App.jsx reloads from Sheets
      setIsRefreshing(true);
      // App.jsx already has a 1.5s delay built in; wait a bit extra to be safe
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setIsRefreshing(false);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
      setIsSaving(false);
      setIsRefreshing(false);
    }
  };

  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';

  return (
    <div className="mx-auto max-w-5xl px-2 sm:px-6 py-6 sm:py-8 md:px-8 animate-fadeIn">
      {/* 🧭 Header Details */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold flex items-center gap-2">
              <span>📅</span>
              <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">Current Roster</span>
            </h1>
            {isAdmin && (
              <button
                onClick={toggleEditMode}
                disabled={isSaving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                  isEditMode 
                    ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100' 
                    : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                }`}
              >
                {isEditMode ? '✕ Cancel Edit' : '✏️ Edit Roster'}
              </button>
            )}
              {isEditMode && (
              <button
                onClick={handleSave}
                disabled={isSaving || isRefreshing}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-70"
              >
                {isSaving ? '💾 Saving...' : isRefreshing ? '🔄 Refreshing...' : '💾 Save Changes'}
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-2">
            Displaying the official finalized schedule for <span className="font-bold text-slate-700">{monthLabel}</span>.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={handlePrevMonth}
              disabled={isEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ‹ Prev
            </button>
            <button
              onClick={handleCurrentMonth}
              disabled={isEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Current Month
            </button>
            <button
              onClick={handleNextMonth}
              disabled={isEditMode}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next ›
            </button>
          </div>
        </div>

        {/* 🔍 Premium Interactive Name Highlighter */}
        {!isEditMode && (
          <div className="relative max-w-xs w-full">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
              🔍
            </span>
            <input
              type="text"
              className="w-full pl-10 pr-4 py-2 text-xs font-semibold rounded-2xl border border-slate-200 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-150 focus:border-indigo-400 shadow-sm transition-all"
              placeholder="Highlight doctor's name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {isEditMode && (
         <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 shadow-sm">
           <strong className="font-bold">Excel Editing Mode Active:</strong> You can type directly into cells. Multiple names must be separated by commas or <strong>Alt+Enter</strong>. You can use <strong>Arrow Keys</strong>, <strong>Enter</strong>, or <strong>Tab</strong> to navigate. You can also paste directly from an Excel spreadsheet range.
         </div>
      )}

      {/* 📊 Finalized Monthly Table Card */}
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
              </tr>
              {/* Row 2 Header */}
              <tr className="bg-slate-700 text-white border border-slate-700 select-none">
                <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/3">
                  AM
                </th>
                <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/3">
                  PM
                </th>
                <th className="border border-slate-300 px-1 sm:px-4 py-1 sm:py-2 font-bold uppercase tracking-wider text-[10px] sm:text-xs w-1/3">
                  NIGHT
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {daysInMonthList.map(({ dayNum, dayName, dateStr }, dayIndex) => {
                const dayAssignments = rosterGrid[dateStr] || { AM: [], PM: [], NIGHT: [] };
                const isWeekend = dayName === 'SAT' || dayName === 'SUN';
                const isToday = dateStr === todayStr;

                return (
                  <tr
                    key={dateStr}
                    className={`transition-colors border border-slate-300 ${
                      isToday
                        ? 'bg-indigo-50/80 hover:bg-indigo-100/60 ring-1 ring-inset ring-indigo-300'
                        : isWeekend 
                        ? 'bg-slate-100/80 hover:bg-slate-200/50' 
                        : 'bg-white hover:bg-slate-50/50'
                    }`}
                  >
                    {/* Date */}
                    <td className={`border border-slate-300 px-0.5 sm:px-4 py-1.5 sm:py-3 font-bold align-middle select-none text-[10px] sm:text-sm ${
                      isToday ? 'text-indigo-900 bg-indigo-100/50' : 'text-slate-800'
                    }`}>
                      {dayNum}
                      {isToday && <span className="block text-[8px] sm:text-[9px] text-indigo-600 mt-0.5">TODAY</span>}
                    </td>

                    {/* Day Name */}
                    <td className={`border border-slate-300 px-0.5 sm:px-4 py-1.5 sm:py-3 font-bold align-middle select-none text-[10px] sm:text-sm ${
                      isToday ? 'text-indigo-900 bg-indigo-100/50' : isWeekend ? 'text-indigo-600' : 'text-slate-600'
                    }`}>
                      {dayName}
                    </td>

                    {/* Shift Cells */}
                    {['AM', 'PM', 'NIGHT'].map((shiftCol, shiftIndex) => (
                      <td key={shiftCol} className="border border-slate-300 p-0 align-middle h-14">
                        {isEditMode ? (
                          <textarea
                            id={`cell-${dayIndex}-${shiftIndex}`}
                            value={editedGrid[dateStr]?.[shiftCol] ?? ''}
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
                              dayAssignments[shiftCol].map((name) => (
                                <span
                                  key={name}
                                  className={`block tracking-wide uppercase text-[9px] sm:text-xs font-bold transition-all px-1 sm:px-1.5 py-0.5 rounded-lg ${
                                    isMatch(name)
                                      ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300 animate-pulse scale-105 shadow-sm'
                                      : 'text-slate-700'
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
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {daysInMonthList.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <span className="text-4xl block mb-2">📅</span>
          <p className="font-semibold text-sm">No roster records detected for the selected month.</p>
        </div>
      )}
    </div>
  );
}
