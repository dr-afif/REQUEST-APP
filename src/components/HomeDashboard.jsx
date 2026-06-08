import { useMemo } from 'react';
import { normalizeForComparison, toIsoDate } from '../utils/normalise';
import { mapName } from '../utils/adapters';
import { APP_ICONS } from '../constants/icons';

// Helper to parse standby status and extended shift status from a shift name string
const parseShiftValue = (rawVal) => {
  if (!rawVal) return { cleanShift: '', isStandby: false, isExtended: false };
  const rawStr = String(rawVal).trim();
  const upStr = rawStr.toUpperCase();
  const isStandby = upStr.endsWith('(S)') || upStr.endsWith('-S') || upStr.includes('(S)');
  let isExtended = upStr.endsWith('(X)') || upStr.endsWith('-X') || upStr.includes('(X)');
  
  if (!isExtended && upStr.length > 1 && upStr.endsWith('X')) {
    isExtended = true;
  }

  // Remove standby and extended modifiers in a case-insensitive way
  let cleanShift = rawStr
    .replace(/\(s\)/i, '')
    .replace(/-s/i, '')
    .replace(/\(x\)/i, '')
    .replace(/-x/i, '')
    .trim();
    
  if (isExtended && !upStr.endsWith('(X)') && !upStr.endsWith('-X') && upStr.endsWith('X')) {
    cleanShift = cleanShift.slice(0, -1);
  }
  
  return { cleanShift, isStandby, isExtended };
};

