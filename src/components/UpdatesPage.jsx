import { useMemo, useState } from 'react';

export default function UpdatesPage({
  requests = [],
  shiftBlocks = [],
  activities = [],
  selectedName = '',
  onDeleteActivity,
}) {
  const isAdmin = selectedName?.trim().toLowerCase() === 'admin';
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // 1. Filter and sort manual activity history
  const changesFeed = useMemo(() => {
    const list = activities.length > 0 ? activities : [
      {
        ID: 'act-1',
        Timestamp: new Date().toISOString(),
        CustomText: '📢 Welcome to the new dynamic RESQ Roster portal! All activity updates are now managed dynamically from Google Sheets.',
        ApprovalStatus: 'Approved',
        RequestType: 'custom',
      }
    ];
    return [...list].sort((a, b) => {
      const timeA = a.Timestamp ? new Date(a.Timestamp).getTime() : 0;
      const timeB = b.Timestamp ? new Date(b.Timestamp).getTime() : 0;
      return timeB - timeA;
    });
  }, [activities]);

  // Helper for formatting timestamps
  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  // Helper for rendering log details/descriptions
  const renderLogMessage = (log) => {
    if (!log) return null;
    const name = typeof log.Name === 'string' ? log.Name : String(log.Name || '');
    const date = typeof log.Date === 'string' ? log.Date : String(log.Date || '');
    const swapPartner = typeof log.SwapPartner === 'string' ? log.SwapPartner : String(log.SwapPartner || '');
    const request = typeof log.Request === 'string' ? log.Request : String(log.Request || '');

    if (log.CustomText) {
      return <span className="font-semibold text-slate-800">{String(log.CustomText)}</span>;
    }

    const isSwap = log.RequestType?.toLowerCase() === 'swap';
    if (isSwap) {
      return (
        <p className="mt-2 text-sm text-slate-800">
          <span className="font-bold text-slate-900">{name}</span>
          <span> requested a shift swap with <span className="font-bold text-slate-900">{swapPartner || 'Partner'}</span></span>
          <span> for date <span className="font-semibold text-slate-900">{date}</span>.</span>
        </p>
      );
    }

    return (
      <p className="mt-2 text-sm text-slate-800">
        <span className="font-bold text-slate-900">{name}</span>
        <span> requested <span className="font-bold text-slate-900">{request || 'Off'}</span></span>
        <span> for date <span className="font-semibold text-slate-900">{date}</span>.</span>
      </p>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800">🔔 Roster Updates & Activity Feed</h1>
        <p className="text-sm text-slate-500 mt-1">
          Stay informed with real-time shifts modifications, leaves, blocks, and approved team swaps.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        
        {/* Left 2 Columns: Chronological Activity Feed */}
        <div className="md:col-span-2">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-6">🗓️ Roster Activity History</h2>
            
            {changesFeed.length > 0 ? (
              <div className="relative border-l border-slate-150 pl-6 ml-3 space-y-6">
                {changesFeed.map((log) => {
                  const isApproved = log.ApprovalStatus === 'Approved';
                  const isRejected = log.ApprovalStatus === 'Rejected';
                  const isSwap = log.RequestType?.toLowerCase() === 'swap';
                  
                  // Setup card colors/icons based on type & status
                  let badgeColor = 'bg-slate-50 text-slate-600 border border-slate-200';
                  let icon = '📝';
                  
                  if (log.CustomText) {
                    badgeColor = 'bg-indigo-50 text-indigo-700 border border-indigo-150';
                    icon = '📢';
                  } else if (isApproved) {
                    badgeColor = 'bg-emerald-50 text-emerald-700 border border-emerald-100';
                    icon = isSwap ? '🔄' : '🌴';
                  } else if (isRejected) {
                    badgeColor = 'bg-rose-50 text-rose-700 border border-rose-100';
                    icon = '❌';
                  } else {
                    badgeColor = 'bg-amber-50 text-amber-700 border border-amber-100';
                    icon = '⏳';
                  }

                  return (
                    <div key={log.ID} className="relative">
                      {/* Timeline dot */}
                      <span className="absolute -left-[35px] top-1 flex h-6.5 w-6.5 items-center justify-center rounded-full bg-slate-100 border-2 border-white text-xs shadow-inner">
                        {icon}
                      </span>
                      
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-slate-500">{formatTime(log.Timestamp)}</span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${badgeColor}`}>
                            {log.CustomText ? 'Update' : (log.ApprovalStatus || 'Pending')}
                          </span>
                        </div>

                        {renderLogMessage(log)}

                        {log.Comment && (
                          <div className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500 italic">
                            "{log.Comment}"
                          </div>
                        )}

                        {isAdmin && onDeleteActivity && log.ID !== 'act-1' && (
                          <div className="mt-2">
                            {confirmDeleteId === log.ID ? (
                              <div className="flex items-center gap-2 bg-rose-50 px-2 py-1 rounded-lg border border-rose-100 max-w-fit mt-1">
                                <span className="text-[10px] font-bold text-rose-700">Confirm?</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteActivity(log.ID);
                                    setConfirmDeleteId(null);
                                  }}
                                  className="text-white bg-rose-500 hover:bg-rose-600 px-2 py-0.5 rounded text-[10px] font-bold transition"
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-slate-600 bg-slate-200 hover:bg-slate-300 px-2 py-0.5 rounded text-[10px] font-bold transition"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setConfirmDeleteId(log.ID);
                                }}
                                className="text-rose-500 hover:text-rose-700 font-bold text-[10px] uppercase tracking-wider hover:underline block mt-1"
                              >
                                🗑️ Delete Update
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                <span className="text-3xl">📭</span>
                <p className="mt-2 text-sm font-semibold">No recent activity logs available.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Column: Active Rules / Blocks */}
        <div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-4">⚠️ Scheduling Limitations</h2>
            <p className="text-xs text-slate-500 mb-6">
              Roster admin holds on leave counts and cap thresholds by date.
            </p>

            {shiftBlocks.length > 0 ? (
              <div className="space-y-4">
                {shiftBlocks.map((block) => {
                  const limit = Number(block.MaxSlots);
                  const isBlocked = limit === 0;

                  return (
                    <div 
                      key={block.ID} 
                      className={`rounded-2xl border p-4 shadow-sm transition hover:shadow ${
                        isBlocked 
                          ? 'border-rose-100 bg-rose-50/20' 
                          : 'border-amber-100 bg-amber-50/20'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold uppercase">
                        <span className={isBlocked ? 'text-rose-700' : 'text-amber-700'}>
                          {isBlocked ? '🛑 Leave Block' : '⚡ Slot Limit'}
                        </span>
                        <span className="text-slate-400">
                          {new Date(block.Date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-600 font-semibold">
                        {isBlocked 
                          ? 'Leave requests are completely blocked for this date.' 
                          : `${block.ShiftType} shift requests are capped at max ${limit} slot(s).`}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                <span className="text-3xl">✅</span>
                <p className="mt-2 text-sm font-semibold">No scheduling limits active. Complete freedom!</p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
