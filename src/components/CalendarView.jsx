import { useMemo } from 'react';
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

export default function CalendarView({ requests, referenceDate = new Date() }) {
  const calendarWeeks = useMemo(() => buildCalendarMatrix(referenceDate), [referenceDate]);

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

  const monthTitle = referenceDate.toLocaleDateString(undefined, {
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

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
        <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
          {DAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-3">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-slate-200">
          {calendarWeeks.flat().map((dateObj, index) => {
            if (!dateObj) {
              return <div key={`empty-${index}`} className="min-h-[90px] bg-white" />;
            }

            const dateKey = toIsoDate(dateObj);
            const dayRequests = requestsByDate[dateKey] ?? [];
            const dayNumber = dateObj.getDate();
            const weekdayLabel = DAY_LABELS[dateObj.getDay()];

            return (
              <div key={dateKey} className="flex min-h-[110px] flex-col gap-1 bg-white p-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">{dayNumber}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{weekdayLabel}</span>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  {dayRequests.length > 0 ? (
                    dayRequests.map((entry) => (
                      <span
                        key={entry.id ?? `${entry.name}-${entry.date}-${entry.request}`}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-700"
                      >
                        <span className="font-semibold">{entry.request}</span>
                        <span className="text-slate-500">({entry.name})</span>
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full border border-dashed border-slate-200 px-2 py-1 text-[11px] text-slate-300">
                      No requests
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