export default function HomeDashboard({
  selectedName,
  names = [],
  requests = [],
  masterRoster = [],
  shiftBlocks = [],
  onUpdateApproval,
  onNavigate,
}) {
  const isGuest = selectedName?.trim().toLowerCase() === 'guest';

  // Helpers to format ISO Date (YYYY-MM-DD)
  const getLocalDateString = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const todayStr = useMemo(() => getLocalDateString(0), []);
  const tomorrowStr = useMemo(() => getLocalDateString(1), []);

  // 1. Filter swaps waiting for THIS user's approval as Partner
  const pendingPartnerSwaps = useMemo(() => {
    if (!selectedName) return [];
    const normUser = normalizeForComparison(mapName(selectedName));
    return requests.filter((r) => {
      const isSwap = r.RequestType?.toLowerCase() === 'swap';
      const isPendingPartner = r.ApprovalStatus === 'Pending Partner';
      const isTargetPartner = normalizeForComparison(mapName(r.SwapPartner)) === normUser;
      const isActive = r.status?.toLowerCase() === 'active';
      return isSwap && isPendingPartner && isTargetPartner && isActive;
    });
  }, [selectedName, requests]);

  // 2. Count pending admin metrics
  const pendingAdminCount = useMemo(() => {
    return requests.filter(
      (r) => r.status?.toLowerCase() === 'active' && r.ApprovalStatus === 'Pending Admin'
    ).length;
  }, [requests]);

  // Helper to determine shift for the selected user on a specific date (aligns with table view logic)
  const getResolvedShiftForDate = (dateStr) => {
    if (!selectedName) return null;
    const normUser = normalizeForComparison(mapName(selectedName));

    // 1. Get baseline shift from masterRoster
    const baseline = masterRoster.find(
      (s) => {
        const nameRaw = mapName(s.Name || s.name || '');
        const rawDate = s.Date || s.date;
        return normalizeForComparison(nameRaw) === normUser && toIsoDate(rawDate) === dateStr;
      }
    );
    const baselineShift = baseline ? (baseline.Shift || baseline.shift) : null;

    // 2. Find active requests
    const activeReqs = requests.filter((r) => {
      const nameRaw = mapName(r.Name || r.name || '');
      const rawDate = r.Date || r.date;
      const status = String(r.status || r.Status || '').toLowerCase();
      const rType = r.RequestType || r.requestType || 'Leave';
      const isCustom = String(rType).toLowerCase() === 'admincomment';
      return (
        normalizeForComparison(nameRaw) === normUser &&
        toIsoDate(rawDate) === dateStr &&
        status === 'active' &&
        !isCustom
      );
    });

    const approvedReq = activeReqs.find((r) => r.ApprovalStatus === 'Approved');
    const pendingAdminReq = activeReqs.find((r) => r.ApprovalStatus === 'Pending Admin');

    if (approvedReq) {
      return {
        shift: approvedReq.Request || approvedReq.request,
        isOverride: !!baselineShift,
      };
    }

    if (baselineShift) {
      return {
        shift: baselineShift,
        isOverride: false,
      };
    }

    if (pendingAdminReq) {
      return {
        shift: pendingAdminReq.Request || pendingAdminReq.request,
        isOverride: false,
      };
    }

    return null;
  };

  // 3. Today's shift highlight for the current user
  const todayHighlight = useMemo(() => {
    if (!selectedName) return null;
    const normUser = normalizeForComparison(mapName(selectedName));

    const resolved = getResolvedShiftForDate(todayStr);

    // Get pending request overrides (for status banner)
    const pendingRequest = requests.find(
      (r) => {
        const nameRaw = mapName(r.Name || r.name || '');
        const rawDate = r.Date || r.date;
        const rType = r.RequestType || r.requestType || 'Leave';
        const isCustom = String(rType).toLowerCase() === 'admincomment';
        return normalizeForComparison(nameRaw) === normUser &&
          toIsoDate(rawDate) === todayStr &&
          r.status?.toLowerCase() === 'active' &&
          !isCustom &&
          r.ApprovalStatus &&
          r.ApprovalStatus !== 'Approved' &&
          r.ApprovalStatus !== 'Rejected';
      }
    );

    // Gather comments for today's shift (separated by custom admin comments vs normal request comments)
    const todayRequests = requests.filter(
      (r) => {
        const nameRaw = mapName(r.Name || r.name || '');
        const rawDate = r.Date || r.date;
        return normalizeForComparison(nameRaw) === normUser &&
          toIsoDate(rawDate) === todayStr &&
          r.status?.toLowerCase() === 'active';
      }
    );

    const requestComments = [];
    const manualComments = [];

    todayRequests.forEach((r) => {
      const rType = r.RequestType || r.requestType || 'Leave';
      const isCustom = String(rType).toLowerCase() === 'admincomment';
      const commentText = (r.Comment || r.comment || '').trim();
      if (!commentText) return;

      if (isCustom) {
        manualComments.push(commentText);
      } else {
        requestComments.push({
          type: rType,
          text: commentText,
          status: r.ApprovalStatus || r.approvalStatus
        });
      }
    });

    return {
      date: todayStr,
      shift: resolved ? resolved.shift : 'No Duty 💤',
      isOverride: resolved ? resolved.isOverride : false,
      pending: pendingRequest ? {
        status: pendingRequest.ApprovalStatus || pendingRequest.approvalStatus,
        partner: pendingRequest.SwapPartner || pendingRequest.swapPartner,
        type: pendingRequest.RequestType || pendingRequest.requestType
      } : null,
      requestComments,
      manualComments
    };
  }, [selectedName, masterRoster, requests, todayStr]);

  // 4. User's current month duty list (populating all shift types)
  const myUpcomingDuties = useMemo(() => {
    if (!selectedName) return [];

    // Extract current year and month from todayStr (format: YYYY-MM-DD)
    const currentYearMonth = todayStr.substring(0, 7);
    const [year, month] = todayStr.split('-').map(Number);

    // Generate all dates for the current month
    const totalDays = new Date(year, month, 0).getDate();
    const list = [];

    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const dd = String(dayNum).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;

      const resolved = getResolvedShiftForDate(dateStr);
      if (resolved) {
        list.push({
          date: dateStr,
          shift: resolved.shift,
          isOverride: resolved.isOverride,
        });
      }
    }

    return list;
  }, [selectedName, masterRoster, requests, todayStr]);

  // 5. Compute "updates/activity related to today and tomorrow"
  const dailyUpdates = useMemo(() => {
    const list = [];

    // Parse active requests scheduled for today or tomorrow
    requests.forEach((r) => {
      const rawDate = r.Date || r.date;
      const dateStr = toIsoDate(rawDate);
      if (r.status?.toLowerCase() === 'active' && (dateStr === todayStr || dateStr === tomorrowStr)) {
        list.push({
          type: 'request',
          id: r.ID || r.id,
          date: dateStr,
          isToday: dateStr === todayStr,
          timestamp: r.Timestamp || r.timestamp,
          name: mapName(r.Name || r.name || ''),
          requestType: r.RequestType || r.requestType,
          request: r.Request || r.request,
          approvalStatus: r.ApprovalStatus || r.approvalStatus,
          swapPartner: mapName(r.SwapPartner || r.swapPartner || ''),
          comment: r.Comment || r.comment,
        });
      }
    });

    // Parse blocks scheduled for today or tomorrow
    shiftBlocks.forEach((b) => {
      const rawDate = b.Date || b.date;
      const dateStr = toIsoDate(rawDate);
      if (dateStr === todayStr || dateStr === tomorrowStr) {
        list.push({
          type: 'block',
          id: b.ID || b.id,
          date: dateStr,
          isToday: dateStr === todayStr,
          maxSlots: b.MaxSlots || b.maxSlots,
          shiftType: b.ShiftType || b.shiftType,
        });
      }
    });

    // Sort: Today first, then Tomorrow, then by timestamp/id
    return list.sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      if (a.type !== b.type) {
        return a.type === 'request' ? -1 : 1;
      }
      return 0;
    });
  }, [requests, shiftBlocks, todayStr, tomorrowStr]);

  // Helper to format header dates
  const formatHeaderDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  };

  // Generate calendar days for the current month
  const calendarDays = useMemo(() => {
    if (!todayStr) return [];
    const [year, month] = todayStr.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // 0 = Mon, ..., 6 = Sun

    const days = [];

    // Pad for starting day of week
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push({ blank: true });
    }

    // Days in this month
    const totalDays = new Date(year, month, 0).getDate();
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const dd = String(dayNum).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;
      days.push({ blank: false, dayNum, dateStr });
    }

    return days;
  }, [todayStr]);

  const monthName = useMemo(() => {
    if (!todayStr) return '';
    const [year, month] = todayStr.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [todayStr]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">

      {/* 🚀 Welcome Hero Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-tr from-teal-500 via-emerald-600 to-indigo-700 p-6 shadow-xl shadow-indigo-100 text-white sm:p-8">
        <div className="absolute right-0 top-0 h-40 w-40 translate-x-12 -translate-y-12 rounded-full bg-white/10 blur-xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <span className="rounded-full bg-white/20 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-md flex items-center gap-1.5 w-max">
              <APP_ICONS.info className="w-3.5 h-3.5" /> ED Staff Hub
            </span>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              {selectedName ? `Welcome back, ${selectedName}!` : 'Welcome to ED Roster'}
            </h1>
            <p className="mt-2 max-w-md text-emerald-50 text-sm sm:text-base">
              {selectedName
                ? (isGuest
                  ? 'Check roster schedules and active requests. Log out and select your profile to submit new shift requests.'
                  : 'Check your personalized shifts today or submit new shift requests for next month.')
                : 'Please select your name to access your personal dashboard and alerts.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate(selectedName && !isGuest ? 'requests' : 'roster')}
            className="self-start rounded-2xl bg-white px-5 py-3 text-sm font-bold text-teal-800 shadow-lg hover:bg-slate-50 transition active:scale-95 sm:self-auto flex items-center gap-2"
          >
            {selectedName && !isGuest ? (
              <><APP_ICONS.requests className="w-4 h-4" /> Submit Request</>
            ) : (
              <><APP_ICONS.roster className="w-4 h-4" /> View Roster</>
            )}
          </button>
        </div>
      </div>

      {/* 🔄 Action Queue: Swap Partner Approvals */}
      {/* NOTE: Approval workflow disabled — roster is finalised externally. */}
      {/* Set APPROVAL_WORKFLOW_ENABLED = true here to re-enable. */}
      {false && selectedName && pendingPartnerSwaps.length > 0 && (
        <div className="mt-8 rounded-3xl border border-indigo-100 bg-indigo-50/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <APP_ICONS.warning className="w-6 h-6 text-indigo-900" />
            <h2 className="text-lg font-bold text-indigo-900">Shift Swap Action Needed</h2>
            <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-indigo-50">
              {pendingPartnerSwaps.length}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {pendingPartnerSwaps.map((swap) => (
              <div
                key={swap.ID}
                className="flex flex-col justify-between rounded-2xl border border-white bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500 font-semibold uppercase">
                    <span>Swap Partner Request</span>
                    <span>{swap.Date}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    <span className="font-bold text-slate-900">{swap.Name}</span> wants to swap shift duties with you.
                  </p>
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">Requested Shift:</span> {swap.Request}
                    {swap.Comment && (
                      <div className="mt-1 italic">"{swap.Comment}"</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateApproval(swap.ID, 'Pending Admin')}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
                  >
                    <APP_ICONS.check className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateApproval(swap.ID, 'Rejected')}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                  >
                    <APP_ICONS.close className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 🏛️ Layout Grid: Clean Centered Single Column Layout */}
      <div className="mt-8 max-w-3xl mx-auto space-y-6">

        {/* User's "Today's Roster Duty" shift card */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          {selectedName ? (
            <>
              <div className="flex justify-between items-center text-xs text-slate-400 font-bold uppercase tracking-wider">
                <span className="flex items-center gap-1.5"><APP_ICONS.calendar className="w-3.5 h-3.5" /> Today's Roster Duty</span>
                <span>{formatHeaderDate(todayStr)}</span>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div>
                  {(() => {
                    const { cleanShift, isStandby, isExtended } = parseShiftValue(todayHighlight?.shift);
                    return (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-3xl font-extrabold text-slate-800 flex items-center gap-2">
                            {cleanShift ? cleanShift : <span className="flex items-center gap-2">No Duty <APP_ICONS.info className="w-6 h-6 text-slate-300" /></span>}
                          </h3>
                          {isStandby && (
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-500 text-white leading-none shadow-sm select-none align-middle" title="Standby">
                              STANDBY
                            </span>
                          )}
                          {isExtended && (
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-500 text-white leading-none shadow-sm select-none align-middle" title="Extended Shift">
                              EXTENDED
                            </span>
                          )}
                        </div>
                        {todayHighlight?.isOverride && (
                          <span className="self-start inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 border border-emerald-100">
                            REQUESTED SHIFT
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center justify-center">
                  {(() => {
                    const { cleanShift } = parseShiftValue(todayHighlight?.shift);
                    const sLower = (cleanShift || '').toLowerCase();
                    if (sLower.includes('night') || sLower === 'n' || sLower === 'on' || sLower === 'on1' || sLower === 'on2') {
                      return <APP_ICONS.clock className="w-10 h-10 text-slate-800" />;
                    }
                    if (sLower.includes('off') || sLower === 'al' || sLower === 'mc' || sLower === 'course' || sLower.includes('leave') || !cleanShift) {
                      return <APP_ICONS.user className="w-10 h-10 text-emerald-500" />;
                    }
                    return <APP_ICONS.calendar className="w-10 h-10 text-amber-500" />;
                  })()}
                </div>
              </div>

              {/* Pending Request Status */}
              {todayHighlight?.pending && (
                <div className="mt-4 border-t border-slate-100 pt-3 flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
                  <APP_ICONS.clock className="w-4 h-4 animate-pulse" />
                  <span>
                    {todayHighlight.pending.type} shift request is{' '}
                    <span className="font-bold text-indigo-700 underline">{todayHighlight.pending.status}</span>
                  </span>
                </div>
              )}

              {/* Roster Comments / Notes */}
              {((todayHighlight?.requestComments && todayHighlight.requestComments.length > 0) ||
                (todayHighlight?.manualComments && todayHighlight.manualComments.length > 0)) && (
                <div className="mt-4 border-t border-slate-100 pt-3 space-y-2 text-xs">
                  {/* Manual/Admin Comments */}
                  {todayHighlight.manualComments.map((comment, idx) => (
                    <div key={`manual-${idx}`} className="flex items-start gap-1.5 text-slate-600 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                      <APP_ICONS.document className="w-4 h-4 text-slate-400 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-700 block mb-0.5">Notes</span>
                        <p className="leading-relaxed">{comment}</p>
                      </div>
                    </div>
                  ))}

                  {/* Request Comments */}
                  {todayHighlight.requestComments.map((req, idx) => (
                    <div key={`req-${idx}`} className="flex items-start gap-1.5 text-indigo-700 bg-indigo-50/50 rounded-xl p-2.5 border border-indigo-50">
                      <APP_ICONS.send className="w-4 h-4 text-indigo-400 shrink-0" />
                      <div>
                        <span className="font-bold text-indigo-900 block mb-0.5">
                          Request Comment ({req.type})
                          {req.status && <span className="ml-1.5 font-normal text-[10px] bg-white border border-indigo-200 px-1.5 py-0.5 rounded-full">{req.status}</span>}
                        </span>
                        <p className="leading-relaxed">{req.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
              <div className="flex justify-center mb-2">
                <APP_ICONS.user className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-sm font-bold text-slate-700">No Profile Selected</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
                Select your name in the dropdown above to view your personalized daily duties and shifts automatically.
              </p>
            </div>
          )}
        </div>

        {/* 📅 Personalized Upcoming Duty Preview List (Mini Calendar View) */}
        {selectedName && (
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <APP_ICONS.calendar className="w-5 h-5" /> Your Scheduled Duties
              </h2>
              <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full uppercase">
                {monthName}
              </span>
            </div>

            {myUpcomingDuties.length > 0 ? (
              <div>
                {/* Calendar weekday headers */}
                <div className="grid grid-cols-7 gap-1 text-center font-bold text-[10px] text-slate-400 uppercase mb-3">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                    <div key={d}>{d}</div>
                  ))}
                </div>

                {/* Calendar cells */}
                <div className="grid grid-cols-7 gap-2">
                  {calendarDays.map((day, idx) => {
                    if (day.blank) {
                      return <div key={`blank-${idx}`} className="aspect-square" />;
                    }

                    const duty = myUpcomingDuties.find(d => d.date === day.dateStr);
                    const shift = duty ? duty.shift : '';
                    const isToday = day.dateStr === todayStr;

                    let cellStyle = 'bg-slate-50/50 text-slate-300 hover:bg-slate-100/50';
                    let labelColor = 'text-slate-400';
                    let shiftBadge = '';
                    let isStandby = false;
                    let isExtended = false;

                    if (shift) {
                      const parsed = parseShiftValue(shift);
                      const cleanShift = parsed.cleanShift;
                      isStandby = parsed.isStandby;
                      isExtended = parsed.isExtended;

                      const sLower = cleanShift.toLowerCase();
                      if (sLower.includes('off') || sLower === 'off') {
                        cellStyle = 'bg-emerald-50/55 text-emerald-600 hover:bg-emerald-50 border border-emerald-100/45';
                        labelColor = 'text-emerald-500';
                        shiftBadge = <APP_ICONS.check className="w-3 h-3 mx-auto" />;
                      } else if (sLower.includes('night') || sLower === 'n' || sLower === 'on' || sLower === 'on1' || sLower === 'on2') {
                        cellStyle = 'bg-slate-900 text-slate-100 hover:bg-slate-800 border border-slate-800';
                        labelColor = 'text-slate-400';
                        shiftBadge = (sLower.includes('night') || sLower === 'n') ? <APP_ICONS.clock className="w-3 h-3 mx-auto" /> : cleanShift.toUpperCase();
                      } else if (sLower.includes('am')) {
                        cellStyle = 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-100';
                        labelColor = 'text-amber-600';
                        shiftBadge = 'AM';
                      } else if (sLower.includes('pm')) {
                        cellStyle = 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-100';
                        labelColor = 'text-indigo-600';
                        shiftBadge = 'PM';
                      } else {
                        cellStyle = 'bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200';
                        labelColor = 'text-slate-500';
                        shiftBadge = cleanShift.substring(0, 3).toUpperCase();
                      }
                    }

                    return (
                      <div
                        key={day.dateStr}
                        title={`${day.dateStr}${shift ? `: ${shift}` : ': No duty'}`}
                        className={`relative flex flex-col items-center justify-between p-1.5 aspect-square rounded-2xl text-xs font-bold transition-all select-none cursor-pointer ${cellStyle} ${isToday ? 'ring-2 ring-indigo-600 ring-offset-2 scale-105 z-10 shadow-sm' : ''
                          }`}
                      >
                        <span className={`text-[10px] self-start leading-none ${isToday ? 'text-indigo-600 font-extrabold' : labelColor}`}>
                          {day.dayNum}
                        </span>
                        <div className="flex flex-col items-center mt-auto w-full">
                          <span className="text-[9px] font-extrabold uppercase tracking-tighter truncate max-w-full leading-none mb-0.5">
                            {shiftBadge}
                          </span>
                          {(isStandby || isExtended) && (
                            <div className="flex items-center gap-0.5 mt-0.5 select-none">
                              {isStandby && (
                                <span className="inline-flex items-center justify-center rounded-full text-[6.5px] font-extrabold bg-amber-500 text-white leading-none w-2.5 h-2.5 shadow-sm" title="Standby">
                                  S
                                </span>
                              )}
                              {isExtended && (
                                <span className="inline-flex items-center justify-center rounded-full text-[6.5px] font-extrabold bg-blue-500 text-white leading-none w-2.5 h-2.5 shadow-sm" title="Extended Shift">
                                  EX
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                <span className="text-2xl">💤</span>
                <p className="mt-2 text-sm font-semibold">No scheduled duties found for this month.</p>
              </div>
            )}
          </div>
        )}

        {/* 
        NOTE: Hidden "Queue Health" & "Today & Tomorrow Updates" cards "for now"
        The dashboard layout has been centered into a clean single column (max-w-3xl)
        instead of a 3-column desktop grid.
      */}
      </div>

    </div>
  );
}
