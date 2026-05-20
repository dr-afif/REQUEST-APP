import { useEffect, useMemo, useState } from 'react';
import { toIsoDate } from '../utils/normalise';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const REQUEST_CLASS_MAP = {
  am: 'req--am',
  pm: 'req--pm',
  night: 'req--night',
  on: 'req--night',
  course: 'req--course',
  off: 'req--off',
  leave: 'req--off',
  hka: 'req--hka',
  ghka: 'req--ghka',
  al: 'req--off',
};

function buildCalendarMatrix(currentDate) {
  const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const daysInMonth = end.getDate();
  const firstWeekday = (start.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1)
    cells.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 1) {
    const wi = Math.floor(i / 7);
    if (!weeks[wi]) weeks[wi] = [];
    weeks[wi].push(cells[i]);
  }
  return weeks;
}

function getUpcomingMonthReference(today = new Date()) {
  return new Date(today.getFullYear(), today.getMonth() + 1, 1);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, date.getDate());
}

function getRequestVariant(value) {
  const token = (value ?? '').toString().trim().toLowerCase();
  if (!token) return 'req--default';
  if (REQUEST_CLASS_MAP[token]) return REQUEST_CLASS_MAP[token];
  if (token.includes('night')) return 'req--night';
  if (token.includes('course')) return 'req--course';
  if (token.includes('off') || token.includes('leave')) return 'req--off';
  return 'req--default';
}

export default function CalendarView({
  requests,
  referenceDate,
  onDateSelect,
  selectedDate,
}) {
  const [autoReferenceDate, setAutoReferenceDate] = useState(() =>
    getUpcomingMonthReference(),
  );
  const [monthOffset, setMonthOffset] = useState(0);

  const todayKey = useMemo(() => toIsoDate(new Date()), []);
  const selectedKey = selectedDate ? toIsoDate(selectedDate) : null;

  useEffect(() => {
    if (referenceDate) return undefined;

    let timeoutId;
    const scheduleUpdate = () => {
      const now = new Date();
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const delay = Math.max(startOfNextMonth.getTime() - now.getTime(), 0) + 1000;
      timeoutId = window.setTimeout(() => {
        setAutoReferenceDate(getUpcomingMonthReference());
        scheduleUpdate();
      }, delay);
    };
    scheduleUpdate();
    return () => { if (timeoutId) window.clearTimeout(timeoutId); };
  }, [referenceDate]);

  const effectiveReferenceDate = useMemo(() => {
    if (referenceDate)
      return referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    return addMonths(autoReferenceDate, monthOffset);
  }, [autoReferenceDate, monthOffset, referenceDate]);

  const monthToken = `${effectiveReferenceDate.getFullYear()}-${effectiveReferenceDate.getMonth()}`;
  const calendarWeeks = useMemo(
    () => buildCalendarMatrix(effectiveReferenceDate),
    [monthToken],
  );

  const requestsByDate = useMemo(() => {
    return requests.reduce((acc, request) => {
      if (request.status && request.status.toLowerCase() !== 'active') return acc;
      const key = toIsoDate(request.date);
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(request);
      return acc;
    }, {});
  }, [requests]);

  const monthTitle = effectiveReferenceDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const showNavigation = !referenceDate;

  const goToToday = () => {
    // Jump to the month that contains today (offset = months from auto ref to today's month)
    const now = new Date();
    const base = getUpcomingMonthReference();
    const diff =
      (now.getFullYear() - base.getFullYear()) * 12 +
      (now.getMonth() - base.getMonth());
    setMonthOffset(diff);
  };

  return (
    <section className="calendar rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Roster Calendar
          </p>
          <h2 className="text-2xl font-semibold text-slate-900">{monthTitle}</h2>
        </div>

        {showNavigation && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              onClick={() => setMonthOffset((v) => v - 1)}
            >
              ‹ Prev
            </button>
            {onDateSelect && (
              <button
                type="button"
                className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                onClick={goToToday}
              >
                Today
              </button>
            )}
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              onClick={() => setMonthOffset((v) => v + 1)}
            >
              Next ›
            </button>
          </div>
        )}
      </header>

      <div className="calendar__frame mt-6">
        <div className="calendar__header">
          {DAY_LABELS.map((label) => (
            <div key={label} className="calendar__header-cell">
              {label}
            </div>
          ))}
        </div>

        <div className="calendar__grid">
          {calendarWeeks.flat().map((dateObj, index) => {
            if (!dateObj) {
              return (
                <div
                  key={`empty-${index}`}
                  className="calendar__cell calendar__cell--empty"
                />
              );
            }

            const dateKey = toIsoDate(dateObj);
            const dayRequests = requestsByDate[dateKey] ?? [];
            const dayNumber = dateObj.getDate();
            const isToday = dateKey === todayKey;
            const isSelected = dateKey === selectedKey;

            const cellClass = [
              'calendar__cell',
              onDateSelect ? 'calendar__cell--clickable' : '',
              isToday ? 'calendar__cell--today' : '',
              isSelected ? 'calendar__cell--selected' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const dateNumClass = [
              'calendar__date',
              isToday ? 'calendar__date--today' : '',
              isSelected ? 'calendar__date--selected' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const inner = (
              <>
                <div className="calendar__cell-header">
                  <span className={dateNumClass}>{dayNumber}</span>
                </div>
                <div className="calendar__requests">
                  {dayRequests.map((entry) => {
                    const trimmedName =
                      typeof entry.name === 'string' ? entry.name.trim() : '';
                    const trimmedComment =
                      typeof entry.comment === 'string' ? entry.comment.trim() : '';
                    const requestLabel = (entry.request ?? '').toString().trim();
                    const variantClass = getRequestVariant(requestLabel);
                    const chipClass = ['req', variantClass].filter(Boolean).join(' ');

                    return (
                      <div
                        key={entry.id ?? `${entry.name}-${entry.date}-${entry.request}`}
                        className={chipClass}
                        title={trimmedComment || undefined}
                      >
                        <span className="req__tag">{requestLabel || 'N/A'}</span>
                        {trimmedName ? (
                          <span className="req__name">&bull; {trimmedName}</span>
                        ) : null}
                        {trimmedComment ? (
                          <span className="req__comment" role="tooltip">
                            {trimmedComment}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            );

            if (onDateSelect) {
              return (
                <button
                  key={dateKey}
                  type="button"
                  className={cellClass}
                  onClick={() => onDateSelect(dateObj)}
                  aria-label={dateObj.toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  aria-pressed={isSelected}
                >
                  {inner}
                </button>
              );
            }

            return (
              <div key={dateKey} className={cellClass}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>

      {onDateSelect && (
        <p className="mt-3 text-center text-xs text-slate-400">
          Tap any date to view or add a request
        </p>
      )}
    </section>
  );
}
