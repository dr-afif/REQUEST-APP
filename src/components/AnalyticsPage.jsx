import { useState, useMemo, useEffect } from 'react';
import {
  calculateRosterAnalytics,
  calculateRosterHealthScore,
  calculateLeaveClustering,
  calculateEquitySignals,
  generateHealthInsights,
} from '../utils/rosterAnalytics';

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
  const [fairnessSortConfig, setFairnessSortConfig] = useState({ key: 'fairnessScore', direction: 'desc' });
  const [ytdSortConfig, setYtdSortConfig] = useState({ key: 'activeShifts', direction: 'desc' });
  const [activeMonth, setActiveMonth] = useState(rosterMonth);
  const [showLeaveDetails, setShowLeaveDetails] = useState(false);
  const [showAmPmBalance, setShowAmPmBalance] = useState(true);

  useEffect(() => {
    if (rosterMonth) {
      setActiveMonth(rosterMonth);
    }
  }, [rosterMonth]);

  // Read saved thresholds for coverage calculations
  const tallyThresholds = useMemo(() => {
    try {
      const saved = localStorage.getItem('rosterTallyThresholds');
      const defaultThresholds = {
        amMin: 1,
        pmMin: 1,
        nightMin: 1,
        nightMax: 2,
        totalLeaveMax: 4,
      };
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultThresholds, ...parsed };
      }
      return defaultThresholds;
    } catch (e) {
      return {
        amMin: 1,
        pmMin: 1,
        nightMin: 1,
        nightMax: 2,
        totalLeaveMax: 4,
      };
    }
  }, []);

  // 1. Calculate the analytics dataset
  const analytics = useMemo(() => {
    return calculateRosterAnalytics({
      names,
      masterRoster,
      requests,
      teamMembers,
      shiftTypes,
      rosterMonth: activeMonth,
      includeInactive,
      tallyThresholds,
    });
  }, [names, masterRoster, requests, teamMembers, shiftTypes, activeMonth, includeInactive, tallyThresholds]);

  const { overview, doctorSummaries, rankings, dynamicShiftColumns, coverageIssues, ytdStats, averages, dayStatsList } = analytics;

  // ── Roster Health Intelligence ───────────────────────────────────────────
  const leaveClusters = useMemo(() => {
    return calculateLeaveClustering(dayStatsList || [], tallyThresholds);
  }, [dayStatsList, tallyThresholds]);

  const equitySignals = useMemo(() => {
    return calculateEquitySignals(doctorSummaries);
  }, [doctorSummaries]);

  const healthScore = useMemo(() => {
    return calculateRosterHealthScore({
      fairnessScores: doctorSummaries,
      coverageIssues,
      memberStats: doctorSummaries,
      dayStats: dayStatsList || [],
      thresholds: tallyThresholds,
    });
  }, [doctorSummaries, coverageIssues, dayStatsList, tallyThresholds]);

  const healthInsights = useMemo(() => {
    return generateHealthInsights({
      healthScore,
      fairnessScores: doctorSummaries,
      coverageIssues,
      leaveClusters,
      equitySignals,
    });
  }, [healthScore, doctorSummaries, coverageIssues, leaveClusters, equitySignals]);

  // AM vs PM balance per member
  const amPmBalance = useMemo(() => {
    const totalAm = overview?.totalAmShifts || 0;
    const totalPm = overview?.totalPmShifts || 0;
    const totalAmPm = totalAm + totalPm;
    // Team-wide ratio expressed as AM fraction (0–1)
    const teamAmFraction = totalAmPm > 0 ? totalAm / totalAmPm : 0.5;
    const teamPmFraction = 1 - teamAmFraction;

    const members = doctorSummaries
      .filter(d => !d.isInactive)
      .map(d => {
        const am = d.counts?.AM || 0;
        const pm = d.counts?.PM || 0;
        const total = am + pm;
        const memberAmFraction = total > 0 ? am / total : null; // null = no AM/PM shifts
        const deviation = memberAmFraction !== null ? Math.abs(memberAmFraction - teamAmFraction) : 0;

        let status = 'ok';
        let statusLabel = 'Balanced';
        if (total === 0) { status = 'none'; statusLabel = 'No AM/PM'; }
        else if (deviation > 0.25) { status = 'high'; statusLabel = 'Imbalanced'; }
        else if (deviation > 0.12) { status = 'medium'; statusLabel = 'Watch'; }

        return {
          name: d.name,
          nameKey: d.nameKey,
          am,
          pm,
          total,
          memberAmFraction,
          deviation,
          status,
          statusLabel,
        };
      })
      .sort((a, b) => b.deviation - a.deviation);

    return { members, teamAmFraction, teamPmFraction, totalAm, totalPm };
  }, [doctorSummaries, overview]);

  const sortedFairnessSummaries = useMemo(() => {
    const list = [...doctorSummaries];
    if (!fairnessSortConfig.key) return list;

    list.sort((a, b) => {
      let valA, valB;
      if (fairnessSortConfig.key === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (fairnessSortConfig.key === 'fairnessStatus') {
        valA = a.fairnessStatus;
        valB = b.fairnessStatus;
      } else {
        valA = a[fairnessSortConfig.key] !== undefined ? a[fairnessSortConfig.key] : 0;
        valB = b[fairnessSortConfig.key] !== undefined ? b[fairnessSortConfig.key] : 0;
      }

      if (valA < valB) return fairnessSortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return fairnessSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [doctorSummaries, fairnessSortConfig]);

  const fairnessStandings = useMemo(() => {
    const activeDocs = doctorSummaries.filter(d => !d.isInactive);
    if (activeDocs.length === 0) return null;

    const mostBalanced = [...activeDocs].sort((a, b) => b.fairnessScore - a.fairnessScore)[0];
    const needsReview = [...activeDocs].sort((a, b) => a.fairnessScore - b.fairnessScore)[0];
    const highestNight = [...activeDocs].sort((a, b) => b.nightShifts - a.nightShifts)[0];
    const highestWeekend = [...activeDocs].sort((a, b) => b.weekendShifts - a.weekendShifts)[0];
    const highestHoliday = [...activeDocs].sort((a, b) => b.publicHolidayShifts - a.publicHolidayShifts)[0];
    const lowestActive = [...activeDocs].sort((a, b) => a.activeShifts - b.activeShifts)[0];

    return {
      mostBalanced,
      needsReview,
      highestNight,
      highestWeekend,
      highestHoliday,
      lowestActive,
    };
  }, [doctorSummaries]);

  const sortedYtdMemberStats = useMemo(() => {
    const list = [...(ytdStats?.perMemberYtdStats || [])];
    if (!ytdSortConfig.key) return list;

    list.sort((a, b) => {
      let valA, valB;
      if (ytdSortConfig.key === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else {
        valA = a[ytdSortConfig.key] || 0;
        valB = b[ytdSortConfig.key] || 0;
      }

      if (valA < valB) return ytdSortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return ytdSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [ytdStats?.perMemberYtdStats, ytdSortConfig]);

  // 2. Format Month Label (e.g. JUNE 2026)
  const monthName = useMemo(() => {
    if (!activeMonth) return '';
    const [year, month] = activeMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
  }, [activeMonth]);

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
      <div className="mb-4">
        <h1 className="text-3xl font-extrabold flex items-center gap-2">
          <span>📊</span>
          <span className="bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">Roster Summary &amp; Analytics</span>
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          Analytics dashboard and shift tallies for the month of <span className="font-bold text-slate-700">{monthName}</span>.
        </p>
      </div>

      {/* Sticky Month Navigator */}
      <div className="sticky top-0 z-40 mb-6 -mx-4 md:-mx-8 px-4 md:px-8 py-2 bg-white/80 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest hidden sm:block">Viewing month</span>
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
              className="border-none bg-transparent text-xs font-bold text-slate-750 focus:ring-0 cursor-pointer outline-none px-1 text-center w-36"
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
          <span className="text-xs font-bold text-slate-700 hidden sm:block">{monthName}</span>
        </div>
      </div>

      {/* ❤️ Roster Health Intelligence */}
      <div className="mb-8 space-y-5">

        {/* A — Health Score Card */}
        {(() => {
          const sevMap = {
            green:  { ring: 'ring-emerald-200', bg: 'bg-emerald-50',  text: 'text-emerald-700',  badgeBg: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500', icon: '✅' },
            blue:   { ring: 'ring-blue-200',    bg: 'bg-blue-50',    text: 'text-blue-700',    badgeBg: 'bg-blue-100 text-blue-800',   bar: 'bg-blue-500',   icon: '🔵' },
            amber:  { ring: 'ring-amber-200',   bg: 'bg-amber-50',   text: 'text-amber-700',   badgeBg: 'bg-amber-100 text-amber-800',  bar: 'bg-amber-500',  icon: '⚠️' },
            red:    { ring: 'ring-red-200',     bg: 'bg-red-50',     text: 'text-red-700',     badgeBg: 'bg-red-100 text-red-800',    bar: 'bg-red-500',    icon: '🚨' },
          };
          const style = sevMap[healthScore.severity] || sevMap.green;
          const components = [
            { label: 'Fairness',         key: 'fairness',           color: 'bg-indigo-500' },
            { label: 'Coverage',         key: 'coverage',           color: 'bg-rose-500'   },
            { label: 'Night Equity',     key: 'nightEquity',        color: 'bg-violet-500' },
            { label: 'Weekend Equity',   key: 'weekendEquity',      color: 'bg-emerald-500' },
            { label: 'PH Equity',        key: 'publicHolidayEquity',color: 'bg-teal-500'   },
            { label: 'Leave Clustering', key: 'leaveClustering',    color: 'bg-amber-500'  },
          ];
          return (
            <div className={`rounded-3xl border bg-white p-6 shadow-sm ring-1 ${style.ring}`}>
              <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                {/* Score display */}
                <div className="flex-shrink-0 flex flex-col items-center justify-center text-center min-w-[140px]">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1">Roster Health</span>
                  <div className={`text-6xl font-black ${style.text} leading-none`}>{healthScore.score}</div>
                  <div className="text-slate-400 text-xs font-bold mt-0.5">/ 100</div>
                  <span className={`mt-3 inline-block px-3 py-1 rounded-full text-xs font-extrabold tracking-wide ${style.badgeBg}`}>
                    {style.icon} {healthScore.status}
                  </span>
                  {/* Ring meter */}
                  <div className="mt-3 w-20 h-20 relative">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15.9" fill="none"
                        stroke={healthScore.severity === 'green' ? '#10b981' : healthScore.severity === 'blue' ? '#3b82f6' : healthScore.severity === 'amber' ? '#f59e0b' : '#ef4444'}
                        strokeWidth="3"
                        strokeDasharray={`${healthScore.score} ${100 - healthScore.score}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-slate-700">{healthScore.score}%</span>
                  </div>
                </div>
                {/* Component bars */}
                <div className="flex-1 space-y-3">
                  <h3 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-3">Health Component Breakdown</h3>
                  {components.map(({ label, key, color }) => {
                    const val = healthScore.components[key] ?? 100;
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-[10px] font-semibold text-slate-600 mb-1">
                          <span>{label}</span>
                          <span className="font-black text-slate-800">{val}%</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`${color} h-full rounded-full transition-all duration-700`}
                            style={{ width: `${val}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Deductions */}
                <div className="flex-shrink-0 lg:min-w-[240px] xl:min-w-[280px]">
                  <h3 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-3">Top Deductions</h3>
                  {healthScore.deductions.length === 0 ? (
                    <div className="text-xs text-emerald-600 font-semibold flex items-center gap-1.5">
                      <span>✅</span> No major health deductions.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                      {healthScore.deductions.map((d, i) => {
                        const dStyle = d.severity === 'high'
                          ? 'bg-red-50 border-red-100 text-red-800'
                          : d.severity === 'medium'
                          ? 'bg-amber-50 border-amber-100 text-amber-800'
                          : 'bg-slate-50 border-slate-100 text-slate-700';
                        const badgeStyle = d.severity === 'high'
                          ? 'bg-red-100 text-red-800'
                          : d.severity === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600';
                        return (
                          <div key={i} className={`rounded-xl border p-2.5 ${dStyle}`}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] font-bold truncate">{d.label}</span>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase ${badgeStyle}`}>{d.severity}</span>
                                <span className="text-[10px] font-black">-{d.points}pts</span>
                              </div>
                            </div>
                            <p className="text-[9px] opacity-80 leading-tight">{d.reason}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* B — Health Insights Panel */}
        {healthInsights.length > 0 && (
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
              <span>💡</span> Health Insights &amp; Recommendations
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {healthInsights.map((insight, i) => {
                const typeIcons = { coverage: '🏥', night: '🌙', weekend: '⛱️', holiday: '🎉', leave: '📅', fairness: '⚖️' };
                const sevStyle = insight.severity === 'high'
                  ? 'border-red-100 bg-red-50/40'
                  : insight.severity === 'medium'
                  ? 'border-amber-100 bg-amber-50/40'
                  : insight.severity === 'info'
                  ? 'border-emerald-100 bg-emerald-50/30'
                  : 'border-slate-100 bg-slate-50/40';
                const badgeStyle = insight.severity === 'high'
                  ? 'bg-red-100 text-red-800'
                  : insight.severity === 'medium'
                  ? 'bg-amber-100 text-amber-800'
                  : insight.severity === 'info'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-700';
                return (
                  <div key={i} className={`rounded-2xl border p-4 text-left ${sevStyle}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{typeIcons[insight.type] || '📌'}</span>
                        <span className="text-xs font-extrabold text-slate-800">{insight.title}</span>
                      </div>
                      <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase flex-shrink-0 ${badgeStyle}`}>
                        {insight.severity}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-600 mb-2 leading-relaxed">{insight.description}</p>
                    <p className="text-[9px] font-semibold text-slate-500 italic leading-relaxed">💬 {insight.recommendation}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* C — Equity Signals Panel */}
        {(() => {
          const signals = [
            { label: 'Night Equity',      key: 'nightEquity',        icon: '🌙', color: 'text-violet-700', ringColor: 'ring-violet-100', bg: 'bg-violet-50/40' },
            { label: 'Weekend Equity',    key: 'weekendEquity',      icon: '⛱️', color: 'text-emerald-700', ringColor: 'ring-emerald-100', bg: 'bg-emerald-50/40' },
            { label: 'Public Holiday Equity', key: 'publicHolidayEquity', icon: '🎉', color: 'text-teal-700', ringColor: 'ring-teal-100', bg: 'bg-teal-50/40' },
            { label: 'Active Shift Equity',   key: 'activeShiftEquity',  icon: '🏥', color: 'text-indigo-700', ringColor: 'ring-indigo-100', bg: 'bg-indigo-50/40' },
          ];
          return (
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                <span>📊</span> Equity Signal Analysis
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {signals.map(({ label, key, icon, color, ringColor, bg }) => {
                  const sig = equitySignals?.[key];
                  if (!sig) return null;
                  const spreadBadge = sig.severity === 'high'
                    ? 'bg-red-100 text-red-800'
                    : sig.severity === 'medium'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800';
                  return (
                    <div key={key} className={`rounded-2xl border ring-1 ${ringColor} ${bg} p-4 text-left`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">{icon}</span>
                          <span className={`text-[10px] font-extrabold uppercase tracking-wider ${color}`}>{label}</span>
                        </div>
                        <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase ${spreadBadge}`}>
                          {sig.severity}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-center mb-3">
                        <div className="bg-white rounded-xl p-1.5 border border-slate-100">
                          <div className="text-[8px] text-slate-400 font-bold uppercase">Min</div>
                          <div className="text-sm font-black text-slate-800">{sig.min}</div>
                        </div>
                        <div className="bg-white rounded-xl p-1.5 border border-slate-100">
                          <div className="text-[8px] text-slate-400 font-bold uppercase">Avg</div>
                          <div className="text-sm font-black text-slate-800">{sig.average}</div>
                        </div>
                        <div className="bg-white rounded-xl p-1.5 border border-slate-100">
                          <div className="text-[8px] text-slate-400 font-bold uppercase">Max</div>
                          <div className="text-sm font-black text-slate-800">{sig.max}</div>
                        </div>
                      </div>
                      <div className="text-[9px] font-semibold text-slate-500 mb-2">
                        Spread: <span className="font-black text-slate-700">{sig.spread}</span>
                      </div>
                      {sig.highest.length > 0 && (
                        <div className="mb-1.5">
                          <span className="text-[8px] font-extrabold text-slate-400 uppercase">Highest</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {sig.highest.map(m => (
                              <span key={m.name} className="text-[9px] font-bold bg-white border border-slate-200 rounded-full px-1.5 py-0.5 text-slate-700">
                                {m.name.split(' ')[0]} ({m.value})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {sig.lowest.length > 0 && (
                        <div>
                          <span className="text-[8px] font-extrabold text-slate-400 uppercase">Lowest</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {sig.lowest.map(m => (
                              <span key={m.name} className="text-[9px] font-bold bg-white border border-slate-200 rounded-full px-1.5 py-0.5 text-slate-500">
                                {m.name.split(' ')[0]} ({m.value})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* D — AM vs PM Balance Panel */}
        <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAmPmBalance(v => !v)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50/60 transition text-left"
          >
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <span>☀️️</span> AM vs PM Shift Balance
              <span className="text-[9px] font-normal text-slate-400 normal-case tracking-normal">
                Team ratio: {amPmBalance.totalAm}AM / {amPmBalance.totalPm}PM
                ({amPmBalance.totalAm + amPmBalance.totalPm > 0
                  ? `${Math.round(amPmBalance.teamAmFraction * 100)}% AM`
                  : 'no data'})
              </span>
            </h3>
            <span className="text-slate-400 text-sm font-bold flex-shrink-0 ml-2">{showAmPmBalance ? '▲' : '▼'}</span>
          </button>

          {showAmPmBalance && (
            <div className="px-6 pb-5">
              {/* Team ratio bar */}
              <div className="mb-5">
                <div className="flex justify-between text-[9px] font-bold text-slate-500 mb-1">
                  <span className="text-emerald-700">AM — {Math.round(amPmBalance.teamAmFraction * 100)}%</span>
                  <span className="text-amber-600">PM — {Math.round(amPmBalance.teamPmFraction * 100)}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-slate-100">
                  <div
                    className="bg-emerald-400 h-full rounded-l-full transition-all duration-500"
                    style={{ width: `${Math.round(amPmBalance.teamAmFraction * 100)}%` }}
                  />
                  <div
                    className="bg-amber-400 h-full rounded-r-full flex-1 transition-all duration-500"
                  />
                </div>
                <p className="text-[9px] text-slate-400 mt-1">Target: each member should be close to the team ratio above. Members with &gt;25% deviation are flagged as Imbalanced.</p>
              </div>

              {/* Per-member rows */}
              {amPmBalance.members.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No AM/PM data available for this month.</p>
              ) : (
                <div className="space-y-2">
                  {amPmBalance.members.map(m => {
                    const amPct = m.total > 0 ? Math.round((m.am / m.total) * 100) : 0;
                    const pmPct = 100 - amPct;
                    const statusStyle = m.status === 'high'
                      ? { badge: 'bg-red-100 text-red-800', bar: 'border-red-200' }
                      : m.status === 'medium'
                      ? { badge: 'bg-amber-100 text-amber-800', bar: 'border-amber-200' }
                      : m.status === 'none'
                      ? { badge: 'bg-slate-100 text-slate-500', bar: 'border-slate-100' }
                      : { badge: 'bg-emerald-100 text-emerald-800', bar: 'border-emerald-100' };

                    return (
                      <div key={m.nameKey} className={`rounded-xl border p-2.5 ${statusStyle.bar} bg-white`}>
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <span className="text-[10px] font-bold text-slate-800 truncate flex-1">{m.name.toUpperCase()}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[9px] text-slate-500 font-semibold">
                              {m.am}AM / {m.pm}PM
                            </span>
                            <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase ${statusStyle.badge}`}>
                              {m.statusLabel}
                            </span>
                          </div>
                        </div>
                        {m.total > 0 ? (
                          <>
                            <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-slate-100">
                              <div
                                className="bg-emerald-400 h-full rounded-l-full transition-all duration-500"
                                style={{ width: `${amPct}%` }}
                              />
                              <div className="bg-amber-400 h-full rounded-r-full flex-1" />
                            </div>
                            <div className="flex justify-between text-[8px] text-slate-400 mt-0.5 font-semibold">
                              <span>{amPct}% AM</span>
                              <span>{pmPct}% PM</span>
                            </div>
                            {m.status !== 'ok' && m.status !== 'none' && (
                              <p className="text-[8px] text-slate-500 mt-1">
                                Deviation from team ratio: <span className="font-bold text-rose-600">{Math.round(m.deviation * 100)}%</span>
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-[9px] text-slate-400 italic">No AM or PM shifts this month.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* E — Leave Clustering Panel */}
        <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLeaveDetails(v => !v)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50/60 transition text-left"
          >
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <span>📅</span> Leave Clustering Analysis
              {leaveClusters.length > 0 && (
                <span className="ml-1 text-[9px] font-extrabold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">
                  {leaveClusters.length} flagged
                </span>
              )}
            </h3>
            <span className="text-slate-400 text-sm font-bold flex-shrink-0 ml-2">{showLeaveDetails ? '▲' : '▼'}</span>
          </button>

          {showLeaveDetails && (
            <div className="px-6 pb-5">
              {leaveClusters.length === 0 ? (
                <div className="py-8 text-center text-emerald-600 font-bold flex flex-col items-center gap-2 text-xs">
                  <span className="text-2xl">✅</span>
                  <span>No leave clustering detected — leave distribution looks healthy.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-[10px] text-left border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-bold">
                        <th className="py-2 pl-3 pr-2">Date</th>
                        <th className="py-2 px-2">Day</th>
                        <th className="py-2 px-2 text-center">Leave Count</th>
                        <th className="py-2 px-2 text-center">Threshold</th>
                        <th className="py-2 px-2 text-center">Over by</th>
                        <th className="py-2 px-2 text-center">Severity</th>
                        <th className="py-2 px-2">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {leaveClusters.map(cluster => {
                        const sevBadge = cluster.severity === 'high'
                          ? 'bg-red-100 text-red-800'
                          : cluster.severity === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700';
                        return (
                          <tr key={cluster.date} className="hover:bg-slate-50 transition">
                            <td className="py-2 pl-3 pr-2 font-bold text-slate-800">{cluster.label}</td>
                            <td className="py-2 px-2 text-slate-500">{cluster.dayName}</td>
                            <td className="py-2 px-2 text-center font-black text-slate-900">{cluster.totalLeave}</td>
                            <td className="py-2 px-2 text-center text-slate-500">{cluster.threshold}</td>
                            <td className="py-2 px-2 text-center font-bold text-rose-700">+{cluster.totalLeave - cluster.threshold}</td>
                            <td className="py-2 px-2 text-center">
                              <span className={`inline-block text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase ${sevBadge}`}>
                                {cluster.severity}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-slate-500 italic">{cluster.message}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

      </div>{/* /Health Intelligence */}

      {/* 🚀 Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-8">
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
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Weekend Leaves</p>
          <p className="text-2xl font-black text-teal-600 mt-2">{overview.totalWeekendLeaves || 0}</p>
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

              {/* Most Weekend Leaves */}
              <div>
                <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Most Weekend Leaves 🏖️</p>
                <div className="flex gap-1.5 flex-wrap">
                  {rankings.mostWeekendLeaves && rankings.mostWeekendLeaves.slice(0, 3).map((doc, idx) => (
                    <span key={doc.nameKey} className="inline-flex items-center gap-1 bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-2 py-0.5 text-[10px] font-bold">
                      {idx + 1}. {doc.name.split(' ')[0]} <span className="font-black">({doc.weekendLeavesCount || 0})</span>
                    </span>
                  ))}
                  {(!rankings.mostWeekendLeaves || rankings.mostWeekendLeaves.length === 0) && <span className="text-[10px] text-slate-400">-</span>}
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

      {/* ⚖️ Fairness Scoring Panel & Standing Cards */}
      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        {/* Fairness Table */}
        <div className="rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 mb-4 gap-2">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <span>⚖️</span> Fairness Scoring
            </h3>
            {averages && (
              <div className="flex flex-wrap gap-2 text-[9px] font-bold text-slate-500 bg-slate-50 border border-slate-150/50 rounded-lg px-2 py-1">
                <span>Team Averages:</span>
                <span>Active: {averages.activeShifts}</span>
                <span>Night: {averages.nightShifts}</span>
                <span>Weekend: {averages.weekendShifts}</span>
                <span>Holiday: {averages.publicHolidayShifts}</span>
                <span>Leave: {averages.totalLeave}</span>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-[10px] sm:text-xs font-sans text-center">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-100 select-none">
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'name' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'name', direction: dir });
                    }}
                    className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-extrabold uppercase tracking-wider shadow-sm ring-1 ring-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Name {fairnessSortConfig.key === 'name' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'fairnessScore' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'fairnessScore', direction: dir });
                    }}
                    className="px-2 py-2 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Score {fairnessSortConfig.key === 'fairnessScore' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'fairnessStatus' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'fairnessStatus', direction: dir });
                    }}
                    className="px-2 py-2 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Status {fairnessSortConfig.key === 'fairnessStatus' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'activeShifts' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'activeShifts', direction: dir });
                    }}
                    className="px-2 py-2 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Active {fairnessSortConfig.key === 'activeShifts' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'nightShifts' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'nightShifts', direction: dir });
                    }}
                    className="px-2 py-2 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Night {fairnessSortConfig.key === 'nightShifts' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'weekendShifts' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'weekendShifts', direction: dir });
                    }}
                    className="px-2 py-2 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Weekend {fairnessSortConfig.key === 'weekendShifts' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'publicHolidayShifts' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'publicHolidayShifts', direction: dir });
                    }}
                    className="px-2 py-2 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Holiday {fairnessSortConfig.key === 'publicHolidayShifts' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th
                    onClick={() => {
                      const dir = fairnessSortConfig.key === 'totalLeave' && fairnessSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setFairnessSortConfig({ key: 'totalLeave', direction: dir });
                    }}
                    className="px-2 py-2 font-extrabold uppercase tracking-wider border-l border-slate-100 cursor-pointer hover:bg-slate-100 text-[9px] sm:text-[10px]"
                  >
                    Leave {fairnessSortConfig.key === 'totalLeave' ? (fairnessSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedFairnessSummaries.map((entry) => {
                  let statusBg = 'bg-slate-100 text-slate-800 border-slate-200';
                  if (entry.fairnessStatus === 'Balanced') {
                    statusBg = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                  } else if (entry.fairnessStatus === 'Watch') {
                    statusBg = 'bg-amber-50 text-amber-705 border-amber-100';
                  } else if (entry.fairnessStatus === 'Imbalanced') {
                    statusBg = 'bg-rose-50 text-rose-700 border-rose-100';
                  }
                  
                  return (
                    <tr
                      key={entry.nameKey}
                      onClick={() => setSelectedDoctor(entry)}
                      className={`hover:bg-slate-50/70 border-b border-slate-100 transition cursor-pointer ${
                        entry.isInactive ? 'opacity-60 bg-slate-50/30' : ''
                      }`}
                    >
                      <th className="sticky left-0 z-10 px-3 py-2 text-left font-semibold text-slate-800 shadow-sm ring-1 ring-slate-100 bg-white">
                        {entry.name.toUpperCase()}
                      </th>
                      <td className="px-2 py-2 border-l border-slate-100 font-extrabold text-slate-900">
                        {entry.fairnessScore}
                      </td>
                      <td className="px-2 py-2 border-l border-slate-100">
                        <span className={`inline-block border px-1.5 py-0.5 rounded-full text-[9px] font-bold ${statusBg}`}>
                          {entry.fairnessStatus}
                        </span>
                      </td>
                      <td className="px-2 py-2 border-l border-slate-100 text-slate-650 font-semibold">
                        {entry.activeShifts}
                      </td>
                      <td className="px-2 py-2 border-l border-slate-100 text-slate-650 font-semibold">
                        {entry.nightShifts}
                      </td>
                      <td className="px-2 py-2 border-l border-slate-100 text-slate-650 font-semibold">
                        {entry.weekendShifts}
                      </td>
                      <td className="px-2 py-2 border-l border-slate-100 text-slate-650 font-semibold">
                        {entry.publicHolidayShifts}
                      </td>
                      <td className="px-2 py-2 border-l border-slate-100 text-slate-650 font-semibold">
                        {entry.totalLeave}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Fairness Ranking Standings Cards */}
        <div className="rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div className="w-full">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
              <span>⚖️</span> Fairness Standings
            </h3>
            {fairnessStandings ? (
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-2xl p-2.5">
                  <span className="text-[8px] font-extrabold text-emerald-600 uppercase tracking-wider block">Most Balanced</span>
                  <span className="text-xs font-bold text-emerald-950 mt-1 block truncate">
                    {fairnessStandings.mostBalanced.name.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-500 font-medium">Score: {fairnessStandings.mostBalanced.fairnessScore}</span>
                </div>
                <div className="bg-rose-50/50 border border-rose-100/50 rounded-2xl p-2.5">
                  <span className="text-[8px] font-extrabold text-rose-600 uppercase tracking-wider block">Needs Review</span>
                  <span className="text-xs font-bold text-rose-955 mt-1 block truncate">
                    {fairnessStandings.needsReview.name.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-500 font-medium">Score: {fairnessStandings.needsReview.fairnessScore}</span>
                </div>
                <div className="bg-indigo-50/50 border border-indigo-100/50 rounded-2xl p-2.5">
                  <span className="text-[8px] font-extrabold text-indigo-600 uppercase tracking-wider block">Highest Night Load</span>
                  <span className="text-xs font-bold text-indigo-955 mt-1 block truncate">
                    {fairnessStandings.highestNight.name.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-500 font-medium">Nights: {fairnessStandings.highestNight.nightShifts}</span>
                </div>
                <div className="bg-amber-50/50 border border-amber-100/50 rounded-2xl p-2.5">
                  <span className="text-[8px] font-extrabold text-amber-600 uppercase tracking-wider block">Highest Weekend Load</span>
                  <span className="text-xs font-bold text-amber-955 mt-1 block truncate">
                    {fairnessStandings.highestWeekend.name.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-500 font-medium">Weekends: {fairnessStandings.highestWeekend.weekendShifts}</span>
                </div>
                <div className="bg-teal-50/50 border border-teal-100/50 rounded-2xl p-2.5">
                  <span className="text-[8px] font-extrabold text-teal-600 uppercase tracking-wider block">Highest Holiday Load</span>
                  <span className="text-xs font-bold text-teal-955 mt-1 block truncate">
                    {fairnessStandings.highestHoliday.name.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-500 font-medium">Holidays: {fairnessStandings.highestHoliday.publicHolidayShifts}</span>
                </div>
                <div className="bg-slate-50 border border-slate-150/60 rounded-2xl p-2.5">
                  <span className="text-[8px] font-extrabold text-slate-500 uppercase tracking-wider block">Lowest Active Load</span>
                  <span className="text-xs font-bold text-slate-950 mt-1 block truncate">
                    {fairnessStandings.lowestActive.name.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-500 font-medium">Active: {fairnessStandings.lowestActive.activeShifts}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-12 text-center">No standing data available.</p>
            )}
          </div>
        </div>
      </div>

      {/* 🚨 Coverage Issues Panel */}
      <div className="rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm mb-8 text-left">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
          <span>🚨</span> Roster Coverage &amp; Threshold Alerts
        </h3>
        
        {coverageIssues.length === 0 ? (
          <div className="py-8 text-center text-emerald-600 font-bold flex flex-col items-center justify-center gap-2 text-xs">
            <span className="text-2xl">✅</span>
            <span>No coverage issues detected for this month.</span>
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-100 pr-2 custom-scrollbar">
            {coverageIssues.map((issueItem) => {
              const isHigh = issueItem.severity === 'high';
              const isMedium = issueItem.severity === 'medium';
              const cardBg = isHigh ? 'bg-rose-50/30' : isMedium ? 'bg-amber-50/30' : 'bg-slate-50/30';
              const severityBadge = isHigh ? (
                <span className="bg-rose-100 text-rose-800 text-[8px] px-1.5 py-0.5 rounded-full font-bold">HIGH</span>
              ) : isMedium ? (
                <span className="bg-amber-100 text-amber-800 text-[8px] px-1.5 py-0.5 rounded-full font-bold">MEDIUM</span>
              ) : (
                <span className="bg-slate-100 text-slate-800 text-[8px] px-1.5 py-0.5 rounded-full font-bold">LOW</span>
              );

              return (
                <div key={issueItem.date} className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-3 rounded-2xl ${cardBg} mb-2 border border-slate-100/70`}>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-850 font-extrabold text-xs">{issueItem.label}</span>
                    {severityBadge}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {issueItem.issues.map((msg, i) => {
                      let badgeStyle = 'bg-slate-100 text-slate-700';
                      if (msg.includes('below minimum') || msg.includes('above maximum')) {
                        badgeStyle = 'bg-rose-100 border border-rose-200 text-rose-800';
                      } else if (msg.includes('Empty slots')) {
                        badgeStyle = 'bg-amber-100 border border-amber-200 text-amber-800';
                      } else if (msg.includes('Leave above maximum')) {
                        badgeStyle = 'bg-orange-100 border border-orange-200 text-orange-850';
                      }

                      return (
                        <span key={i} className={`text-[9px] font-bold rounded-lg px-2 py-0.5 ${badgeStyle}`}>
                          {msg}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 📅 Year-to-Date Jan-Jun Section */}
      <div className="rounded-3xl border border-slate-150/70 bg-white p-6 shadow-sm mb-8 text-left">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3 mb-6">
          <span>📅</span> Year-to-Date Performance (Jan–Jun)
        </h3>

        {!ytdStats || ytdStats.perMonthTotals.length === 0 ? (
          <div className="py-12 text-center text-slate-400 italic text-xs">
            No historical roster records available for Jan–Jun of the current year.
          </div>
        ) : (
          <div>
            {/* YTD summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-4">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">YTD Active Shifts</span>
                <span className="text-2xl font-black text-indigo-900 mt-2 block">{ytdStats.totalActiveShifts}</span>
              </div>
              <div className="rounded-2xl bg-rose-50 border border-rose-100 p-4">
                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block">YTD Night Shifts</span>
                <span className="text-2xl font-black text-rose-900 mt-2 block">{ytdStats.totalNightShifts}</span>
              </div>
              <div className="rounded-2xl bg-purple-50 border border-purple-100/40 p-4">
                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">YTD Leave Days</span>
                <span className="text-2xl font-black text-purple-900 mt-2 block">{ytdStats.totalLeaveDays}</span>
              </div>
              <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">YTD Weekend Duties</span>
                <span className="text-2xl font-black text-emerald-900 mt-2 block">{ytdStats.totalWeekendShifts}</span>
              </div>
              <div className="rounded-2xl bg-teal-50 border border-teal-100 p-4">
                <span className="text-[10px] font-bold text-teal-500 uppercase tracking-wider block">YTD Weekend Leaves</span>
                <span className="text-2xl font-black text-teal-900 mt-2 block">{ytdStats.totalWeekendLeaves || 0}</span>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {/* Monthly trends table */}
              <div className="md:col-span-1 border border-slate-100/70 rounded-3xl p-4 bg-slate-50/50">
                <h4 className="text-[10px] font-bold text-slate-550 uppercase tracking-wider mb-3">Monthly Trends</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-[10px] text-center">
                    <thead>
                      <tr className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200">
                        <th className="py-2 text-left pl-2">Month</th>
                        <th className="py-2">Active</th>
                        <th className="py-2">Night</th>
                        <th className="py-2">Leave</th>
                        <th className="py-2">Weekend</th>
                        <th className="py-2">W. Leave</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {ytdStats.perMonthTotals.map((monthRow) => (
                        <tr key={monthRow.month} className="hover:bg-slate-50">
                          <td className="py-2 text-left pl-2 font-bold text-slate-700">{monthRow.month}</td>
                          <td className="py-2 font-semibold text-slate-800">{monthRow.active}</td>
                          <td className="py-2 font-semibold text-slate-800">{monthRow.night}</td>
                          <td className="py-2 font-semibold text-slate-800">{monthRow.leave}</td>
                          <td className="py-2 font-semibold text-slate-800">{monthRow.weekend}</td>
                          <td className="py-2 font-semibold text-slate-800">{monthRow.weekendLeaves || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* YTD member ranking table */}
              <div className="md:col-span-2 border border-slate-100/70 rounded-3xl p-4">
                <h4 className="text-[10px] font-bold text-slate-550 uppercase tracking-wider mb-3">Overall YTD Member Rankings</h4>
                <div className="overflow-x-auto max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                  <table className="min-w-full text-[10px] text-center border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 border-b border-slate-150 select-none">
                        <th
                          onClick={() => {
                            const dir = ytdSortConfig.key === 'name' && ytdSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setYtdSortConfig({ key: 'name', direction: dir });
                          }}
                          className="sticky left-0 z-10 bg-slate-50 py-2 text-left pl-2 font-bold cursor-pointer hover:bg-slate-100 border-b border-slate-150"
                        >
                          Name {ytdSortConfig.key === 'name' ? (ytdSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                        <th
                          onClick={() => {
                            const dir = ytdSortConfig.key === 'activeShifts' && ytdSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setYtdSortConfig({ key: 'activeShifts', direction: dir });
                          }}
                          className="py-2 font-bold cursor-pointer hover:bg-slate-100 border-l border-slate-100 border-b border-slate-150 bg-indigo-50/20 text-indigo-900"
                        >
                          Active {ytdSortConfig.key === 'activeShifts' ? (ytdSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                        <th
                          onClick={() => {
                            const dir = ytdSortConfig.key === 'nightShifts' && ytdSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setYtdSortConfig({ key: 'nightShifts', direction: dir });
                          }}
                          className="py-2 font-bold cursor-pointer hover:bg-slate-100 border-l border-slate-100 border-b border-slate-150 bg-rose-50/20 text-rose-900"
                        >
                          Night {ytdSortConfig.key === 'nightShifts' ? (ytdSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                        <th
                          onClick={() => {
                            const dir = ytdSortConfig.key === 'weekendShifts' && ytdSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setYtdSortConfig({ key: 'weekendShifts', direction: dir });
                          }}
                          className="py-2 font-bold cursor-pointer hover:bg-slate-100 border-l border-slate-100 border-b border-slate-150 bg-emerald-50/20 text-emerald-900"
                        >
                          Weekend {ytdSortConfig.key === 'weekendShifts' ? (ytdSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                        <th
                          onClick={() => {
                            const dir = ytdSortConfig.key === 'weekendLeaves' && ytdSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setYtdSortConfig({ key: 'weekendLeaves', direction: dir });
                          }}
                          className="py-2 font-bold cursor-pointer hover:bg-slate-100 border-l border-slate-100 border-b border-slate-150 bg-teal-50/10 text-teal-900"
                        >
                          W. Leave {ytdSortConfig.key === 'weekendLeaves' ? (ytdSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                        <th
                          onClick={() => {
                            const dir = ytdSortConfig.key === 'publicHolidayShifts' && ytdSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setYtdSortConfig({ key: 'publicHolidayShifts', direction: dir });
                          }}
                          className="py-2 font-bold cursor-pointer hover:bg-slate-100 border-l border-slate-100 border-b border-slate-150 bg-teal-50/20 text-teal-900"
                        >
                          Holiday {ytdSortConfig.key === 'publicHolidayShifts' ? (ytdSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                        <th
                          onClick={() => {
                            const dir = ytdSortConfig.key === 'leaveDays' && ytdSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setYtdSortConfig({ key: 'leaveDays', direction: dir });
                          }}
                          className="py-2 font-bold cursor-pointer hover:bg-slate-100 border-l border-slate-100 border-b border-slate-150 bg-purple-50/20 text-purple-905"
                        >
                          Leave {ytdSortConfig.key === 'leaveDays' ? (ytdSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {sortedYtdMemberStats.map((memberRow) => (
                        <tr key={memberRow.name} className="hover:bg-slate-50 border-b border-slate-100">
                          <td className="sticky left-0 bg-white py-2 text-left pl-2 font-bold text-slate-700 truncate max-w-[100px] shadow-sm ring-1 ring-slate-100">
                            {memberRow.name.toUpperCase()}
                          </td>
                          <td className="py-2 border-l border-slate-100 text-slate-800 font-semibold">{memberRow.activeShifts}</td>
                          <td className="py-2 border-l border-slate-100 text-slate-800 font-semibold">{memberRow.nightShifts}</td>
                          <td className="py-2 border-l border-slate-100 text-slate-800 font-semibold">{memberRow.weekendShifts}</td>
                          <td className="py-2 border-l border-slate-100 text-slate-800 font-semibold bg-teal-50/10">{memberRow.weekendLeaves || 0}</td>
                          <td className="py-2 border-l border-slate-100 text-slate-800 font-semibold">{memberRow.publicHolidayShifts}</td>
                          <td className="py-2 border-l border-slate-100 text-slate-800 font-semibold">{memberRow.leaveDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
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

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
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
                <div className="bg-teal-50/50 border border-teal-100/60 rounded-2xl p-3">
                  <span className="text-[9px] font-extrabold text-teal-500 uppercase tracking-wider block">Weekend Leaves</span>
                  <span className="text-xl font-black text-teal-900 mt-1 block">{selectedDoctor.weekendLeavesCount || 0}</span>
                </div>
                <div className="bg-rose-50/50 border border-rose-100/60 rounded-2xl p-3 col-span-2">
                  <span className="text-[9px] font-extrabold text-rose-500 uppercase tracking-wider block">Holiday Duties</span>
                  <span className="text-xl font-black text-rose-900 mt-1 block">{selectedDoctor.holidayShiftsCount}</span>
                </div>
              </div>

              {/* Fairness status card */}
              <div className="flex justify-between items-center bg-slate-50 border border-slate-100 rounded-2xl p-3">
                <div>
                  <span className="text-[8px] font-extrabold text-slate-400 uppercase tracking-wider block">Fairness Index</span>
                  <span className="text-xs font-bold text-slate-805 mt-0.5 block">Score: {selectedDoctor.fairnessScore || 0}/100</span>
                </div>
                <div>
                  {selectedDoctor.fairnessStatus === 'Balanced' ? (
                    <span className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">Balanced</span>
                  ) : selectedDoctor.fairnessStatus === 'Watch' ? (
                    <span className="bg-amber-50 border border-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">Watch</span>
                  ) : (
                    <span className="bg-rose-50 border border-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full">Imbalanced</span>
                  )}
                </div>
              </div>

              {/* Shift Mix Percentages */}
              <div>
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Shift Mix Ratios</h4>
                <div className="space-y-3 bg-slate-50/50 border border-slate-100 rounded-2xl p-3">
                  {/* Active % */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                      <span>Active Shifts</span>
                      <span className="font-bold">{selectedDoctor.activePercentage || 0}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                      <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${selectedDoctor.activePercentage || 0}%` }} />
                    </div>
                  </div>
                  {/* Leave % */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                      <span>Leaves</span>
                      <span className="font-bold">{selectedDoctor.leavePercentage || 0}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                      <div className="bg-purple-600 h-full rounded-full transition-all duration-500" style={{ width: `${selectedDoctor.leavePercentage || 0}%` }} />
                    </div>
                  </div>
                  {/* Night % */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                      <span>Night Shift Load</span>
                      <span className="font-bold">{selectedDoctor.nightPercentage || 0}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                      <div className="bg-rose-500 h-full rounded-full transition-all duration-500" style={{ width: `${selectedDoctor.nightPercentage || 0}%` }} />
                    </div>
                  </div>
                  {/* Weekend % */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                      <span>Weekend Duty Load</span>
                      <span className="font-bold">{selectedDoctor.weekendPercentage || 0}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                      <div className="bg-emerald-600 h-full rounded-full transition-all duration-500" style={{ width: `${selectedDoctor.weekendPercentage || 0}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Shift Breakdown List and Per-Shift Percentages */}
              <div>
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Shift Type Distribution (%)</h4>
                <div className="rounded-2xl border border-slate-100 divide-y divide-slate-100 max-h-[160px] overflow-y-auto custom-scrollbar">
                  {dynamicShiftColumns.map((col) => {
                    const count = selectedDoctor.counts[col] || 0;
                    const pct = selectedDoctor.perShiftPercentages?.[col] || 0;
                    if (count === 0) return null;
                    return (
                      <div key={col} className="py-2 px-3">
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="font-bold text-slate-700">{col} ({count})</span>
                          <span className="font-black text-slate-900">{pct}%</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-teal-500 h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {selectedDoctor.counts.TOTAL_LEAVE > 0 && (
                    <div className="py-2.5 px-3 bg-slate-50/50">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-purple-750 font-extrabold uppercase tracking-wide">Combined Leaves ({selectedDoctor.counts.TOTAL_LEAVE})</span>
                        <span className="text-purple-900 font-black">{selectedDoctor.leavePercentage}%</span>
                      </div>
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
