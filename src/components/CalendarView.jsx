import { useEffect, useMemo, useState } from 'react';
import { toIsoDate } from '../utils/normalise';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildCalendarMatrix(currentDate) {
  const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const daysInMonth = end.getDate();
  const firstWeekday = start.getDay();

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
  }

  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) {
    cells.push(null);
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 1) {
    const weekIndex = Math.floor(i / 7);
    if (!weeks[weekIndex]) {
      weeks[weekIndex] = [];
    }
    weeks[weekIndex].push(cells[i]);
  }

  return weeks;
}

function getUpcomingMonthReference(today = new Date()) {
  return new Date(today.getFullYear(), today.getMonth() + 1, 1);
}

export default function CalendarView({ requests, referenceDate }) {
  const [autoReferenceDate, setAutoReferenceDate] = useState(() => getUpcomingMonthReference());

  useEffect(() => {
    if (referenceDate) {
      return undefined;
    }

    let timeoutId;

    const scheduleUpdate = () => {
      const now = new Date();
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const msUntilNextMonth = startOfNextMonth.getTime() - now.getTime();
      const delay = Math.max(msUntilNextMonth, 0) + 1000;

      timeoutId = window.setTimeout(() => {
        setAutoReferenceDate(getUpcomingMonthReference());
        scheduleUpdate();
      }, delay);
    };

    scheduleUpdate();

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [referenceDate]);

  const effectiveReferenceDate = useMemo(() => {
    if (referenceDate) {
      return referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    }
    return autoReferenceDate;
  }, [autoReferenceDate, referenceDate]);

  const monthToken = `${effectiveReferenceDate.getFullYear()}-${effectiveReferenceDate.getMonth()}`;

  const calendarWeeks = useMemo(() => buildCalendarMatrix(effectiveReferenceDate), [monthToken]);

  const requestsByDate = useMemo(() => {
    return requests.reduce((acc, request) => {
      if (request.status && request.status.toLowerCase() !== 'active') {
        return acc;
      }

      const key = toIsoDate(request.date);
      if (!key) return acc;

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(request);
      return acc;
    }, {});
  }, [requests]);

  const monthTitle = effectiveReferenceDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Roster Calendar</p>
          <h2 className="text-2xl font-semibold text-slate-900">{monthTitle}</h2>
        </div>
      </header>

      <div className="mt-6 rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <div className="min-w-[560px] overflow-hidden rounded-2xl">
            <div className="grid grid-cols-7 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
              {DAY_LABELS.map((label) => (
                <div key={label} className="px-2 py-3">
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-px bg-slate-200">
              {calendarWeeks.flat().map((dateObj, index) => {
                if (!dateObj) {
                  return (
                    <div
                      key={`empty-${index}`}
                      className="aspect-square bg-white sm:aspect-auto sm:min-h-[100px]"
                    />
                  );
                }

                const dateKey = toIsoDate(dateObj);
                const dayRequests = requestsByDate[dateKey] ?? [];
                const dayNumber = dateObj.getDate();
                const weekdayLabel = DAY_LABELS[dateObj.getDay()];

                return (
                  <div
                    key={dateKey}
                    className="flex aspect-square flex-col gap-1 bg-white p-2 text-[11px] sm:aspect-auto sm:min-h-[110px] sm:text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 sm:text-sm">{dayNumber}</span>
                      <span className="text-[9px] uppercase tracking-wide text-slate-400 sm:text-[10px]">
                        {weekdayLabel}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {dayRequests.length > 0 ? (
                        dayRequests.map((entry) => (
                          <span
                            key={entry.id ?? `${entry.name}-${entry.date}-${entry.request}`}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-700 sm:text-xs"
                          >
                            <span className="font-semibold">{entry.request}</span>
                            <span className="text-slate-500">({entry.name})</span>
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full border border-dashed border-slate-200 px-2 py-1 text-[9px] text-slate-300 sm:text-[11px]">
                          No requests
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
