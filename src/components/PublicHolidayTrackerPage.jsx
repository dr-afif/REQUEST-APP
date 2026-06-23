import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  getPublicHolidayCredits,
  getGhkaUsage,
  matchGhkaToCredits,
  buildDoctorSummary,
  buildWarnings,
  buildTrackerMatrix
} from '../utils/publicHolidayTracker';
import { generateGhkaMemoDocx } from '../utils/ghkaMemoExport';
import { normalizeForComparison } from '../utils/normalise';
import { mapName, formatNameForMemo, resolveTeamMemberProfile } from '../utils/adapters';
import { APP_ICONS } from '../constants/icons';

export default function PublicHolidayTrackerPage({
  selectedName,
  names = [],
  masterRoster = [],
  rosterMonth = '',
  settings = {},
  onUpdateSetting = () => {},
  teamMembers = []
}) {
  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';

  const [activeMonth, setActiveMonth] = useState(rosterMonth);
  const [sortConfig, setSortConfig] = useState({ key: 'outstanding', direction: 'desc' });
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const [openingBalances, setOpeningBalances] = useState(() => {
    try {
      if (settings.phTrackerOpeningBalances) {
        return typeof settings.phTrackerOpeningBalances === 'string'
          ? JSON.parse(settings.phTrackerOpeningBalances)
          : settings.phTrackerOpeningBalances;
      }
      const saved = localStorage.getItem('phTrackerOpeningBalances');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [memoStatuses, setMemoStatuses] = useState(() => {
    try {
      if (settings.phTrackerMemos) {
        return typeof settings.phTrackerMemos === 'string'
          ? JSON.parse(settings.phTrackerMemos)
          : settings.phTrackerMemos;
      }
      return {};
    } catch (e) {
      return {};
    }
  });

  const [isMemoEditMode, setIsMemoEditMode] = useState(false);

  // Export Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState('');
  const [exportSelectedRows, setExportSelectedRows] = useState({});
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (settings.phTrackerOpeningBalances) {
      try {
        const parsed = typeof settings.phTrackerOpeningBalances === 'string'
          ? JSON.parse(settings.phTrackerOpeningBalances)
          : settings.phTrackerOpeningBalances;
        setOpeningBalances(parsed);
      } catch (e) {
        console.error('Failed to parse opening balances from settings');
      }
    }
    
    if (settings.phTrackerMemos) {
      try {
        const parsed = typeof settings.phTrackerMemos === 'string'
          ? JSON.parse(settings.phTrackerMemos)
          : settings.phTrackerMemos;
        setMemoStatuses(parsed);
      } catch (e) {
        console.error('Failed to parse memo statuses from settings');
      }
    }
  }, [settings.phTrackerOpeningBalances, settings.phTrackerMemos]);

  const updateOpeningBalance = (docName, newBalance, note = '') => {
    const docKey = normalizeForComparison(mapName(docName));
    const newBalances = {
      ...openingBalances,
      [docKey]: {
        doctorName: docName,
        openingBalance: parseInt(newBalance) || 0,
        note: note,
        updatedAt: new Date().toISOString()
      }
    };
    if (newBalances[docKey].openingBalance === 0 && !note) {
      delete newBalances[docKey]; // cleanup empties
    }
    setOpeningBalances(newBalances);
    localStorage.setItem('phTrackerOpeningBalances', JSON.stringify(newBalances));
    
    // Persist online
    onUpdateSetting('phTrackerOpeningBalances', JSON.stringify(newBalances));
  };

  const toggleMemoStatus = (docKey, holidayDate) => {
    if (!isMemoEditMode) return;
    const memoKey = `${docKey}_${holidayDate}`;
    const currentStatus = !!memoStatuses[memoKey];
    
    const newStatuses = {
      ...memoStatuses,
      [memoKey]: !currentStatus
    };
    
    if (!newStatuses[memoKey]) {
      delete newStatuses[memoKey];
    }
    
    setMemoStatuses(newStatuses);
  };

  useEffect(() => {
    if (rosterMonth) {
      setActiveMonth(rosterMonth);
    }
  }, [rosterMonth]);

  // Extract valid doctors
  const validDoctors = useMemo(() => {
    return names.filter(n => typeof n === 'string' ? n : n?.active !== false).map(n => typeof n === 'string' ? n : n.name);
  }, [names]);

  // 1. Calculations (Runs on full data for accurate cross-month matching)
  const { credits, usages, matched, unmatched, summaries, warnings, matrixRows } = useMemo(() => {
    const phCredits = getPublicHolidayCredits(masterRoster, validDoctors);
    const ghkaUsages = getGhkaUsage(masterRoster, validDoctors);
    const { matchedRecords, unmatchedUsages } = matchGhkaToCredits(phCredits, ghkaUsages, openingBalances, validDoctors);
    const docSummaries = buildDoctorSummary(matchedRecords, unmatchedUsages, validDoctors, openingBalances);
    const docWarnings = buildWarnings(docSummaries);
    
    // Matrix is filtered by active month
    const mRows = buildTrackerMatrix(matchedRecords, validDoctors, activeMonth, masterRoster);

    return {
      credits: phCredits,
      usages: ghkaUsages,
      matched: matchedRecords,
      unmatched: unmatchedUsages,
      summaries: docSummaries,
      warnings: docWarnings,
      matrixRows: mRows
    };
  }, [masterRoster, validDoctors, activeMonth, openingBalances]);

  // Calculate top-level totals
  const totals = useMemo(() => {
    let totalOpeningBalance = 0;
    let totalWorked = 0;
    let totalUsed = 0;
    let totalOutstanding = 0;
    let totalExcess = 0;
    let doctorsWithOutstanding = 0;

    summaries.forEach(s => {
      totalOpeningBalance += s.openingBalance;
      totalWorked += s.phWorked;
      totalUsed += s.ghkaUsed;
      totalOutstanding += s.outstanding;
      totalExcess += s.excessGhkaUsed;
      if (s.outstanding > 0) doctorsWithOutstanding++;
    });

    return { totalOpeningBalance, totalWorked, totalUsed, totalOutstanding, totalExcess, doctorsWithOutstanding };
  }, [summaries]);

  // Sortable summary
  const sortedSummaries = useMemo(() => {
    const list = [...summaries];
    list.sort((a, b) => {
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];
      
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [summaries, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const isGuest = selectedName?.trim().toLowerCase() === 'guest';
  if (!selectedName || isGuest) {
    return (
      <div className="mx-auto px-4 py-8 md:px-8 max-w-6xl animate-fadeIn text-center">
        <h2 className="text-2xl font-bold text-slate-800">Access Denied</h2>
        <p className="mt-2 text-xs text-slate-500">
          This page is not available for guests. Please select a user profile.
        </p>
      </div>
    );
  }

  const year = activeMonth ? activeMonth.split('-')[0] : new Date().getFullYear();

  // User Mode Data
  const myKey = normalizeForComparison(mapName(selectedName));
  const mySummary = useMemo(() => summaries.find(s => s.doctorKey === myKey) || {
    openingBalance: 0, phWorked: 0, ghkaUsed: 0, outstanding: 0, excessGhkaUsed: 0, oldOutstanding: 0
  }, [summaries, myKey]);
  const myCredits = useMemo(() => matched.filter(m => m.doctorKey === myKey), [matched, myKey]);
  const displayCredits = useMemo(() => myCredits.filter(c => c.source !== 'opening_balance'), [myCredits]);
  const myUsages = useMemo(() => usages.filter(u => u.doctorKey === myKey), [usages, myKey]);
  const myUnmatched = useMemo(() => unmatched.filter(u => u.doctorKey === myKey), [unmatched, myKey]);
  const myWarnings = useMemo(() => warnings.filter(w => normalizeForComparison(mapName(w.doctorName)) === myKey), [warnings, myKey]);

  // Export Logic
  const exportableRecords = useMemo(() => {
    if (!myCredits) return [];
    return myCredits.filter(c => c.status === 'USED' && c.matchedGhkaDate);
  }, [myCredits]);

  const handleOpenExportModal = () => {
    let initialMonth = '';
    if (activeMonth && exportableRecords.some(r => r.matchedGhkaDate.startsWith(activeMonth))) {
      initialMonth = activeMonth;
    } else if (exportableRecords.length > 0) {
      const sorted = [...exportableRecords].sort((a, b) => b.matchedGhkaDate.localeCompare(a.matchedGhkaDate));
      initialMonth = sorted[0].matchedGhkaDate.substring(0, 7);
    } else {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      initialMonth = `${d.getFullYear()}-${mm}`;
    }
    
    setExportMonth(initialMonth);
    setIsExportModalOpen(true);
  };

  useEffect(() => {
    if (!isExportModalOpen) return;
    
    const autoSelected = {};
    exportableRecords.forEach(r => {
      if (r.matchedGhkaDate && r.matchedGhkaDate.startsWith(exportMonth)) {
        autoSelected[`${r.doctorKey}_${r.holidayDate}`] = true;
      }
    });
    setExportSelectedRows(autoSelected);
  }, [exportMonth, isExportModalOpen, exportableRecords]);

  const handleGenerateExport = async () => {
    const selectedRecords = exportableRecords.filter(r => exportSelectedRows[`${r.doctorKey}_${r.holidayDate}`]);
    if (selectedRecords.length === 0) return;

    // Find the profile for the selected applicant
    const selectedProfile = resolveTeamMemberProfile(selectedName, teamMembers);
    const formattedMemoName = formatNameForMemo(selectedProfile.fullName || selectedProfile.name);

    const payload = {
      memoMonth: exportMonth,
      applicantName: formattedMemoName,
      applicantStaffId: selectedProfile.staffId || "",
      applicantPhone: selectedProfile.phone || "",
      applicantEmail: selectedProfile.email || "",
      memoDate: new Date().toISOString(),
      rows: selectedRecords.map(r => {
        const isCarryForward = r.source === 'opening_balance';
        return {
          phDate: isCarryForward ? "" : r.holidayDate,
          phName: isCarryForward ? "Opening Balance" : r.holidayName,
          ghkaDate: r.matchedGhkaDate,
          ghkaDay: new Date(r.matchedGhkaDate).toLocaleDateString('en-US', { weekday: 'long' })
        };
      })
    };

    setIsExporting(true);
    try {
      await generateGhkaMemoDocx(payload);
      setIsExportModalOpen(false);
    } catch (error) {
      alert(`Failed to generate DOCX memo: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const renderExportRow = (r) => {
    const key = `${r.doctorKey}_${r.holidayDate}`;
    const isChecked = !!exportSelectedRows[key];
    const isCarryForward = r.source === 'opening_balance';
    const phDateText = isCarryForward ? 'Carry-forward' : new Date(r.holidayDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const phNameText = isCarryForward ? 'Opening Balance GHKA' : r.holidayName;
    const ghkaDateObj = new Date(r.matchedGhkaDate);
    const ghkaDateText = ghkaDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const ghkaDayText = ghkaDateObj.toLocaleDateString('en-US', { weekday: 'short' });
    const memoKey = `${r.doctorKey}_${r.holidayDate}`;
    const isMemoSubmitted = !!memoStatuses[memoKey];

    return (
      <label key={key} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${isChecked ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
        <input 
          type="checkbox" 
          className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          checked={isChecked}
          onChange={(e) => setExportSelectedRows(prev => ({...prev, [key]: e.target.checked}))}
        />
        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-slate-800 truncate">{ghkaDateText} <span className="text-slate-500 font-medium">({ghkaDayText})</span></p>
            <p className="text-[10px] text-slate-500 truncate">Replaces: {phNameText} ({phDateText})</p>
          </div>
          <div>
            {isMemoSubmitted ? (
               <span className="inline-block px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">Memo submitted</span>
            ) : (
               <span className="inline-block px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-rose-100 text-rose-800 border border-rose-200">Memo not marked</span>
            )}
          </div>
        </div>
      </label>
    );
  };

  return (
    <div className="mx-auto px-4 py-8 md:px-8 max-w-6xl animate-fadeIn">
      {/* Page Header */}
      <div className="mb-4">
        <h1 className="text-3xl font-extrabold flex items-center gap-2">
          <APP_ICONS.phTracker className="w-8 h-8 text-indigo-700" />
          <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">
            {isAdmin ? 'Public Holiday Tracker' : 'My Public Holiday Tracker'}
          </span>
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          {isAdmin 
            ? 'Read-only tracker for Public Holiday duties and GHKA replacements.' 
            : 'This tracker is read-only and based on the uploaded master roster.'}
        </p>
      </div>

      {!isAdmin && (
        <div className="flex flex-col gap-8">
          {/* User Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Opening Balance</p>
              <p className="text-2xl font-black text-indigo-400 mt-2">{mySummary.openingBalance}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">PH Worked</p>
              <p className="text-2xl font-black text-indigo-600 mt-2">{mySummary.phWorked}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">GHKA Used</p>
              <p className="text-2xl font-black text-emerald-600 mt-2">{mySummary.ghkaUsed}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">GHKA AVAILABLE</p>
              <p className="text-2xl font-black text-amber-500 mt-2">{mySummary.outstanding}</p>
            </div>
            {mySummary.excessGhkaUsed > 0 && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">Excess GHKA</p>
                <p className="text-2xl font-black text-rose-600 mt-2">{mySummary.excessGhkaUsed}</p>
              </div>
            )}
          </div>

          {/* User Warnings */}
          {myWarnings.length > 0 && (
            <div className="rounded-3xl border border-rose-100 bg-rose-50/50 p-6 shadow-sm">
              <h3 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-2 mb-4">
                <APP_ICONS.warning className="w-4 h-4" /> Personal Warnings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {myWarnings.map((w, idx) => (
                  <div key={idx} className="bg-white rounded-xl border border-rose-100 p-3 shadow-sm flex items-start gap-3">
                    <div className={`mt-0.5 rounded-full p-1 ${w.severity === 'high' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-700">{w.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {displayCredits.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-slate-400 p-8 text-center gap-3 bg-white rounded-3xl border border-slate-100 shadow-sm">
              <APP_ICONS.info className="w-8 h-8 text-slate-300" />
              <p className="text-sm font-bold">No public holiday credit records found for your roster yet.</p>
            </div>
          ) : (
            <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <APP_ICONS.calendar className="w-4 h-4 text-indigo-500" /> Public Holiday Credits & Replacements
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 sm:hidden">
                    <span className="text-[10px] text-slate-500">Swipe sideways to view replacement details.</span>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-1">← swipe →</span>
                  </div>
                  <button 
                    onClick={handleOpenExportModal} 
                    className="text-[11px] font-bold px-3 py-1.5 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 transition flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Export Monthly Memo
                  </button>
                </div>
              </div>
              <div className="p-0 overflow-x-auto no-scrollbar">
                <table className="w-full text-left text-xs whitespace-nowrap min-w-[600px]">
                  <thead className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                    <tr className="border-b border-slate-100">
                      <th colSpan="2" className="py-2 px-4 font-bold text-center border-r border-slate-100 bg-indigo-50/30 text-indigo-800 uppercase tracking-wider">Public Holiday</th>
                      <th colSpan="3" className="py-2 px-4 font-bold text-center bg-emerald-50/30 text-emerald-800 uppercase tracking-wider">Replacement Day</th>
                    </tr>
                    <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                      <th className="py-2 px-4 font-bold border-r border-slate-100 w-[15%]">Date</th>
                      <th className="py-2 px-4 font-bold border-r border-slate-100 w-[30%]">PH Name</th>
                      <th className="py-2 px-4 font-bold border-r border-slate-100 w-[15%]">Date</th>
                      <th className="py-2 px-4 font-bold border-r border-slate-100 w-[15%]">Day</th>
                      <th className="py-2 px-4 font-bold w-[25%]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {displayCredits.map((c, idx) => {
                      const isUsed = c.status === 'USED';
                      const isCarryForward = c.source === 'opening_balance';
                      const memoKey = `${c.doctorKey}_${c.holidayDate}`;
                      const isMemoSubmitted = !!memoStatuses[memoKey];

                      const phDateText = isCarryForward ? '—' : (c.holidayDate ? new Date(c.holidayDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
                      const phNameText = isCarryForward ? 'Carry-forward GHKA credit' : c.holidayName;

                      let repDateText = '-';
                      let repDayText = '-';
                      
                      let badgeBg = '';
                      let statusText = '-';

                      if (isUsed && c.matchedGhkaDate) {
                        const d = new Date(c.matchedGhkaDate);
                        repDateText = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        repDayText = d.toLocaleDateString('en-US', { weekday: 'long' });
                        
                        if (isMemoSubmitted) {
                          badgeBg = 'bg-emerald-100 text-emerald-800';
                          statusText = 'Used (Memo submitted)';
                        } else {
                          badgeBg = 'bg-rose-100 text-rose-800';
                          statusText = 'Used (Memo not marked)';
                        }
                      }

                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition">
                          <td className="py-3 px-4 font-medium text-slate-600 border-r border-slate-100">{phDateText}</td>
                          <td className="py-3 px-4 font-bold text-slate-700 border-r border-slate-100 truncate max-w-[200px]" title={phNameText}>{phNameText}</td>
                          <td className="py-3 px-4 font-medium text-slate-600 border-r border-slate-100">{repDateText}</td>
                          <td className="py-3 px-4 font-medium text-slate-600 border-r border-slate-100">{repDayText}</td>
                          <td className="py-3 px-4">
                            {statusText === '-' ? (
                              <span className="text-slate-400 font-bold px-2 py-1">-</span>
                            ) : (
                              <span className={`inline-block px-2 py-1 rounded-md text-[10px] font-bold truncate max-w-[150px] ${badgeBg}`} title={statusText}>
                                {statusText}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Export Modal */}
      {!isAdmin && isExportModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 sm:p-6 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[85dvh] sm:max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-slideUp sm:animate-fadeIn">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Export Monthly GHKA Memo
                </h2>
                <p className="text-xs text-slate-500 mt-1">Select records to include in your monthly memo.</p>
              </div>
              <button onClick={() => setIsExportModalOpen(false)} className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full p-2 transition">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-white">
              {exportableRecords.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <APP_ICONS.info className="w-10 h-10 text-slate-300" />
                  <p className="text-sm font-bold text-slate-500">No used GHKA replacement records are available for memo export yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Applicant Details */}
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                    <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-3">Applicant Details</h3>
                    
                    {(() => {
                      const selectedProfile = resolveTeamMemberProfile(selectedName, teamMembers);
                      const formattedMemoName = formatNameForMemo(selectedProfile.fullName || selectedProfile.name);
                      
                      const missingFields = !selectedProfile.staffId || !selectedProfile.phone || !selectedProfile.email;

                      return (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                            <div>
                              <div className="text-[10px] text-indigo-400 font-bold uppercase">Name</div>
                              <div className="text-sm font-semibold text-indigo-900">{formattedMemoName}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-indigo-400 font-bold uppercase">Staff ID</div>
                              <div className="text-sm font-semibold text-indigo-900">{selectedProfile.staffId || '-'}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-indigo-400 font-bold uppercase">Phone</div>
                              <div className="text-sm font-semibold text-indigo-900">{selectedProfile.phone || '-'}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-indigo-400 font-bold uppercase">Email</div>
                              <div className="text-sm font-semibold text-indigo-900 truncate" title={selectedProfile.email}>{selectedProfile.email || '-'}</div>
                            </div>
                          </div>
                          {missingFields && (
                            <div className="text-[11px] text-amber-700 bg-amber-100/50 p-2 rounded-lg border border-amber-200/50 mt-2">
                              <strong>Note:</strong> Some applicant details are missing. The memo can still be generated, but the missing fields will be blank. Update your profile in the Admin Panel to auto-fill them.
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Select Month</label>
                    <input 
                      type="month" 
                      value={exportMonth}
                      onChange={(e) => setExportMonth(e.target.value)}
                      className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition font-medium text-slate-700 w-full sm:w-auto"
                    />
                  </div>
                  
                  {/* Current Month Records */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Records for {exportMonth || 'Selected Month'}</h3>
                    {exportableRecords.filter(r => r.matchedGhkaDate && r.matchedGhkaDate.startsWith(exportMonth)).length === 0 ? (
                      <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 text-amber-800 text-xs font-medium">
                        No GHKA replacement records found for this month. You may select another month or manually include other used records.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {exportableRecords.filter(r => r.matchedGhkaDate && r.matchedGhkaDate.startsWith(exportMonth)).map(renderExportRow)}
                      </div>
                    )}
                  </div>

                  {/* Other Records */}
                  {exportableRecords.filter(r => !(r.matchedGhkaDate && r.matchedGhkaDate.startsWith(exportMonth))).length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Other Used GHKA Records</h3>
                      <div className="space-y-2 opacity-80 hover:opacity-100 transition-opacity">
                        {exportableRecords.filter(r => !(r.matchedGhkaDate && r.matchedGhkaDate.startsWith(exportMonth))).map(renderExportRow)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 flex-shrink-0">
              <button 
                onClick={() => setIsExportModalOpen(false)}
                className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button 
                onClick={handleGenerateExport}
                disabled={exportableRecords.length === 0 || Object.values(exportSelectedRows).filter(Boolean).length === 0 || isExporting}
                className="px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-indigo-600 shadow-sm hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isExporting ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Generate Memo DOCX
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isAdmin && (
        <>
          {/* Temporary Debug Panel */}
          {process.env.NODE_ENV === 'development' && totals.totalWorked === 0 && masterRoster.length > 0 && (
            <div className="mb-8 rounded-3xl border border-indigo-100 bg-indigo-50/50 p-6 shadow-sm overflow-auto text-xs">
          <h3 className="font-bold text-indigo-800 mb-2">DEBUG INFO: Zero Credits Detected</h3>
          <ul className="list-disc pl-5 space-y-1 text-slate-700 font-mono">
            <li>masterRoster length: {masterRoster.length}</li>
            <li>validDoctors length: {validDoctors.length}</li>
            <li>Matrix holidays mapped for {activeMonth}: {matrixRows.length}</li>
            <li>Credits length: {credits.length}</li>
            <li>Usages length: {usages.length}</li>
            <li>Sample original row: {JSON.stringify(masterRoster[0])}</li>
          </ul>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Opening Balance</p>
          <p className="text-2xl font-black text-indigo-400 mt-2">{totals.totalOpeningBalance}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">PH Worked This Year</p>
          <p className="text-2xl font-black text-indigo-600 mt-2">{totals.totalWorked}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">GHKA Used This Year</p>
          <p className="text-2xl font-black text-emerald-600 mt-2">{totals.totalUsed}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Closing Outstanding</p>
          <p className="text-2xl font-black text-amber-500 mt-2">{totals.totalOutstanding}</p>
        </div>
      </div>

      {/* Warnings Section */}
      {warnings.length > 0 && (
        <div className="mb-8 rounded-3xl border border-rose-100 bg-rose-50/50 p-6 shadow-sm">
          <h3 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-2 mb-4">
            <APP_ICONS.warning className="w-4 h-4" /> Tracker Warnings
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {warnings.map((w, idx) => (
              <div key={idx} className="bg-white rounded-xl border border-rose-100 p-3 shadow-sm flex items-start gap-3">
                <div className={`mt-0.5 rounded-full p-1 ${w.severity === 'high' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800">{w.doctorName}</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">{w.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Opening Balances Editor Toggle */}
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setIsEditorOpen(!isEditorOpen)}
          className="text-xs font-bold px-4 py-2 bg-slate-800 text-white rounded-xl shadow-sm hover:bg-slate-700 transition"
        >
          {isEditorOpen ? 'Close Opening Balances Editor' : 'Edit Opening Balances'}
        </button>
      </div>

      {isEditorOpen && (
        <div className="mb-8 rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden animate-fadeIn">
          <div className="p-5 border-b border-slate-100 bg-slate-50">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <APP_ICONS.edit className="w-4 h-4" /> Opening Balances Editor
            </h3>
            <p className="text-[10px] text-slate-500 mt-1">Set carry-forward GHKA credits from previous years. Changes save automatically.</p>
          </div>
          <div className="p-0 overflow-x-auto max-h-[400px] overflow-y-auto no-scrollbar border-b border-slate-100">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-white shadow-sm">
                <tr className="text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="py-3 px-5 font-bold">Doctor Name</th>
                  <th className="py-3 px-5 font-bold">Opening Balance</th>
                  <th className="py-3 px-5 font-bold w-1/2">Note / Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {validDoctors.map(doc => {
                  const docKey = normalizeForComparison(mapName(doc));
                  const data = openingBalances[docKey] || { openingBalance: 0, note: '' };
                  return (
                    <tr key={docKey} className="hover:bg-slate-50 transition">
                      <td className="py-2.5 px-5 font-bold text-slate-700">{doc}</td>
                      <td className="py-2.5 px-5">
                        <input
                          type="number"
                          min="0"
                          value={data.openingBalance}
                          onChange={(e) => updateOpeningBalance(doc, e.target.value, data.note)}
                          className="w-20 px-2 py-1 text-center bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-bold"
                        />
                      </td>
                      <td className="py-2.5 px-5">
                        <input
                          type="text"
                          placeholder="e.g. Carry forward from 2025"
                          value={data.note}
                          onChange={(e) => updateOpeningBalance(doc, data.openingBalance, e.target.value)}
                          className="w-full px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition placeholder:text-slate-300"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vertical Layout: Summary Table and Tracker Matrix */}
      <div className="flex flex-col gap-8">
        
        {/* Top: Doctor Summary Table */}
        <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <APP_ICONS.team className="w-4 h-4" /> Doctor Summary
            </h3>
          </div>
          <div className="overflow-x-auto p-0 no-scrollbar border-b border-slate-100">
            <table className="w-full text-left text-[10px] table-fixed">
              <thead className="bg-white shadow-sm">
                <tr className="text-slate-400 uppercase tracking-wider">
                  <th className="py-2 px-3 font-bold w-24 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] z-10 border-b border-slate-100">Metric</th>
                  {validDoctors.map(doc => (
                    <th key={doc} className="py-2 px-1 font-bold text-center border-b border-slate-100 truncate" title={doc}>
                      {doc.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                <tr className="hover:bg-slate-50 transition">
                  <td className="py-1.5 px-3 font-bold text-slate-500 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Opening</td>
                  {validDoctors.map(doc => {
                     const s = sortedSummaries.find(x => x.name === doc) || { openingBalance: 0 };
                     return <td key={doc} className="py-1.5 px-1 text-center font-semibold text-slate-500">{s.openingBalance}</td>;
                  })}
                </tr>
                <tr className="hover:bg-slate-50 transition">
                  <td className="py-1.5 px-3 font-bold text-slate-500 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">PH Worked</td>
                  {validDoctors.map(doc => {
                     const s = sortedSummaries.find(x => x.name === doc) || { phWorked: 0 };
                     return <td key={doc} className="py-1.5 px-1 text-center font-semibold text-indigo-600">{s.phWorked}</td>;
                  })}
                </tr>
                <tr className="hover:bg-slate-50 transition">
                  <td className="py-1.5 px-3 font-bold text-slate-500 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">GHKA Used</td>
                  {validDoctors.map(doc => {
                     const s = sortedSummaries.find(x => x.name === doc) || { ghkaUsed: 0 };
                     return <td key={doc} className="py-1.5 px-1 text-center font-semibold text-emerald-600">{s.ghkaUsed}</td>;
                  })}
                </tr>
                <tr className="hover:bg-slate-50 transition">
                  <td className="py-1.5 px-3 font-bold text-slate-500 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Outstanding</td>
                  {validDoctors.map(doc => {
                     const s = sortedSummaries.find(x => x.name === doc) || { outstanding: 0 };
                     return (
                       <td key={doc} className="py-1.5 px-1 text-center">
                         <span className={`inline-block px-1.5 py-0.5 rounded-md font-bold ${s.outstanding > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>
                           {s.outstanding}
                         </span>
                       </td>
                     );
                  })}
                </tr>
                <tr className="hover:bg-slate-50 transition">
                  <td className="py-1.5 px-3 font-bold text-slate-500 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Excess</td>
                  {validDoctors.map(doc => {
                     const s = sortedSummaries.find(x => x.name === doc) || { excessGhkaUsed: 0 };
                     return (
                       <td key={doc} className="py-1.5 px-1 text-center">
                         {s.excessGhkaUsed > 0 ? (
                           <span className="inline-block px-1.5 py-0.5 rounded-md font-bold bg-rose-100 text-rose-700">
                             {s.excessGhkaUsed}
                           </span>
                         ) : (
                           <span className="text-slate-300 font-medium">—</span>
                         )}
                       </td>
                     );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom: Tracker Matrix */}
        <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex flex-wrap items-center justify-between gap-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <APP_ICONS.calendar className="w-4 h-4" /> Annual Replacement Matrix
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (isMemoEditMode) {
                    onUpdateSetting('phTrackerMemos', JSON.stringify(memoStatuses));
                  }
                  setIsMemoEditMode(!isMemoEditMode);
                }}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition border ${isMemoEditMode ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {isMemoEditMode ? 'Done Editing Memos' : 'Edit Memos'}
              </button>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-200/50 px-2 py-1 rounded-lg">
                Year {year}
              </span>
            </div>
          </div>
          
          <div className="overflow-x-auto p-0 no-scrollbar">
            {matrixRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-slate-400 p-8 text-center gap-3">
                <APP_ICONS.info className="w-8 h-8 text-slate-300" />
                <p className="text-sm font-bold">No public holidays found.</p>
              </div>
            ) : (
              <table className="w-full text-left border-separate border-spacing-0 table-fixed">
                <thead>
                  <tr className="bg-slate-50/80">
                    <th className="sticky left-0 z-20 bg-slate-50/90 backdrop-blur-md py-2 px-2 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 border-r w-24 md:w-32 truncate">
                      Holiday
                    </th>
                    {validDoctors.map(doc => (
                      <th key={doc} className="py-2 px-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-center truncate" title={doc}>
                        {doc.split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matrixRows.map((row, idx) => {
                    const d = new Date(row.date);
                    const formattedDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

                    return (
                      <tr key={row.date} className="hover:bg-slate-50/50 transition">
                        <td className="sticky left-0 z-10 bg-white py-1.5 px-2 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] truncate" title={row.name}>
                          <p className="text-[10px] font-bold text-slate-800 truncate">{row.name}</p>
                          <p className="text-[9px] text-slate-500 font-semibold">{formattedDate}</p>
                        </td>
                        {validDoctors.map(doc => {
                          const docKey = normalizeForComparison(doc);
                          const cellData = row.doctors[docKey];

                          if (!cellData || !cellData.classification.earnsCredit) {
                            // Either didn't work, or was official HKA off, etc.
                            if (cellData && cellData.classification.category === 'official_ph_off') {
                              return (
                                <td key={docKey} className="py-1 px-1 text-center align-middle border-b border-slate-100">
                                  <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">HKA</span>
                                </td>
                              );
                            }
                            // Empty / Other Non-Working
                            return (
                              <td key={docKey} className="py-1.5 px-1 bg-slate-50/30 text-center border-b border-slate-100">
                                <span className="text-[10px] text-slate-300 font-medium">—</span>
                              </td>
                            );
                          }

                          const classification = cellData.classification;
                          const matchedRecord = cellData.matchedRecord;
                          const isUsed = matchedRecord?.status === 'USED';
                          const memoKey = `${docKey}_${row.date}`;
                          const isMemoSubmitted = !!memoStatuses[memoKey];
                          
                          let badgeBg = 'bg-amber-100 text-amber-800 border-amber-200'; // Default pending (yellow)
                          let statusIcon = <APP_ICONS.clock className="w-2.5 h-2.5" />;
                          let statusText = 'Pend';

                          if (isUsed) {
                            if (isMemoSubmitted) {
                              badgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-200'; // Memo submitted (green)
                              statusIcon = <APP_ICONS.check className="w-2.5 h-2.5" />;
                            } else {
                              badgeBg = 'bg-rose-100 text-rose-800 border-rose-200'; // Used, no memo (red)
                              statusIcon = <APP_ICONS.warning className="w-2.5 h-2.5" />;
                            }
                            statusText = `${new Date(matchedRecord.matchedGhkaDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
                          }

                          return (
                            <td 
                              key={docKey} 
                              className={`py-1 px-1 text-center align-top border-b border-slate-100 ${isUsed && isMemoEditMode ? 'cursor-pointer hover:bg-slate-100/50' : ''}`}
                              onClick={() => {
                                if (isUsed && isMemoEditMode) toggleMemoStatus(docKey, row.date);
                              }}
                            >
                              <div className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-lg border ${badgeBg} mx-0.5 transition-colors`}>
                                <span className="text-[10px] font-black leading-tight">{classification.normalizedShift}</span>
                                <div className="flex items-center gap-0.5 opacity-80 leading-tight">
                                  <span className="flex items-center justify-center">{statusIcon}</span>
                                  <span className="text-[8px] font-bold whitespace-nowrap">{statusText}</span>
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
        </>
      )}
    </div>
  );
}
