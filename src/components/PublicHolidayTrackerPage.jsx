import React, { useState, useMemo, useEffect } from 'react';
import {
  getPublicHolidayCredits,
  getGhkaUsage,
  matchGhkaToCredits,
  buildDoctorSummary,
  buildWarnings,
  buildTrackerMatrix
} from '../utils/publicHolidayTracker';
import { normalizeForComparison } from '../utils/normalise';
import { mapName } from '../utils/adapters';

export default function PublicHolidayTrackerPage({
  selectedName,
  names = [],
  masterRoster = [],
  rosterMonth = '',
  settings = {},
  onUpdateSetting = () => {}
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
    onUpdateSetting('phTrackerMemos', JSON.stringify(newStatuses));
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

  if (!isAdmin) {
    return (
      <div className="mx-auto px-4 py-8 md:px-8 max-w-6xl animate-fadeIn text-center">
        <h2 className="text-2xl font-bold text-slate-800">Admin Access Required</h2>
        <p className="mt-2 text-xs text-slate-500">
          This page contains restricted tracking data. Please log in as an administrator to view this content.
        </p>
      </div>
    );
  }

  const year = activeMonth ? activeMonth.split('-')[0] : new Date().getFullYear();

  return (
    <div className="mx-auto px-4 py-8 md:px-8 max-w-6xl animate-fadeIn">
      {/* Page Header */}
      <div className="mb-4">
        <h1 className="text-3xl font-extrabold flex items-center gap-2">
          <span>🇲🇾</span>
          <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">Public Holiday Tracker</span>
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          Read-only tracker for Public Holiday duties and GHKA replacements.
        </p>
      </div>

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
            <span>⚠️</span> Tracker Warnings
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
              <span>⚖️</span> Opening Balances Editor
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
              <span>👥</span> Doctor Summary
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
              <span>📅</span> Annual Replacement Matrix
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsMemoEditMode(!isMemoEditMode)}
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
                <span className="text-4xl">🏝️</span>
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
                          let statusIcon = '⏳';
                          let statusText = 'Pend';

                          if (isUsed) {
                            if (isMemoSubmitted) {
                              badgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-200'; // Memo submitted (green)
                              statusIcon = '✓';
                            } else {
                              badgeBg = 'bg-rose-100 text-rose-800 border-rose-200'; // Used, no memo (red)
                              statusIcon = '❗';
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
                                  <span className="text-[8px] font-bold">{statusIcon}</span>
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
    </div>
  );
}
