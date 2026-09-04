import { APP_ICONS } from '../constants/icons';
import { summarizeLeaveItems } from '../utils/leaveTracking';

const cardStyles = {
  health: 'border-indigo-100 bg-indigo-50/70 text-indigo-950',
  warning: 'border-amber-100 bg-amber-50/70 text-amber-950',
  pending: 'border-rose-100 bg-rose-50/70 text-rose-950',
  leave: 'border-emerald-100 bg-emerald-50/70 text-emerald-950',
};

export default function AnalyticsOverview({
  healthScore,
  coverageIssues = [],
  leaveItems = [],
  overview = {},
  monthName = '',
  onNavigateTab,
}) {
  const leaveSummary = summarizeLeaveItems(leaveItems);
  const pendingItems = leaveItems.filter((item) => item.isRosterMatch !== false && item.status !== 'Submitted');
  const needsAttention = [
    ...coverageIssues.slice(0, 3).map((issue) => ({
      key: `coverage-${issue.date}`,
      title: issue.label || issue.date,
      detail: issue.issues?.join(', ') || 'Coverage needs review',
      action: 'Open advanced analytics',
      tab: 'advanced',
      tone: issue.severity === 'high' ? 'Critical' : 'Review',
    })),
    ...pendingItems.slice(0, 3).map((item) => ({
      key: `leave-${item.id}`,
      title: `${item.memberName} · ${item.leaveType}`,
      detail: `${item.startDate}${item.endDate !== item.startDate ? ` to ${item.endDate}` : ''} · ${item.days} day${item.days === 1 ? '' : 's'}`,
      action: 'Update leave form',
      tab: 'leave',
      tone: 'Pending form',
    })),
  ].slice(0, 6);

  const cards = [
    { label: 'Roster health', value: `${healthScore?.score ?? 100}/100`, note: healthScore?.status || 'Excellent', style: cardStyles.health },
    { label: 'Coverage alerts', value: coverageIssues.length, note: coverageIssues.length ? 'Dates requiring review' : 'No flagged dates', style: cardStyles.warning },
    { label: 'Pending leave forms', value: leaveSummary.pending, note: 'MC / EL / AL episodes', style: cardStyles.pending },
    { label: 'Tracked leave days', value: leaveSummary.days, note: `MC ${leaveSummary.MC} · EL ${leaveSummary.EL} · AL ${leaveSummary.AL}`, style: cardStyles.leave },
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="overview-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="overview-heading" className="text-lg font-extrabold text-slate-900">At a glance</h2>
            <p className="mt-1 text-sm text-slate-500">The main decisions and follow-ups for {monthName || 'this month'}.</p>
          </div>
          <p className="text-xs font-semibold text-slate-500">{overview.totalMembers || 0} roster members</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <article key={card.label} className={`rounded-2xl border p-4 shadow-sm ${card.style}`}>
              <p className="text-xs font-bold uppercase tracking-wide opacity-70">{card.label}</p>
              <p className="mt-2 text-3xl font-black">{card.value}</p>
              <p className="mt-1 text-xs font-semibold opacity-75">{card.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="attention-heading">
        <div className="flex items-center gap-2">
          <APP_ICONS.warning className="h-5 w-5 text-amber-600" aria-hidden="true" />
          <h2 id="attention-heading" className="text-base font-extrabold text-slate-900">Needs attention</h2>
        </div>
        {needsAttention.length === 0 ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-900">
            <APP_ICONS.check className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Nothing urgent is flagged</p>
              <p className="mt-1 text-sm text-emerald-800">Coverage checks are clear and all tracked MC, EL and AL forms are marked submitted.</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {needsAttention.map((item) => (
              <div key={item.key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-700">{item.tone}</p>
                  <p className="mt-1 font-bold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab?.(item.tab)}
                  className="min-h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {item.action}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Monthly roster totals">
        {[
          ['AM shifts', overview.totalAmShifts || 0],
          ['PM shifts', overview.totalPmShifts || 0],
          ['Night shifts', overview.totalNightShifts || 0],
          ['All leave days', overview.totalLeaveDays || 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
