import React, { useMemo } from 'react';

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

  return (
    <div
      id="planned-roster-view"
      data-testid="planned-roster-view"
      className="space-y-4"
      aria-label="Planned Roster Snapshot"
    >
      {/* Immutability Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-2xl bg-slate-100 border border-slate-300 gap-2">
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
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="p-3 font-bold sticky left-0 bg-slate-50 min-w-[160px] z-10 border-r border-slate-200">
                    Doctor / Staff
                  </th>
                  <th className="p-3 font-bold min-w-[70px] text-center border-r border-slate-200">
                    Domain
                  </th>
                  {sortedDates.map((d) => {
                    const dayNum = d.split('-')[2];
                    return (
                      <th
                        key={d}
                        className="p-2 font-bold text-center min-w-[45px] border-r border-slate-200"
                        title={d}
                      >
                        {dayNum}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {groupedByPerson.map((row) => (
                  <tr key={`${row.personId}::${row.dutyDomain}`} className="hover:bg-slate-50/50">
                    <td className="p-3 font-semibold sticky left-0 bg-white z-10 border-r border-slate-200">
                      <div>{row.personNameSnapshot}</div>
                    </td>
                    <td className="p-2 text-center border-r border-slate-200">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                        {row.dutyDomain}
                      </span>
                    </td>
                    {sortedDates.map((d) => {
                      const shift = row.dates[d] || '—';
                      return (
                        <td
                          key={d}
                          id={`cell-planned-${row.personId}-${d}-${row.dutyDomain}`}
                          data-testid={`cell-planned-${row.personId}-${d}-${row.dutyDomain}`}
                          className="p-2 text-center border-r border-slate-200 font-mono text-[11px]"
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
