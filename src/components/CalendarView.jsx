import { useEffect, useMemo, useState } from 'react';
import { toIsoDate } from '../utils/normalise';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LEGEND_ITEMS = [
  { key: 'am', label: 'AM' },
  { key: 'pm', label: 'PM' },
  { key: 'night', label: 'Night' },
  { key: 'course', label: 'Course' },
  { key: 'off', label: 'Off' },
  { key: 'hka', label: 'HKA' },
  { key: 'ghka', label: 'GHKA' },
];

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

function getRequestVariant(value) {
  const token = (value ?? '').toString().trim().toLowerCase();
  if (!token) {
    return 'req--default';
  }

  if (REQUEST_CLASS_MAP[token]) {
    return REQUEST_CLASS_MAP[token];
  }

  if (token.includes('night')) {
    return 'req--night';
  }

  if (token.includes('course')) {
    return 'req--course';
  }

  if (token.includes('off') || token.includes('leave')) {
    return 'req--off';
  }

  return 'req--default';
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
    <section className="calendar rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Roster Calendar</p>
          <h2 className="text-2xl font-semibold text-slate-900">{monthTitle}</h2>
        </div>
      </header>

      <div className="calendar__legend">
        {LEGEND_ITEMS.map((item) => (
          <span key={item.key} className="calendar__legend-item">
            {item.label}
            <span className={`calendar__legend-chip calendar__legend-chip--${item.key}`}>
              {item.label}
            </span>
          </span>
        ))}
      </div>

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
              return <div key={`empty-${index}`} className="calendar__cell calendar__cell--empty" />;
            }

            const dateKey = toIsoDate(dateObj);
            const dayRequests = requestsByDate[dateKey] ?? [];
            const dayNumber = dateObj.getDate();
            const weekdayLabel = DAY_LABELS[dateObj.getDay()];

            return (
              <div key={dateKey} className="calendar__cell">
                <div className="calendar__cell-header">
                  <span className="calendar__date">{dayNumber}</span>
                  <span className="calendar__weekday">{weekdayLabel}</span>
                </div>
                <div className="calendar__requests">
                  {dayRequests.length > 0 ? (
                    dayRequests.map((entry) => {
                      const trimmedName = typeof entry.name === 'string' ? entry.name.trim() : '';
                      const requestLabel = (entry.request ?? '').toString().trim();
                      const variantClass = getRequestVariant(requestLabel);
                      const chipClass = ['req', variantClass].filter(Boolean).join(' ');

                      return (
                        <div
                          key={entry.id ?? `${entry.name}-${entry.date}-${entry.request}`}
                          className={chipClass}
                        >
                          <span className="req__tag">{requestLabel || 'N/A'}</span>
                          {trimmedName ? (
                            <span className="req__name">&bull; {trimmedName}</span>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <span className="req req--default">
                      <span className="req__tag">No requests</span>
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
