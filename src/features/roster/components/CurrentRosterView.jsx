import React, { useMemo } from 'react';

/**
 * Current Roster View:
 * Authoritative working roster.
 * Reflects:
 *   - Working assignments
 *   - Active absences (with coverage state: Uncovered vs Covered by Dr X)
 *   - Replacement covering duties (with covering lineage: Covering Dr Y)
 *   - Changed badge for mutated cells
 * Exposes admin actions:
 *   - "Record absence" on working assignments
 *   - "Assign replacement" on uncovered absent duties
 *   - Shift amendments / swaps
 * Read-only for viewers or when CLOSED/DRAFT.
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
  onOpenEntitlementsPanel
}) {
  const canAmend = Boolean(
    isAdmin &&
    mutationsEnabled &&
    ['PUBLISHED', 'AMENDED'].includes(String(lifecycleState || '').toUpperCase())
  );

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

  // Group current assignments by Person & Domain
  const groupedByPerson = useMemo(() => {
    const map = new Map();
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
      return (a.dutyDomain || '').localeCompare(b.dutyDomain || '') ||
        (a.personNameSnapshot || '').localeCompare(b.personNameSnapshot || '');
    });
  }, [currentAssignments, peopleMap]);

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
    <div className="space-y-4" aria-label="Current Authoritative Roster" id="current-roster-view">
      {/* Top Banner / Guidance */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 gap-2">
        <div>
          <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
            <span>📋</span>
            <span>Authoritative Working Roster</span>
          </h4>
          <p className="text-xs text-indigo-800/80 mt-0.5">
            {canAmend
              ? 'Click duty cells to modify shifts, record absences, assign replacements, or use entitlements.'
              : 'Displaying authoritative schedule. Amendments require administrator authorization.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 active:scale-95 transition shadow-2xs"
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
        </div>
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
                        className="p-2 font-bold text-center min-w-[65px] border-r border-slate-200"
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
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-slate-900 font-bold">{row.personNameSnapshot}</span>
                        {row.dutyDomain !== 'EP' && onSelectPersonForEntitlement && (
                          <button
                            type="button"
                            id={`btn-view-entitlements-${row.personId}`}
                            data-testid={`btn-view-entitlements-${row.personId}`}
                            onClick={() => onSelectPersonForEntitlement(row.personId)}
                            title={`View entitlements for ${row.personNameSnapshot}`}
                            className="text-[10px] font-bold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-1.5 py-0.5 rounded border border-teal-200 transition cursor-pointer"
                          >
                            ⚖️
                          </button>
                        )}
                      </div>
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

                      // Semantic indicators
                      const isAbsence = assignment?.source === 'ABSENCE' ||
                        assignment?.coverageStatus === 'UNCOVERED' ||
                        (assignment?.coverageStatus === 'COVERED' && assignment?.absenceId);
                      const isUncovered = isAbsence && assignment?.coverageStatus !== 'COVERED';
                      const isCoveredAbsence = isAbsence && assignment?.coverageStatus === 'COVERED';
                      const isCovering = assignment?.source === 'REPLACEMENT' || Boolean(assignment?.coveringForPersonId);
                      const isEntitlementDuty = currentShift === 'GOFF' || currentShift === 'GHKA';
                      const isWorking = currentShift && currentShift !== 'OFF' && currentShift !== 'HKA' && !isEntitlementDuty && !isAbsence && !isCovering;

                      // Check whether cell differs from Planned
                      const isChanged = plannedShift !== undefined && plannedShift !== currentShift;

                      // Names for coverage relationships
                      let coveringDoctorName = '';
                      if (isCoveredAbsence && assignment?.replacementId) {
                        const replAssign = currentAssignments.find(
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
                        personId: row.personId,
                        personNameSnapshot: row.personNameSnapshot,
                        date,
                        dutyDomain: row.dutyDomain,
                        currentShiftCode: currentShift,
                        assignmentId: assignment?.assignmentId || null,
                        absenceId: assignment?.absenceId || null,
                        originalAssignmentId: assignment?.originalAssignmentId || assignment?.assignmentId || null,
                        originalShiftCode: assignment?.originalShiftCode || plannedShift || currentShift,
                        absentPersonId: row.personId,
                        absentPersonName: row.personNameSnapshot,
                        absenceType: isAbsence ? currentShift : null
                      };

                      return (
                        <td
                          key={date}
                          id={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          data-testid={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          className={`p-1 text-center border-r border-slate-200 align-middle transition ${
                            isUncovered
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
                              : ''
                          }`}
                        >
                          <div className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] py-1">
                            {/* Shift Code / Absence Type Display */}
                            {canAmend ? (
                              <button
                                type="button"
                                id={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                data-testid={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                onClick={() => {
                                  if (isUncovered && onSelectDutyForReplacement) {
                                    onSelectDutyForReplacement(cellData);
                                  } else if (onSelectCellForAmend) {
                                    onSelectCellForAmend(cellData);
                                  }
                                }}
                                title={`Assignment: ${currentShift || '—'}`}
                                className={`w-full py-0.5 px-1 rounded-md text-xs font-mono font-bold transition active:scale-95 cursor-pointer ${
                                  isUncovered
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
                              <span className={`font-mono text-xs font-bold ${
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
                              }`}>
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
                                title="Public-holiday replacement entitlement used"
                                data-testid={`badge-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                              >
                                GHKA
                              </span>
                            )}

                            {currentShift === 'HKA' && (
                              <span
                                id={`badge-hka-${row.personId}-${date}-${row.dutyDomain}`}
                                className="inline-block text-[9px] font-bold text-slate-700 bg-slate-100 px-1 py-0.2 rounded border border-slate-300 leading-tight"
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
                                    className="text-[9px] font-bold text-rose-700 hover:text-rose-900 bg-white hover:bg-rose-50 px-1 py-0.5 rounded border border-rose-300 shadow-2xs transition active:scale-95 cursor-pointer"
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
                                className="text-[9px] font-semibold text-slate-500 hover:text-indigo-700 hover:underline transition mt-0.5 leading-none cursor-pointer"
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
                                  className="text-[9px] font-bold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-1 py-0.2 rounded border border-teal-200 transition leading-none cursor-pointer"
                                >
                                  Use GOFF
                                </button>
                                <button
                                  type="button"
                                  id={`btn-use-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                                  data-testid={`btn-use-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                                  onClick={() => onSelectDutyForEntitlement(cellData, 'GHKA')}
                                  title={`Use GHKA for ${row.personNameSnapshot} on ${date}`}
                                  className="text-[9px] font-bold text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 px-1 py-0.2 rounded border border-amber-200 transition leading-none cursor-pointer"
                                >
                                  Use GHKA
                                </button>
                              </div>
                            )}

                            {/* Changed Badge */}
                            {isChanged && !isAbsence && !isCovering && !isEntitlementDuty && (
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
