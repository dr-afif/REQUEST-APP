import React, { useMemo } from 'react';

/**
 * Current Roster View:
 * Authoritative working roster.
 * Differentiates from Planned with subtle "Changed" badge per cell key.
 * Allows authorized admins to amend/swap when in PUBLISHED or AMENDED state.
 * Read-only for viewers or when CLOSED/DRAFT.
 */
export default function CurrentRosterView({
  currentAssignments = [],
  plannedAssignments = [],
  period,
  isAdmin = false,
  lifecycleState = 'PUBLISHED',
  mutationsEnabled = false,
  onSelectCellForAmend
}) {
  const canAmend = Boolean(
    isAdmin &&
    mutationsEnabled &&
    ['PUBLISHED', 'AMENDED'].includes(String(lifecycleState || '').toUpperCase())
  );

  // Index planned assignments by authoritative (PersonId + Date + DutyDomain)
  const plannedMap = useMemo(() => {
    const map = new Map();
    plannedAssignments.forEach((a) => {
      const key = `${a.personId}::${a.date}::${a.dutyDomain}`;
      map.set(key, a.shiftCode || '');
    });
    return map;
  }, [plannedAssignments]);

  // Group current assignments by Person & Domain
  const groupedByPerson = useMemo(() => {
    const map = new Map();
    currentAssignments.forEach((a) => {
      const groupKey = `${a.personId}::${a.dutyDomain}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          personId: a.personId,
          personNameSnapshot: a.personNameSnapshot || a.personId,
          dutyDomain: a.dutyDomain,
          cells: {}
        });
      }
      map.get(groupKey).cells[a.date] = a;
    });
    return Array.from(map.values()).sort((a, b) => {
      return (a.dutyDomain || '').localeCompare(b.dutyDomain || '') ||
        (a.personNameSnapshot || '').localeCompare(b.personNameSnapshot || '');
    });
  }, [currentAssignments]);

  // Extract unique sorted dates for header
  const sortedDates = useMemo(() => {
    const dates = new Set();
    currentAssignments.forEach((a) => {
      if (a.date) dates.add(a.date);
    });
    if (dates.size === 0) {
      plannedAssignments.forEach((a) => {
        if (a.date) dates.add(a.date);
      });
    }
    return Array.from(dates).sort();
  }, [currentAssignments, plannedAssignments]);

  return (
    <div className="space-y-4" aria-label="Current Authoritative Roster">
      {/* Top Banner / Guidance */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 gap-2">
        <div>
          <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
            <span>📋</span>
            <span>Authoritative Working Roster</span>
          </h4>
          <p className="text-xs text-indigo-800/80 mt-0.5">
            {canAmend
              ? 'Click any duty cell to modify shift (Admin Correction) or swap assignments.'
              : 'Displaying authoritative schedule. Amendments require administrator authorization.'}
          </p>
        </div>

        {canAmend && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 self-start sm:self-auto">
            <span>✏️</span> Amendment Mode Active
          </span>
        )}
      </div>

      {currentAssignments.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-slate-300 bg-white">
          <p className="text-sm font-semibold text-slate-700">No current assignments found for {period}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="p-3 font-bold sticky left-0 bg-slate-50 min-w-[170px] z-10 border-r border-slate-200">
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
                        className="p-2 font-bold text-center min-w-[50px] border-r border-slate-200"
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
                      <div className="text-slate-900 font-bold">{row.personNameSnapshot}</div>
                    </td>
                    <td className="p-2 text-center border-r border-slate-200">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                        {row.dutyDomain}
                      </span>
                    </td>
                    {sortedDates.map((date) => {
                      const assignment = row.cells[date];
                      const currentShift = assignment?.shiftCode || '';
                      const key = `${row.personId}::${date}::${row.dutyDomain}`;
                      const plannedShift = plannedMap.get(key);

                      // Check whether cell differs from Planned
                      const isChanged = plannedShift !== undefined && plannedShift !== currentShift;

                      const cellData = {
                        personId: row.personId,
                        personNameSnapshot: row.personNameSnapshot,
                        date,
                        dutyDomain: row.dutyDomain,
                        currentShiftCode: currentShift,
                        assignmentId: assignment?.assignmentId || null
                      };

                      return (
                        <td
                          key={date}
                          id={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          data-testid={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          className={`p-1.5 text-center border-r border-slate-200 align-middle transition ${
                            isChanged ? 'bg-amber-50/50' : ''
                          }`}
                        >
                          <div className="flex flex-col items-center justify-center gap-0.5 min-h-[36px]">
                            {canAmend ? (
                              <button
                                type="button"
                                id={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                data-testid={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                onClick={() => onSelectCellForAmend(cellData)}
                                title={`Click to amend assignment for ${row.personNameSnapshot} on ${date}`}
                                className="w-full h-full py-1 px-1 rounded-md text-xs font-mono font-bold text-slate-800 hover:bg-indigo-100 hover:text-indigo-800 transition active:scale-95 cursor-pointer"
                              >
                                {currentShift || '—'}
                              </button>
                            ) : (
                              <span className="font-mono text-xs font-semibold text-slate-800">
                                {currentShift || '—'}
                              </span>
                            )}

                            {isChanged && (
                              <span
                                className="changed-badge inline-block text-[9px] font-extrabold text-amber-700 bg-amber-100/80 px-1 py-0.2 rounded border border-amber-300 shadow-2xs leading-none"
                                title={`Original Planned: ${plannedShift || 'OFF'}`}
                              >
                                Changed
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
        </div>
      )}
    </div>
  );
}
