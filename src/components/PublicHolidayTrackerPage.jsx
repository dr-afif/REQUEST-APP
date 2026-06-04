import React, { useState, useMemo, useEffect } from 'react';
import {
  getPublicHolidayCredits,
  getGhkaUsage,
  matchGhkaToCredits,
  buildDoctorSummary,
  buildWarnings,
  buildTrackerMatrix
} from '../utils/publicHolidayTracker';

export default function PublicHolidayTrackerPage({
  selectedName,
  names = [],
  masterRoster = [],
  rosterMonth = ''
}) {
  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';

  const [activeMonth, setActiveMonth] = useState(rosterMonth);
  const [sortConfig, setSortConfig] = useState({ key: 'outstanding', direction: 'desc' });

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
    const { matchedRecords, unmatchedUsages } = matchGhkaToCredits(phCredits, ghkaUsages);
    const docSummaries = buildDoctorSummary(matchedRecords, unmatchedUsages, validDoctors);
    const docWarnings = buildWarnings(docSummaries);
    
    // Matrix is filtered by active month
    const mRows = buildTrackerMatrix(matchedRecords, validDoctors, activeMonth);

    return {
      credits: phCredits,
      usages: ghkaUsages,
      matched: matchedRecords,
      unmatched: unmatchedUsages,
      summaries: docSummaries,
      warnings: docWarnings,
      matrixRows: mRows
    };
  }, [masterRoster, validDoctors, activeMonth]);

  // Calculate top-level totals
  const totals = useMemo(() => {
    let totalWorked = 0;
    let totalUsed = 0;
    let totalOutstanding = 0;
    let doctorsWithOutstanding = 0;

    summaries.forEach(s => {
      totalWorked += s.phWorked;
      totalUsed += s.ghkaUsed;
      totalOutstanding += s.outstanding;
      if (s.outstanding > 0) doctorsWithOutstanding++;
    });

    return { totalWorked, totalUsed, totalOutstanding, doctorsWithOutstanding };
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

  const monthName = activeMonth ? new Date(activeMonth + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';

  return (
    <div className="mx-auto px-4 py-8 md:px-8 max-w-6xl animate-fadeIn">
      {/* Page Header */}
      <div className="mb-4">
        <h1 className="text-3xl font-extrabold flex items-center gap-2">
          <span>🇲🇾</span>
          <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">Public Holiday Tracker</span>
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          Read-only tracker for Public Holiday duties and GHKA replacements. Month selection filters the Matrix View.
        </p>
      </div>

      {/* Sticky Month Navigator */}
      <div className="sticky top-[84px] lg:top-7 z-40 mb-6 -mx-4 md:-mx-8 px-4 md:px-8 py-2 bg-white/80 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest hidden sm:block">Viewing Matrix Month</span>
          <div className="flex items-center gap-1.5 bg-white border border-slate-200/80 rounded-2xl p-1 shadow-sm">
            <button
              type="button"
              onClick={() => {
                if (activeMonth) {
                  const [y, m] = activeMonth.split('-').map(Number);
                  const prev = new Date(y, m - 2, 1);
                  const prevMonthStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
                  setActiveMonth(prevMonthStr);
                }
              }}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-50 text-slate-600 active:scale-95 transition font-extrabold text-xs"
              title="Previous Month"
            >
              ◀
            </button>

            <input
              type="month"
              value={activeMonth || ''}
              onChange={(e) => {
                if (e.target.value) {
                  setActiveMonth(e.target.value);
                }
              }}
              className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer text-center px-2 py-1 hover:bg-slate-50 rounded-lg transition"
            />

            <button
              type="button"
              onClick={() => {
                if (activeMonth) {
                  const [y, m] = activeMonth.split('-').map(Number);
                  const next = new Date(y, m, 1);
                  const nextMonthStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
                  setActiveMonth(nextMonthStr);
                }
              }}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-50 text-slate-600 active:scale-95 transition font-extrabold text-xs"
              title="Next Month"
            >
              ▶
            </button>
          </div>
          <span className="text-xs font-bold text-slate-800 hidden sm:block">{monthName}</span>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total PH Worked</p>
          <p className="text-2xl font-black text-indigo-600 mt-2">{totals.totalWorked}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total GHKA Used</p>
          <p className="text-2xl font-black text-emerald-600 mt-2">{totals.totalUsed}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Outstanding GHKA</p>
          <p className="text-2xl font-black text-amber-500 mt-2">{totals.totalOutstanding}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Docs w/ Outstanding</p>
          <p className="text-2xl font-black text-slate-700 mt-2">{totals.doctorsWithOutstanding}</p>
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

      {/* Two Column Layout: Summary Table and Tracker Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Col: Doctor Summary Table */}
        <div className="lg:col-span-1 rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden flex flex-col h-[600px]">
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <span>👥</span> Doctor Summary
            </h3>
          </div>
          <div className="overflow-y-auto flex-1 p-0 no-scrollbar">
            <table className="min-w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-white shadow-sm z-10">
                <tr className="text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold cursor-pointer hover:text-indigo-600" onClick={() => handleSort('name')}>
                    Doctor {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="py-3 px-3 font-bold text-center cursor-pointer hover:text-indigo-600" onClick={() => handleSort('phWorked')}>
                    Worked {sortConfig.key === 'phWorked' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="py-3 px-3 font-bold text-center cursor-pointer hover:text-indigo-600" onClick={() => handleSort('ghkaUsed')}>
                    Used {sortConfig.key === 'ghkaUsed' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="py-3 px-4 font-bold text-center cursor-pointer hover:text-indigo-600" onClick={() => handleSort('outstanding')}>
                    Outst. {sortConfig.key === 'outstanding' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedSummaries.map(s => (
                  <tr key={s.name} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-4 font-bold text-slate-700 truncate max-w-[120px]">{s.name}</td>
                    <td className="py-2.5 px-3 text-center font-semibold text-slate-600">{s.phWorked}</td>
                    <td className="py-2.5 px-3 text-center font-semibold text-slate-600">{s.ghkaUsed}</td>
                    <td className="py-2.5 px-4 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full font-bold ${s.outstanding > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {s.outstanding}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Col: Tracker Matrix */}
        <div className="lg:col-span-2 rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden flex flex-col h-[600px]">
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <span>📅</span> Monthly Replacement Matrix
            </h3>
            <span className="text-[10px] font-bold text-slate-400 bg-slate-200/50 px-2 py-1 rounded-lg">
              {monthName}
            </span>
          </div>
          
          <div className="overflow-auto flex-1 p-0 no-scrollbar">
            {matrixRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center gap-3">
                <span className="text-4xl">🏝️</span>
                <p className="text-sm font-bold">No public holiday shifts worked in {monthName}.</p>
                <p className="text-xs">Try selecting a different month using the navigator above.</p>
              </div>
            ) : (
              <table className="min-w-full text-left border-separate border-spacing-0">
                <thead>
                  <tr className="bg-slate-50/80">
                    <th className="sticky left-0 z-20 bg-slate-50/90 backdrop-blur-md py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 border-r w-[200px] min-w-[200px]">
                      Holiday / Date
                    </th>
                    {validDoctors.map(doc => (
                      <th key={doc} className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 min-w-[140px] text-center">
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
                        <td className="sticky left-0 z-10 bg-white py-3 px-4 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                          <p className="text-xs font-bold text-slate-800">{row.name}</p>
                          <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{formattedDate}</p>
                        </td>
                        {validDoctors.map(doc => {
                          const record = row.doctors[doc.toLowerCase()];
                          
                          if (!record) {
                            // Did not work
                            return (
                              <td key={doc} className="py-3 px-4 bg-slate-50/30 text-center">
                                <span className="text-[10px] text-slate-300 font-medium">—</span>
                              </td>
                            );
                          }

                          // Worked
                          const isUsed = record.status === 'USED';
                          const badgeBg = isUsed ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200';
                          const statusIcon = isUsed ? '✓' : '⏳';
                          const statusText = isUsed ? `GHKA ${new Date(record.matchedGhkaDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Pending';

                          return (
                            <td key={doc} className="py-2 px-3 text-center align-top">
                              <div className={`flex flex-col items-center justify-center p-1.5 rounded-xl border ${badgeBg}`}>
                                <span className="text-xs font-black">{record.workedShift}</span>
                                <div className="flex items-center gap-1 mt-0.5 opacity-80">
                                  <span className="text-[9px] font-bold">{statusIcon}</span>
                                  <span className="text-[9px] font-bold whitespace-nowrap">{statusText}</span>
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
