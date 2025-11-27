import { useEffect, useMemo, useState } from 'react';
import { normalizeForComparison } from '../utils/normalise';

function formatDisplayDate(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return dateLike;

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  });
}

function getMonthToken(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthLabel(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function UserRequests({
  requests,
  selectedName,
  onEdit,
  onDelete,
  isLoading,
}) {
  const [expandedMonths, setExpandedMonths] = useState([]);

  const filteredRequests = useMemo(() => {
    if (!selectedName) return [];
    const comparisonName = normalizeForComparison(selectedName);

    return requests
      .filter((request) => {
        if (!request.status || request.status.toLowerCase() !== 'active') return false;
        if (!request.name) return false;
        return normalizeForComparison(request.name) === comparisonName;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [requests, selectedName]);

  const groupedRequests = useMemo(() => {
    const groups = new Map();

    filteredRequests.forEach((request) => {
      const token = getMonthToken(request.date) ?? 'unknown';
      if (!groups.has(token)) {
        groups.set(token, { key: token, label: getMonthLabel(request.date), items: [] });
      }
      groups.get(token).items.push(request);
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === 'unknown') return 1;
      if (b.key === 'unknown') return -1;
      return a.key.localeCompare(b.key);
    });
  }, [filteredRequests]);

  useEffect(() => {
    if (!groupedRequests.length) {
      setExpandedMonths([]);
      return;
    }
    setExpandedMonths([groupedRequests[0].key]);
  }, [groupedRequests, selectedName]);

  const toggleGroup = (key) => {
    setExpandedMonths((prev) => {
      if (prev.includes(key)) {
        return prev.filter((item) => item !== key);
      }
      return [...prev, key];
    });
  };

  if (!selectedName) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
        Select your name to see your requests.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-white p-4 text-center text-sm text-slate-500">
        Loading your requests...
      </div>
    );
  }

  if (!filteredRequests.length) {
    return (
      <div className="rounded-3xl bg-white p-4 text-center text-sm text-slate-500">
        No active requests yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groupedRequests.map((group) => {
        const isExpanded = expandedMonths.includes(group.key);
        return (
          <div key={group.key} className="rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-900"
              onClick={() => toggleGroup(group.key)}
            >
              <span>{group.label}</span>
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                {group.items.length} request{group.items.length === 1 ? '' : 's'}
                <span className="rounded-full border border-slate-300 px-2 py-0.5 text-slate-600">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </span>
            </button>
            {isExpanded ? (
              <ul className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3">
                {group.items.map((request) => {
                  const submissionLabel = request.timestamp
                    ? new Date(request.timestamp).toLocaleString()
                    : 'Timestamp unavailable';

                  return (
                    <li
                      key={request.id ?? `${request.name}-${request.date}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {formatDisplayDate(request.date)} | {request.request}
                        </p>
                        <p className="text-xs text-slate-500">Submitted {submissionLabel}</p>
                        {request.comment ? (
                          <p className="mt-1 max-w-lg text-xs text-slate-600">{request.comment}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-600 transition hover:bg-amber-50"
                          onClick={() => onEdit?.(request)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                          onClick={() => onDelete?.(request)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
