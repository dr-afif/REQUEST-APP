import React, { useMemo } from 'react';
import { getHolidayName } from '../../../utils/holidays.js';

/**
 * Planned Roster View:
 * Shows the immutable roster as originally published.
 * Visually and behaviorally read-only.
 * No edit triggers, no mutation popovers.
 */
export default function PlannedRosterView({
  assignments = [],
  period
}) {
  // Group assignments by Person
  const groupedByPerson = useMemo(() => {
    const map = new Map();
    assignments.forEach((a) => {
      const pId = a.personId;
      if (!map.has(pId)) {
        map.set(pId, {
          personId: pId,
          personNameSnapshot: a.personNameSnapshot || pId,
          dutyDomain: a.dutyDomain,
          dates: {}
        });
      }
      map.get(pId).dates[a.date] = a.shiftCode;
    });
    return Array.from(map.values()).sort((a, b) => {
      return (a.dutyDomain || '').localeCompare(b.dutyDomain || '') ||
        (a.personNameSnapshot || '').localeCompare(b.personNameSnapshot || '');
    });
  }, [assignments]);

  // Extract unique sorted dates for header
  const sortedDates = useMemo(() => {
    const dates = new Set();
    assignments.forEach((a) => {
      if (a.date) dates.add(a.date);
    });
    return Array.from(dates).sort();
  }, [assignments]);

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

  return (
    <div
      id="planned-roster-view"
      data-testid="planned-roster-view"
      className="space-y-4"
      aria-label="Planned Roster Snapshot"
    >
      {/* Immutability Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3.5 lg:p-4 rounded-2xl bg-slate-100 border border-slate-300 gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-200 text-slate-700 text-lg font-bold">
            🔒
          </span>
          <div>
            <h4 className="text-sm font-bold text-slate-800">
              Planned Snapshot — Originally Published Roster
            </h4>
            <p className="text-xs text-slate-500">
              This snapshot is immutable and locked for historical reference. Modifications are not allowed.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700 border border-slate-300 self-start sm:self-auto">
          Read-Only Snapshot
        </span>
      </div>

      {assignments.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-slate-300 bg-white">
          <p className="text-sm font-semibold text-slate-700">No planned assignments found for {period}</p>
        </div>
      ) : (
        <div
          className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden roster-desktop-grid-container"
          id="planned-roster-grid-container"
          data-testid="planned-roster-grid-container"
        >
          <div
            className="overflow-auto max-h-[calc(100vh-220px)] lg:max-h-[calc(100vh-190px)] roster-scroll-viewport focus:outline-none"
            tabIndex={0}
            aria-label="Planned roster table scroll area"
          >
            <table className="w-full text-left text-xs border-collapse border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 bg-slate-50 shadow-xs">
                <tr className="bg-slate-50 text-slate-600">
                  <th
                    className="p-2 lg:p-2.5 font-bold sticky left-0 top-0 bg-slate-50 min-w-[150px] lg:min-w-[160px] z-30 border-r border-b border-slate-200 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
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
                        className={`p-1 lg:p-1.5 font-bold text-center min-w-[48px] lg:min-w-[46px] max-w-[60px] border-r border-b border-slate-200 sticky top-0 z-20 transition-colors ${
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
                            data-testid={`header-holiday-planned-${d}`}
                          >
                            PH
                          </span>
                        )}
                        {meta.isToday && (
                          <span
                            className="inline-block text-[8px] font-bold text-indigo-700 bg-indigo-100 px-1 py-0.2 rounded border border-indigo-300 leading-none mt-0.5"
                            data-testid={`header-today-planned-${d}`}
                          >
                            Today
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {groupedByPerson.map((row) => (
                  <tr key={`${row.personId}::${row.dutyDomain}`} className="hover:bg-slate-50/50">
                    <td className="p-2 lg:p-2.5 font-semibold sticky left-0 bg-white z-10 border-r border-b border-slate-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <div className="truncate max-w-[130px] lg:max-w-[145px]" title={row.personNameSnapshot}>
                        {row.personNameSnapshot}
                      </div>
                    </td>
                    <td className="p-1.5 lg:p-2 text-center border-r border-b border-slate-100 bg-white">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                        {row.dutyDomain}
                      </span>
                    </td>
                    {sortedDates.map((d) => {
                      const shift = row.dates[d] || '—';
                      const meta = dateMetaMap.get(d) || { isWeekend: false, isHoliday: false, isToday: false };
                      const cellAria = `${row.personNameSnapshot}, ${d}, Planned: ${shift}`;
                      const cellBg = meta.isHoliday
                        ? 'bg-rose-50/20'
                        : meta.isWeekend
                        ? 'bg-slate-50/40'
                        : 'bg-white';

                      return (
                        <td
                          key={d}
                          id={`cell-planned-${row.personId}-${d}-${row.dutyDomain}`}
                          data-testid={`cell-planned-${row.personId}-${d}-${row.dutyDomain}`}
                          aria-label={cellAria}
                          className={`p-1.5 lg:p-2 text-center border-r border-b border-slate-100 font-mono text-[11px] lg:text-xs font-semibold ${cellBg} ${
                            meta.isToday ? 'ring-1 ring-inset ring-indigo-300/60' : ''
                          }`}
                        >
                          {shift}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
