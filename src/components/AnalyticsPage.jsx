import { useState, useMemo } from 'react';
import { calculateRosterAnalytics } from '../utils/rosterAnalytics';

export default function AnalyticsPage({
  selectedName,
  names = [],
  requests = [],
  masterRoster = [],
  shiftTypes = [],
  teamMembers = [],
  rosterMonth = '',
}) {
  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [chartMetric, setChartMetric] = useState('NIGHT'); // 'NIGHT', 'activeShiftsCount', 'counts.TOTAL_LEAVE', 'AM', 'PM'
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [selectedDoctor, setSelectedDoctor] = useState(null);

  // 1. Calculate the analytics dataset
  const analytics = useMemo(() => {
    return calculateRosterAnalytics({
      names,
      masterRoster,
      requests,
      teamMembers,
      shiftTypes,
      rosterMonth,
      includeInactive,
    });
  }, [names, masterRoster, requests, teamMembers, shiftTypes, rosterMonth, includeInactive]);

  const { overview, doctorSummaries, rankings, dynamicShiftColumns } = analytics;

  // 2. Format Month Label (e.g. JUNE 2026)
  const monthName = useMemo(() => {
    if (!rosterMonth) return '';
    const [year, month] = rosterMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
  }, [rosterMonth]);

  // 3. Filter summaries by search name query
  const filteredSummaries = useMemo(() => {
    if (!searchQuery) return doctorSummaries;
    const query = searchQuery.trim().toLowerCase();
    return doctorSummaries.filter(doc =>
      doc.name.toLowerCase().includes(query)
    );
  }, [doctorSummaries, searchQuery]);

  // 4. Sort summaries based on configuration
  const sortedSummaries = useMemo(() => {
    const list = [...filteredSummaries];
    if (!sortConfig.key) return list;

    list.sort((a, b) => {
      let valA, valB;
      if (sortConfig.key === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (['activeShiftsCount', 'leaveShiftsCount', 'weekendShiftsCount', 'holidayShiftsCount'].includes(sortConfig.key)) {
        valA = a[sortConfig.key];
        valB = b[sortConfig.key];
      } else {
        valA = a.counts[sortConfig.key] || 0;
        valB = b.counts[sortConfig.key] || 0;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [filteredSummaries, sortConfig]);

  // 5. Generate metrics for horizontal ranking chart
  const chartData = useMemo(() => {
    // Determine title and value extractors based on selected metric
    let getVal = (doc) => 0;
    let label = '';

    if (chartMetric === 'NIGHT') {
      getVal = (doc) => doc.counts.NIGHT || 0;
      label = 'Night Shifts';
    } else if (chartMetric === 'activeShiftsCount') {
      getVal = (doc) => doc.activeShiftsCount;
      label = 'Active Shifts';
    } else if (chartMetric === 'counts.TOTAL_LEAVE') {
      getVal = (doc) => doc.counts.TOTAL_LEAVE || 0;
      label = 'Leave Days';
    } else if (chartMetric === 'AM') {
      getVal = (doc) => doc.counts.AM || 0;
      label = 'AM Shifts';
    } else if (chartMetric === 'PM') {
      getVal = (doc) => doc.counts.PM || 0;
      label = 'PM Shifts';
    }

    const items = doctorSummaries.map(doc => ({
      name: doc.name,
      nameKey: doc.nameKey,
      value: getVal(doc),
    }));

    // Sort descending (highest value at top)
    items.sort((a, b) => b.value - a.value);

    return {
      items: items.filter(i => i.value > 0 || !includeInactive), // filter out zero-active elements if inactive toggled off
      label,
    };
  }, [doctorSummaries, chartMetric, includeInactive]);

  const maxChartValue = useMemo(() => {
    return Math.max(...chartData.items.map(i => i.value), 1);
  }, [chartData]);

  // Handle column header click for sorting
  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortArrow = (key) => {
    if (sortConfig.key !== key) return ' ↕';
    return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
  };

  // Access check
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h2 className="text-lg font-bold text-slate-800">Admin Access Required</h2>
        <p className="mt-2 text-xs text-slate-500">
          This page contains restricted scheduling and duty analytics. Please log in as an administrator to view this content.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto px-4 py-8 md:px-8 max-w-6xl animate-fadeIn">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold flex items-center gap-2">
          <span>📊</span>
          <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">Roster Summary &amp; Analytics</span>
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          Analytics dashboard and shift tallies for the month of <span className="font-bold text-slate-700">{monthName}</span>.
        </p>
      </div>

      {/* 🚀 Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-8">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Members</p>
          <p className="text-2xl font-black text-teal-600 mt-2">{overview.totalMembers}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Shifts</p>
          <p className="text-2xl font-black text-indigo-600 mt-2">{overview.totalActiveShifts}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AM Shifts</p>
          <p className="text-2xl font-black text-emerald-600 mt-2">{overview.totalAmShifts}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">PM Shifts</p>
          <p className="text-2xl font-black text-amber-500 mt-2">{overview.totalPmShifts}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Night Shifts</p>
          <p className="text-2xl font-black text-red-500 mt-2">{overview.totalNightShifts}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Leave Days</p>
          <p className="text-2xl font-black text-purple-600 mt-2">{overview.totalLeaveDays}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unassigned</p>
          <p className="text-2xl font-black text-slate-500 mt-2">{overview.totalEmptyCells}</p>
        </div>
      </div>

      {/* Filter Controls Row */}
      <div className="rounded-3xl border border-slate-150/70 bg-white p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex-1 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <input
              type="text"
              placeholder="🔍 Search doctor by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 pl-8 text-xs font-semibold outline-none focus:border-indigo-400 focus:bg-white transition"
            />
            <span className="absolute left-2.5 top-1.5 text-xs text-slate-400"></span>
          </div>
          <div className="flex items-center gap-2 select-none">
            <input
              type="checkbox"
              id="include-inactive-members"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
            />
            <label htmlFor="include-inactive-members" className="text-xs font-bold text-slate-600 cursor-pointer">
              Include inactive members
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 whitespace-nowrap">Chart Metric:</span>
          <select
            value={chartMetric}
            onChange={(e) => setChartMetric(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 focus:bg-white cursor-pointer"
          >
            <option value="NIGHT">Night Shifts 🌙</option>
            <option value="activeShiftsCount">Active Shifts 🏥</option>
            <option value="counts.TOTAL_LEAVE">Leave Days 💤</option>
            <option value="AM">AM Shifts ☀️</option>
            <option value="PM">PM Shifts 🌤️</option>
          </select>
        </div>
      </div>

      {/* Grid of Chart and Rankings */}
      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        {/* Horizontal Bar Chart Card */}
        <div className="rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
            <span>📈</span> Member Ranking ({chartData.label})
          </h2>
          <div className="max-h-[360px] overflow-y-auto pr-2 space-y-1.5 custom-scrollbar">
            {chartData.items.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-12">No data available for this metric.</p>
            ) : (
              chartData.items.map((item) => {
                const percent = (item.value / maxChartValue) * 100;
                return (
                  <div key={item.nameKey} className="flex items-center gap-3 py-1.5">
                    <span className="w-24 sm:w-28 text-[11px] font-bold text-slate-700 truncate">{item.name.toUpperCase()}</span>
                    <div className="flex-1 bg-slate-50 border border-slate-100 rounded-full h-3 overflow-hidden relative shadow-inner">
                      <div
                        className="bg-gradient-to-r from-teal-500 to-indigo-600 h-full rounded-full transition-all duration-500 shadow-sm"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-[11px] font-black text-slate-800">{item.value}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* rankings card list */}
        <div className="rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
              <span>🏆</span> Key Statistics
            </h2>
            <div className="space-y-4">
              {/* Most Nights */}
              <div>
                <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Most Night Shifts 🌙</p>
                <div className="flex gap-1.5 flex-wrap">
                  {rankings.mostNights.slice(0, 3).map((doc, idx) => (
                    <span key={doc.nameKey} className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-100 rounded-full px-2 py-0.5 text-[10px] font-bold">
                      {idx + 1}. {doc.name.split(' ')[0]} <span className="font-black">({doc.counts.NIGHT})</span>
                    </span>
                  ))}
                  {rankings.mostNights.length === 0 && <span className="text-[10px] text-slate-400">-</span>}
                </div>
              </div>

              {/* Least Nights */}
              <div>
                <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Least Night Shifts (Active) 😴</p>
                <div className="flex gap-1.5 flex-wrap">
                  {rankings.leastNights.slice(0, 3).map((doc, idx) => (
                    <span key={doc.nameKey} className="inline-flex items-center gap-1 bg-slate-50 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5 text-[10px] font-bold">
                      {idx + 1}. {doc.name.split(' ')[0]} <span className="font-black">({doc.counts.NIGHT})</span>
                    </span>
                  ))}
                  {rankings.leastNights.length === 0 && <span className="text-[10px] text-slate-400">-</span>}
                </div>
              </div>

              {/* Most Active Duties */}
              <div>
                <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Most Active Duties 🏥</p>
                <div className="flex gap-1.5 flex-wrap">
                  {rankings.mostActive.slice(0, 3).map((doc, idx) => (
                    <span key={doc.nameKey} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5 text-[10px] font-bold">
                      {idx + 1}. {doc.name.split(' ')[0]} <span className="font-black">({doc.activeShiftsCount})</span>
                    </span>
                  ))}
                  {rankings.mostActive.length === 0 && <span className="text-[10px] text-slate-400">-</span>}
                </div>
              </div>

              {/* Most Leaves */}
              <div>
                <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Most Leave Days 💤</p>
                <div className="flex gap-1.5 flex-wrap">
                  {rankings.mostLeave.slice(0, 3).map((doc, idx) => (
                    <span key={doc.nameKey} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 border border-purple-100 rounded-full px-2 py-0.5 text-[10px] font-bold">
                      {idx + 1}. {doc.name.split(' ')[0]} <span className="font-black">({doc.counts.TOTAL_LEAVE})</span>
                    </span>
                  ))}
                  {rankings.mostLeave.length === 0 && <span className="text-[10px] text-slate-400">-</span>}
                </div>
              </div>

              {/* Most Weekend duties */}
              <div>
                <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Most Weekend Duties ⛱️</p>
                <div className="flex gap-1.5 flex-wrap">
                  {rankings.mostWeekend.slice(0, 3).map((doc, idx) => (
                    <span key={doc.nameKey} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5 text-[10px] font-bold">
                      {idx + 1}. {doc.name.split(' ')[0]} <span className="font-black">({doc.weekendShiftsCount})</span>
                    </span>
                  ))}
                  {rankings.mostWeekend.length === 0 && <span className="text-[10px] text-slate-400">-</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabular summary list */}
      <div className="rounded-3xl border border-slate-150/70 bg-white p-1 shadow-sm overflow-hidden mb-8">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <span>👤</span> Individual Doctor summaries
          </h3>
          <span className="text-[10px] font-semibold text-slate-400">Click any row to view breakdown details</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs font-sans text-center">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100 select-none">
                <th
                  onClick={() => requestSort('name')}
                  className="sticky left-0 z-20 bg-slate-50 px-4 py-3 text-left font-extrabold uppercase tracking-wider shadow-sm ring-1 ring-slate-100 cursor-pointer hover:bg-slate-100 text-[10px] sm:text-xs"
                >
                  Name{getSortArrow('name')}
                </th>
                {dynamicShiftColumns.map((col) => (
                  <th
                    key={col}
                    onClick={() => requestSort(col)}
                    className="px-3 py-3 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[10px] sm:text-xs"
                  >
                    {col}{getSortArrow(col)}
                  </th>
                ))}
                <th
                  onClick={() => requestSort('weekendShiftsCount')}
                  className="px-3 py-3 font-extrabold uppercase tracking-wider border-l border-slate-100 bg-emerald-50/60 text-emerald-800 cursor-pointer hover:bg-emerald-100 text-[10px] sm:text-xs"
                >
                  Weekend{getSortArrow('weekendShiftsCount')}
                </th>
                <th
                  onClick={() => requestSort('holidayShiftsCount')}
                  className="px-3 py-3 font-extrabold uppercase tracking-wider border-l border-slate-100 bg-rose-50/60 text-rose-800 cursor-pointer hover:bg-rose-100 text-[10px] sm:text-xs"
                >
                  Holiday{getSortArrow('holidayShiftsCount')}
                </th>
                <th
                  onClick={() => requestSort('activeShiftsCount')}
                  className="px-3 py-3 font-extrabold uppercase tracking-wider border-l border-slate-100 bg-indigo-50/60 text-indigo-800 cursor-pointer hover:bg-indigo-100 text-[10px] sm:text-xs"
                >
                  Total Active{getSortArrow('activeShiftsCount')}
                </th>
                <th
                  onClick={() => requestSort('TOTAL_LEAVE')}
                  className="px-3 py-3 font-extrabold uppercase tracking-wider border-l border-slate-100 bg-purple-50/60 text-purple-800 cursor-pointer hover:bg-purple-100 text-[10px] sm:text-xs"
                >
                  Total Leave{getSortArrow('TOTAL_LEAVE')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSummaries.length === 0 ? (
                <tr>
                  <td className="px-4 py-12 text-slate-400 text-center font-semibold text-xs" colSpan={dynamicShiftColumns.length + 5}>
                    No records found matching query.
                  </td>
                </tr>
              ) : (
                sortedSummaries.map((entry) => {
                  return (
                    <tr
                      key={entry.nameKey}
                      onClick={() => setSelectedDoctor(entry)}
                      className={`hover:bg-slate-50/70 border-b border-slate-100 transition cursor-pointer ${
                        entry.isInactive ? 'opacity-60 bg-slate-50/30' : ''
                      }`}
                    >
                      <th className={`sticky left-0 z-10 px-4 py-2.5 text-left font-semibold text-slate-800 shadow-sm ring-1 ring-slate-100 bg-white`}>
                        <div className="flex items-center gap-1.5 truncate">
                          <span>{entry.name.toUpperCase()}</span>
                          {entry.isInactive && (
                            <span className="text-[8px] bg-slate-100 border border-slate-200 text-slate-400 px-1 rounded">INACTIVE</span>
                          )}
                        </div>
                      </th>
                      {dynamicShiftColumns.map((col) => {
                        const val = entry.counts[col] || 0;
                        return (
                          <td key={col} className="px-3 py-2.5 border-l border-slate-100 text-slate-800 font-medium">
                            {val > 0 ? val : <span className="text-slate-350">-</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 border-l border-slate-100 bg-emerald-50/20 text-emerald-800 font-extrabold">
                        {entry.weekendShiftsCount > 0 ? entry.weekendShiftsCount : <span className="text-emerald-300">-</span>}
                      </td>
                      <td className="px-3 py-2.5 border-l border-slate-100 bg-rose-50/20 text-rose-800 font-extrabold">
                        {entry.holidayShiftsCount > 0 ? entry.holidayShiftsCount : <span className="text-rose-300">-</span>}
                      </td>
                      <td className="px-3 py-2.5 border-l border-slate-100 bg-indigo-50/20 text-indigo-800 font-black">
                        {entry.activeShiftsCount > 0 ? entry.activeShiftsCount : <span className="text-indigo-300">-</span>}
                      </td>
                      <td className="px-3 py-2.5 border-l border-slate-100 bg-purple-50/20 text-purple-800 font-black">
                        {entry.counts.TOTAL_LEAVE > 0 ? entry.counts.TOTAL_LEAVE : <span className="text-purple-300">-</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 👤 Doctor Detail Slide-over / Modal Panel */}
      {selectedDoctor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-900/60 p-4 backdrop-blur-sm animate-fadeIn"
          onClick={() => setSelectedDoctor(null)}
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
                  Doctor Profile Analytics
                </span>
                <h3 className="text-lg font-extrabold text-slate-800 mt-1 uppercase tracking-wide">
                  {selectedDoctor.name}
                </h3>
                {selectedDoctor.isInactive && (
                  <p className="text-[9px] font-extrabold text-slate-400 uppercase mt-0.5">INACTIVE STATUS</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedDoctor(null)}
                className="rounded-full bg-slate-100 p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
              >
                <span className="block w-5 h-5 text-center leading-none text-lg font-bold">×</span>
              </button>
            </div>

            <div className="space-y-4">
              {/* Core metrics summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-indigo-50/50 border border-indigo-100/60 rounded-2xl p-3">
                  <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-wider block">Active Duties</span>
                  <span className="text-xl font-black text-indigo-900 mt-1 block">{selectedDoctor.activeShiftsCount}</span>
                </div>
                <div className="bg-purple-50/50 border border-purple-100/60 rounded-2xl p-3">
                  <span className="text-[9px] font-extrabold text-purple-500 uppercase tracking-wider block">Leave Days</span>
                  <span className="text-xl font-black text-purple-900 mt-1 block">{selectedDoctor.counts.TOTAL_LEAVE}</span>
                </div>
                <div className="bg-emerald-50/50 border border-emerald-100/60 rounded-2xl p-3">
                  <span className="text-[9px] font-extrabold text-emerald-500 uppercase tracking-wider block">Weekend Duties</span>
                  <span className="text-xl font-black text-emerald-900 mt-1 block">{selectedDoctor.weekendShiftsCount}</span>
                </div>
                <div className="bg-rose-50/50 border border-rose-100/60 rounded-2xl p-3">
                  <span className="text-[9px] font-extrabold text-rose-500 uppercase tracking-wider block">Holiday Duties</span>
                  <span className="text-xl font-black text-rose-900 mt-1 block">{selectedDoctor.holidayShiftsCount}</span>
                </div>
              </div>

              {/* Shift Breakdown List */}
              <div>
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Shift Type Breakdown</h4>
                <div className="rounded-2xl border border-slate-100 divide-y divide-slate-100 max-h-[180px] overflow-y-auto custom-scrollbar">
                  {dynamicShiftColumns.map((col) => {
                    const count = selectedDoctor.counts[col] || 0;
                    if (count === 0) return null;
                    return (
                      <div key={col} className="flex justify-between items-center py-2 px-3 text-xs">
                        <span className="font-bold text-slate-700">{col}</span>
                        <span className="font-black text-slate-900">{count}</span>
                      </div>
                    );
                  })}
                  {selectedDoctor.counts.TOTAL_LEAVE > 0 && (
                    <div className="flex justify-between items-center py-2 px-3 text-xs bg-slate-55/40 font-bold">
                      <span className="text-purple-700 uppercase tracking-wide">Combined Leaves</span>
                      <span className="text-purple-900 font-extrabold">{selectedDoctor.counts.TOTAL_LEAVE}</span>
                    </div>
                  )}
                  {selectedDoctor.activeShiftsCount === 0 && selectedDoctor.counts.TOTAL_LEAVE === 0 && (
                    <div className="py-4 text-center text-slate-400 italic text-xs">
                      No duty or leave records assigned this month.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedDoctor(null)}
              className="mt-6 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-800 transition"
            >
              Close Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
