import { useMemo } from 'react';
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

export default function UserRequests({
  requests,
  selectedName,
  onEdit,
  onDelete,
  isLoading,
}) {
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
    <ul className="flex flex-col gap-3">
      {filteredRequests.map((request) => {
        const submissionLabel = request.timestamp
          ? new Date(request.timestamp).toLocaleString()
          : 'Timestamp unavailable';

        return (
          <li
            key={request.id ?? `${request.name}-${request.date}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
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
  );
}