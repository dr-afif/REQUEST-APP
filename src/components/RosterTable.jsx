import { useMemo, useState } from 'react';
import { normalizeForComparison, toIsoDate } from '../utils/normalise';

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

function buildDatesForMonth(referenceDate) {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);

  const days = [];
  for (let day = 1; day <= end.getDate(); day += 1) {
    const dateObj = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), day);
    const key = toIsoDate(dateObj);
    days.push({
      key,
      label: dateObj.toLocaleDateString(undefined, { day: 'numeric', weekday: 'short' }),
      raw: dateObj,
    });
  }
  return days;
}

function isWeekend(dateObj) {
  const day = dateObj.getDay();
  return day === 0 || day === 6;
}

function groupRequestsByNameAndDate(requests) {
  const grouped = new Map();

  (requests ?? []).forEach((request) => {
    const status = (request?.status ?? '').toLowerCase();
    if (status && status !== 'active') return;

    const nameKey = normalizeForComparison(request?.name);
    if (!nameKey) return;

    const dateKey = toIsoDate(request?.date);
    if (!dateKey) return;

    if (!grouped.has(nameKey)) {
      grouped.set(nameKey, new Map());
    }
    grouped.get(nameKey).set(dateKey, request?.request ?? '');
  });

  return grouped;
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

export default function RosterTable({ names, requests, referenceDate, isLoadingNames, namesError }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);

  const effectiveReferenceDate = useMemo(() => {
    if (referenceDate) {
      const base = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
      return new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1 + monthOffset, 1);
  }, [referenceDate, monthOffset]);

  const dates = useMemo(() => buildDatesForMonth(effectiveReferenceDate), [effectiveReferenceDate]);
  const requestMap = useMemo(() => groupRequestsByNameAndDate(requests), [requests]);

  const headerLabel = effectiveReferenceDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const nameOrder = useMemo(() => [...(names ?? [])], [names]);

  const renderCellValue = (name, dateKey) => {
    const nameKey = normalizeForComparison(name);
    const row = requestMap.get(nameKey);
    if (!row) return '';
    return row.get(dateKey) ?? '';
  };

  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Roster Table</p>
          <h2 className="text-xl font-semibold text-slate-900">
            Upcoming month: {headerLabel}
          </h2>
          <p className="text-xs text-slate-500">
            Names ordered per Team Member sheet; shifts populated from requests.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1 py-1">
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
              onClick={() => setMonthOffset((value) => value - 1)}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
              onClick={() => setMonthOffset((value) => value + 1)}
            >
              Next ›
            </button>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            onClick={() => setIsCollapsed((value) => !value)}
          >
            {isCollapsed ? 'Show table' : 'Hide table'}
          </button>
        </div>
      </header>

      {namesError ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {namesError}
        </div>
      ) : null}

      {isCollapsed ? null : (
        <div className="mt-4 overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200">
                  Name
                </th>
                {dates.map((day) => (
                  <th
                    key={day.key}
                    className={[
                      'whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700',
                      isWeekend(day.raw) ? 'bg-indigo-50' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {day.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoadingNames ? (
                <tr>
                  <td
                    className="px-3 py-3 text-sm text-slate-500"
                    colSpan={dates.length + 1}
                  >
                    Loading team members...
                  </td>
                </tr>
              ) : !nameOrder.length ? (
                <tr>
                  <td
                    className="px-3 py-3 text-sm text-slate-500"
                    colSpan={dates.length + 1}
                  >
                    No team members available.
                  </td>
                </tr>
              ) : (
                nameOrder.map((name) => (
                  <tr key={name}>
                    <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200">
                      {name}
                    </th>
                    {dates.map((day) => (
                      <td
                        key={day.key}
                        className={[
                          'border-b border-slate-100 px-3 py-2 text-slate-700',
                          isWeekend(day.raw) ? 'bg-slate-50' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {(() => {
                          const value = renderCellValue(name, day.key);
                          if (!value) return '';
                          const variantClass = getRequestVariant(value);
                          const chipClass = ['req', variantClass].filter(Boolean).join(' ');
                          return <span className={chipClass}>{value}</span>;
                        })()}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
