import React, { useMemo } from 'react';
import { getHolidayName } from '../../../utils/holidays.js';

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
    <div className="space-y-4" aria-label="Current Authoritative Roster" id="current-roster-view">
      {/* Top Banner / Guidance */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3.5 lg:p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 gap-2">
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
        <div
          className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden roster-desktop-grid-container"
          id="current-roster-grid-container"
          data-testid="current-roster-grid-container"
        >
          <div
            className="overflow-auto max-h-[calc(100vh-220px)] lg:max-h-[calc(100vh-190px)] roster-scroll-viewport focus:outline-none"
            tabIndex={0}
            aria-label="Current roster table scroll area"
          >
            <table className="w-full text-left text-xs border-collapse border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 bg-slate-50 shadow-xs">
                <tr className="bg-slate-50 text-slate-600">
                  <th
                    className="p-2 lg:p-2.5 font-bold sticky left-0 top-0 bg-slate-50 min-w-[150px] lg:min-w-[170px] z-30 border-r border-b border-slate-200 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
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
                        className={`p-1 lg:p-1.5 font-bold text-center min-w-[48px] lg:min-w-[46px] max-w-[65px] border-r border-b border-slate-200 sticky top-0 z-20 transition-colors ${
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
                            data-testid={`header-holiday-${d}`}
                          >
                            PH
                          </span>
                        )}
                        {meta.isToday && (
                          <span
                            className="inline-block text-[8px] font-bold text-indigo-700 bg-indigo-100 px-1 py-0.2 rounded border border-indigo-300 leading-none mt-0.5"
                            data-testid={`header-today-${d}`}
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
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-slate-900 font-bold truncate max-w-[130px] lg:max-w-[145px]" title={row.personNameSnapshot}>
                          {row.personNameSnapshot}
                        </span>
                        {row.dutyDomain !== 'EP' && onSelectPersonForEntitlement && (
                          <button
                            type="button"
                            id={`btn-view-entitlements-${row.personId}`}
                            data-testid={`btn-view-entitlements-${row.personId}`}
                            onClick={() => onSelectPersonForEntitlement(row.personId)}
                            title={`View entitlements for ${row.personNameSnapshot}`}
                            className="text-[10px] font-bold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-1.5 py-0.5 rounded border border-teal-200 transition cursor-pointer shrink-0"
                          >
                            ⚖️
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-1.5 lg:p-2 text-center border-r border-b border-slate-100 bg-white">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                        {row.dutyDomain}
                      </span>
                    </td>
                    {sortedDates.map((date) => {
                      const assignment = row.cells[date];
                      const currentShift = assignment?.shiftCode || '';
                      const key = `${row.personId}::${date}::${row.dutyDomain}`;
                      const plannedShift = plannedMap.get(key);
                      const meta = dateMetaMap.get(date) || { isWeekend: false, isHoliday: false, isToday: false };

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

                      // Accessible name for assistive technology and automated audits
                      const statusParts = [];
                      if (isAbsence) {
                        statusParts.push(`Absence ${currentShift}`);
                        statusParts.push(isUncovered ? 'Uncovered' : `Covered by ${coveringDoctorName || 'replacement'}`);
                      } else if (isCovering) {
                        statusParts.push(`${currentShift} Covering`);
                        statusParts.push(`Covering ${absentDoctorName || 'colleague'}`);
                      } else if (currentShift === 'GOFF') {
                        statusParts.push('GOFF Entitlement');
                      } else if (currentShift === 'GHKA') {
                        statusParts.push('GHKA Entitlement');
                      } else if (currentShift === 'HKA') {
                        statusParts.push('HKA Holiday Rest');
                      } else if (currentShift) {
                        statusParts.push(currentShift);
                      } else {
                        statusParts.push('OFF');
                      }
                      if (isChanged) {
                        statusParts.push(`amended from ${plannedShift || 'OFF'}`);
                      }
                      const cellAriaLabel = `${row.personNameSnapshot}, ${date}, ${statusParts.join(', ')}`;

                      const cellBgClass = isUncovered
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
                        : meta.isHoliday
                        ? 'bg-rose-50/20'
                        : meta.isWeekend
                        ? 'bg-slate-50/40'
                        : 'bg-white';

                      return (
                        <td
                          key={date}
                          id={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          data-testid={`cell-${row.personId}-${date}-${row.dutyDomain}`}
                          className={`p-0.5 lg:p-1 text-center border-r border-b border-slate-100 align-middle transition ${cellBgClass} ${
                            meta.isToday ? 'ring-1 ring-inset ring-indigo-300/60' : ''
                          }`}
                        >
                          <div className="flex flex-col items-center justify-center gap-0.5 min-h-[36px] lg:min-h-[38px] py-0.5 px-0.5">
                            {/* Shift Code / Absence Type Display */}
                            {canAmend ? (
                              <button
                                type="button"
                                id={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                data-testid={`btn-amend-${row.personId}-${date}-${row.dutyDomain}`}
                                aria-label={cellAriaLabel}
                                onClick={() => {
                                  if (isUncovered && onSelectDutyForReplacement) {
                                    onSelectDutyForReplacement(cellData);
                                  } else if (onSelectCellForAmend) {
                                    onSelectCellForAmend(cellData);
                                  }
                                }}
                                title={`Assignment: ${currentShift || '—'}${isChanged ? ` (Planned: ${plannedShift || 'OFF'})` : ''}`}
                                className={`w-full py-0.5 px-1 rounded-md text-xs font-mono font-bold transition active:scale-95 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
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
                              <span
                                aria-label={cellAriaLabel}
                                className={`font-mono text-xs font-bold ${
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
                                }`}
                              >
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
                                    className="text-[9px] font-bold text-rose-700 hover:text-rose-900 bg-white hover:bg-rose-50 px-1 py-0.5 rounded border border-rose-300 shadow-2xs transition active:scale-95 cursor-pointer focus:outline-none focus:ring-1 focus:ring-rose-500"
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
                                className="text-[9px] font-semibold text-slate-500 hover:text-indigo-700 hover:underline transition mt-0.5 leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400"
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
                                  className="text-[9px] font-bold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-1 py-0.2 rounded border border-teal-200 transition leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500"
                                >
                                  Use GOFF
                                </button>
                                <button
                                  type="button"
                                  id={`btn-use-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                                  data-testid={`btn-use-ghka-${row.personId}-${date}-${row.dutyDomain}`}
                                  onClick={() => onSelectDutyForEntitlement(cellData, 'GHKA')}
                                  title={`Use GHKA for ${row.personNameSnapshot} on ${date}`}
                                  className="text-[9px] font-bold text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 px-1 py-0.2 rounded border border-amber-200 transition leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500"
                                >
                                  Use GHKA
                                </button>
                              </div>
                            )}

                            {/* Changed Badge */}
                            {isChanged && !isAbsence && !isCovering && !isEntitlementDuty && (
                              <span
                                className="changed-badge inline-block text-[9px] font-extrabold text-amber-700 bg-amber-100/80 px-1 py-0.2 rounded border border-amber-300 shadow-2xs leading-none"
                                title={`Original Planned: ${plannedShift || 'OFF'} -> Current: ${currentShift}`}
                              >
                                Changed
                                <span className="hidden lg:inline text-[8px] text-amber-800 font-mono ml-0.5 font-normal">
                                  ({plannedShift || 'OFF'}→{currentShift})
                                </span>
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
