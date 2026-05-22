import { useState, useMemo } from 'react';
import CalendarView from './CalendarView';
import DateDetailPanel from './DateDetailPanel';
import RosterTable from './RosterTable';
import UserRequests from './UserRequests';

export default function UserSection({
  requests,
  names,
  namesError,
  isLoadingNames,
  selectedName,
  onSelectName,
  onSubmitRequest,
  onDeleteRequest,
  isLoadingRequests,
  masterRoster = [],
  shiftTypes = [],
  limitGroups = [],
  shiftBlocks = [],
  settings = {},
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [error, setError] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'table'

  const monthlyStats = useMemo(() => {
    if (!selectedName || selectedName.trim().toLowerCase() === 'admin' || !requests?.length) return [];
    
    const targetName = selectedName.trim().toLowerCase();
    const userActiveRequests = requests.filter((r) => {
      const isUser = r.name && r.name.trim().toLowerCase() === targetName;
      const isActive = r.status?.toLowerCase() === 'active';
      return isUser && isActive;
    });

    const limitGroupIdByShiftType = (shiftTypes || []).reduce((acc, st) => {
      if (st.GroupID) {
        acc[st.Name.toUpperCase()] = st.GroupID;
      }
      return acc;
    }, {});

    const counts = {};
    const weekendCounts = {};

    const weekendLimitGroupId = settings?.weekend_limit_group_id || 'ALL';

    userActiveRequests.forEach((r) => {
      if (!r.date) return;
      const d = new Date(r.date);
      if (isNaN(d.getTime())) return;
      
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts[key] = (counts[key] || 0) + 1;
      
      const day = d.getDay();
      if (day === 0 || day === 6) {
        let applies = true;
        if (weekendLimitGroupId !== 'ALL') {
          const reqType = (r.request ?? '').toString().trim().toUpperCase();
          if (limitGroupIdByShiftType[reqType] !== weekendLimitGroupId) {
            applies = false;
          }
        }
        if (applies) {
          weekendCounts[key] = (weekendCounts[key] || 0) + 1;
        }
      }
    });

    const targetMonth = calendarMonth || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
    const targetKey = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, '0')}`;

    const limit = Number(settings?.monthly_request_limit) || 10;
    const weekendLimit = settings?.monthly_weekend_limit !== undefined 
      ? Number(settings.monthly_weekend_limit) 
      : 4;

    const weekendTargetName = weekendLimitGroupId === 'ALL' 
      ? 'Weekend' 
      : `Weekend ${(limitGroups || []).find(g => g.ID === weekendLimitGroupId)?.GroupName || ''}`.trim();

    const labelOf = (yearMonthKey) => {
      const [y, m] = yearMonthKey.split('-');
      const dateObj = new Date(parseInt(y), parseInt(m) - 1, 1);
      return dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    };

    return [
      { 
        key: targetKey, 
        label: labelOf(targetKey), 
        count: counts[targetKey] || 0, 
        limit,
        weekendCount: weekendCounts[targetKey] || 0,
        weekendLimit,
        weekendLabel: weekendTargetName
      },
    ];
  }, [requests, selectedName, settings, shiftTypes, limitGroups, calendarMonth]);



  const handleDateSelect = (date) => {
    // Clicking the same date again closes the panel
    if (selectedDate && date.toDateString() === selectedDate.toDateString()) {
      setSelectedDate(null);
      setEditingRequest(null);
    } else {
      setSelectedDate(date);
      setEditingRequest(null);
      setError('');
    }
  };

  const handlePanelClose = () => {
    setSelectedDate(null);
    setEditingRequest(null);
    setError('');
  };

  const handleEdit = (request) => {
    setEditingRequest(request);
  };

  const handleSubmit = async (payload) => {
    try {
      setIsSubmitting(true);
      setError('');
      await onSubmitRequest(payload);
      setEditingRequest(null);
      handlePanelClose(); // Auto close the request form panel
    } catch (err) {
      setError(err.message ?? 'Unable to save request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (request) => {
    try {
      setIsSubmitting(true);
      setError('');
      await onDeleteRequest(request);
      if (editingRequest?.id === request.id) {
        setEditingRequest(null);
      }
    } catch (err) {
      setError(err.message ?? 'Unable to delete request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      {/* 🧭 Toggle Bar & Layout Selector */}
      <div className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fadeIn">
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-indigo-900 bg-clip-text text-transparent">
            📝 Request Panel
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Displaying active requests made by team members.
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-slate-150/70 p-1 shadow-inner self-start sm:self-auto ring-1 ring-slate-200">
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all duration-200 ${
              viewMode === 'calendar'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            📅 Calendar View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all duration-200 ${
              viewMode === 'table'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            📊 Table View
          </button>
        </div>
      </div>

      {namesError && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {namesError}
        </div>
      )}

      {/* 📊 Monthly Request Limits Summary Cards */}
      {selectedName && selectedName.trim().toLowerCase() !== 'admin' && monthlyStats.length > 0 && (
        <div className="animate-fadeIn mb-2 max-w-sm">
          {monthlyStats.map((stat) => {
            const pct = Math.min(100, (stat.count / stat.limit) * 100);
            const weekendPct = Math.min(100, (stat.weekendCount / stat.weekendLimit) * 100);
            
            // Color thresholds
            let barColor = 'bg-emerald-500';
            let textColor = 'text-emerald-700';
            let bgColor = 'bg-emerald-50';
            let borderColor = 'border-emerald-100';
            
            if (stat.count >= stat.limit) {
              barColor = 'bg-rose-500';
              textColor = 'text-rose-700';
              bgColor = 'bg-rose-50';
              borderColor = 'border-rose-100';
            } else if (stat.count >= stat.limit - 2) {
              barColor = 'bg-amber-500';
              textColor = 'text-amber-700';
              bgColor = 'bg-amber-50';
              borderColor = 'border-amber-100';
            }

            return (
              <div 
                key={stat.key}
                className={`rounded-2xl border ${borderColor} ${bgColor} p-4 shadow-sm transition-all duration-300 flex flex-col justify-between`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {stat.label} Quotas
                  </span>
                </div>
                
                {/* Total Quota Progress Bar Container */}
                <div className="mb-3">
                  <div className="flex justify-between mb-1 text-[10px] font-bold">
                    <span className="text-slate-500">Total Requests</span>
                    <span className={textColor}>{stat.count} / {stat.limit}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-200/75 overflow-hidden">
                    <div 
                      className={`h-full ${barColor} transition-all duration-500 ease-out rounded-full`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Weekend Quota Progress Bar Container */}
                <div className="mb-1">
                  <div className="flex justify-between mb-1 text-[10px] font-bold">
                    <span className="text-slate-500">{stat.weekendLabel} Requests</span>
                    <span className={stat.weekendCount >= stat.weekendLimit ? 'text-rose-700' : 'text-slate-600'}>
                      {stat.weekendCount} / {stat.weekendLimit}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-200/75 overflow-hidden">
                    <div 
                      className={`h-full ${stat.weekendCount >= stat.weekendLimit ? 'bg-rose-500' : 'bg-slate-400'} transition-all duration-500 ease-out rounded-full`}
                      style={{ width: `${weekendPct}%` }}
                    />
                  </div>
                </div>

                {(stat.count >= stat.limit || stat.weekendCount >= stat.weekendLimit) && (
                  <p className="mt-2 text-[10px] font-semibold text-rose-600 flex items-center gap-1">
                    ⚠️ {stat.count >= stat.limit ? 'Total Limit reached!' : `${stat.weekendLabel} limit reached!`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 🎛️ Unified Switch View */}
      {viewMode === 'calendar' ? (
        <CalendarView
          requests={requests}
          onDateSelect={handleDateSelect}
          selectedDate={selectedDate}
          onMonthChange={setCalendarMonth}
        />
      ) : (
        <div className="rounded-3xl border border-slate-150/70 bg-white p-4 shadow-sm sm:p-6">
          <RosterTable
            names={names}
            requests={requests}
          />
        </div>
      )}

      {/* 📋 Personal Request History Section */}
      {selectedName && selectedName.trim().toLowerCase() !== 'admin' && (
        <div className="mt-4 border-t border-slate-100 pt-6">
          <UserRequests
            requests={requests}
            selectedName={selectedName}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isLoading={isLoadingRequests}
            settings={settings}
          />
        </div>
      )}

      {/* Slide-up / slide-in panel — rendered when a date is selected and in calendar mode */}
      {viewMode === 'calendar' && selectedDate && (
        <DateDetailPanel
          date={selectedDate}
          requests={requests}
          selectedName={selectedName}
          onClose={handlePanelClose}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          editingRequest={editingRequest}
          shiftTypes={shiftTypes}
          limitGroups={limitGroups}
          shiftBlocks={shiftBlocks}
          error={error}
          settings={settings}
          names={names}
        />
      )}
    </section>
  );
}
