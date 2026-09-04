import { useMemo, useState } from 'react';
import { APP_ICONS } from '../constants/icons';
import {
  deriveLeaveEpisodes,
  filterLeaveItemsByPeriod,
  reconcileLeaveEpisodes,
  summarizeLeaveItems,
} from '../utils/leaveTracking';

const todayIso = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
};

const emptyFilters = { member: '', type: '', status: '' };

export default function LeaveTracker({
  masterRoster = [],
  leaveApplications = [],
  names = [],
  activeMonth = '',
  onUpsert,
  onDelete,
}) {
  const fallbackMonth = activeMonth || todayIso().slice(0, 7);
  const [periodMode, setPeriodMode] = useState('month');
  const [month, setMonth] = useState(fallbackMonth);
  const [year, setYear] = useState(fallbackMonth.slice(0, 4));
  const [filters, setFilters] = useState(emptyFilters);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const allItems = useMemo(() => reconcileLeaveEpisodes(
    deriveLeaveEpisodes(masterRoster),
    leaveApplications,
  ), [masterRoster, leaveApplications]);

  const periodItems = useMemo(() => filterLeaveItemsByPeriod(allItems, {
    mode: periodMode,
    value: periodMode === 'year' ? year : month,
  }), [allItems, periodMode, year, month]);

  const visibleItems = useMemo(() => periodItems.filter((item) => (
    (!filters.member || item.memberName === filters.member)
    && (!filters.type || item.leaveType === filters.type)
    && (!filters.status || item.status === filters.status)
  )), [periodItems, filters]);

  const summary = summarizeLeaveItems(periodItems);
  const orphanCount = periodItems.filter((item) => item.isRosterMatch === false).length;

  const openEditor = (item, suggestedStatus = item.status) => {
    const status = suggestedStatus || 'Pending';
    setEditingItem(item);
    setForm({
      status,
      submittedDate: status === 'Submitted' ? (item.submittedDate || todayIso()) : '',
      referenceNo: item.referenceNo || '',
      notes: item.notes || '',
    });
    setFormError('');
  };

  const closeEditor = () => {
    if (isSaving) return;
    setEditingItem(null);
    setForm(null);
    setFormError('');
  };

  const buildPayload = (item, values) => ({
    id: item.recordId || item.id,
    memberName: item.memberName,
    leaveType: item.leaveType,
    startDate: item.startDate,
    endDate: item.endDate,
    days: item.days,
    status: values.status,
    submittedDate: values.status === 'Submitted' ? values.submittedDate : '',
    referenceNo: values.referenceNo,
    notes: values.notes,
  });

  const saveEditor = async (event) => {
    event.preventDefault();
    if (!editingItem || !form) return;
    if (form.status === 'Submitted' && !form.submittedDate) {
      setFormError('Please enter the date the form was submitted.');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      await onUpsert?.(buildPayload(editingItem, form));
      setEditingItem(null);
      setForm(null);
    } catch (error) {
      setFormError(error.message || 'Could not save the leave form status.');
    } finally {
      setIsSaving(false);
    }
  };

  const returnToPending = async (item) => {
    if (!window.confirm(`Return ${item.memberName}'s ${item.leaveType} form to Pending?`)) return;
    try {
      await onUpsert?.(buildPayload(item, {
        status: 'Pending',
        submittedDate: '',
        referenceNo: item.referenceNo || '',
        notes: item.notes || '',
      }));
    } catch {
      // The shared toast reports the failure and restores the previous state.
    }
  };

  const removeOrphan = async (item) => {
    if (!window.confirm(`Remove the unmatched tracking record for ${item.memberName} (${item.leaveType})?`)) return;
    try {
      await onDelete?.(item.recordId);
    } catch {
      // The shared toast reports the failure and restores the previous state.
    }
  };

  const summaryCards = [
    ['Pending forms', summary.pending, 'border-rose-100 bg-rose-50 text-rose-950'],
    ['Submitted forms', summary.submitted, 'border-emerald-100 bg-emerald-50 text-emerald-950'],
    ['MC days', summary.MC, 'border-pink-100 bg-pink-50 text-pink-950'],
    ['EL days', summary.EL, 'border-amber-100 bg-amber-50 text-amber-950'],
    ['AL days', summary.AL, 'border-blue-100 bg-blue-50 text-blue-950'],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="leave-tracker-heading">
        <h2 id="leave-tracker-heading" className="text-lg font-extrabold text-slate-900">Leave application tracker</h2>
        <p className="mt-1 text-sm text-slate-500">Track whether the administrative form for each rostered MC, EL or AL episode has been submitted. Do not enter clinical details here.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <fieldset>
            <legend className="text-sm font-bold text-slate-700">Period</legend>
            <div className="mt-2 flex min-h-11 rounded-xl border border-slate-300 bg-slate-50 p-1">
              {['month', 'year'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPeriodMode(mode)}
                  aria-pressed={periodMode === mode}
                  className={`flex-1 rounded-lg px-2 text-sm font-bold capitalize focus:outline-none focus:ring-2 focus:ring-indigo-500 ${periodMode === mode ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
                >{mode}</button>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-bold text-slate-700">
            {periodMode === 'year' ? 'Year' : 'Month'}
            {periodMode === 'year' ? (
              <input type="number" min="2020" max="2100" value={year} onChange={(event) => setYear(event.target.value.slice(0, 4))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
            ) : (
              <input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setYear(event.target.value.slice(0, 4)); }} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
            )}
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Member
            <select value={filters.member} onChange={(event) => setFilters((current) => ({ ...current, member: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200">
              <option value="">All members</option>
              {names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Leave type
            <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200">
              <option value="">MC, EL and AL</option><option value="MC">MC</option><option value="EL">EL</option><option value="AL">AL</option>
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Form status
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200">
              <option value="">Pending and submitted</option><option value="Pending">Pending</option><option value="Submitted">Submitted</option>
            </select>
          </label>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Leave tracker totals">
        {summaryCards.map(([label, value, style]) => (
          <article key={label} className={`rounded-2xl border p-4 ${style}`}>
            <p className="text-xs font-bold uppercase tracking-wide opacity-70">{label}</p>
            <p className="mt-2 text-2xl font-black">{value}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="leave-records-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div>
            <h3 id="leave-records-heading" className="text-base font-extrabold text-slate-900">Rostered leave episodes</h3>
            <p className="mt-1 text-xs text-slate-500">{visibleItems.length} shown{orphanCount ? ` · ${orphanCount} unmatched tracking record${orphanCount === 1 ? '' : 's'}` : ''}</p>
          </div>
          {(filters.member || filters.type || filters.status) && (
            <button type="button" onClick={() => setFilters(emptyFilters)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Clear filters</button>
          )}
        </div>
        {visibleItems.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No rostered MC, EL or AL episodes match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[880px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Days</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleItems.map((item) => (
                  <tr key={`${item.id}-${item.isRosterMatch}`} className="align-top hover:bg-slate-50/70">
                    <td className="px-4 py-4"><p className="font-bold text-slate-900">{item.memberName}</p>{item.isRosterMatch === false && <p className="mt-1 text-xs font-bold text-rose-700">⚠ No longer matched to roster</p>}</td>
                    <td className="px-4 py-4 font-extrabold text-slate-800">{item.leaveType}</td>
                    <td className="px-4 py-4 text-slate-600">{item.startDate}{item.endDate !== item.startDate ? <><br /><span>to {item.endDate}</span></> : null}</td>
                    <td className="px-4 py-4 font-bold text-slate-800">{item.daysInPeriod ?? item.days}{item.daysInPeriod != null && item.daysInPeriod !== item.days ? <span className="mt-1 block text-xs font-normal text-slate-500">{item.days} in full episode</span> : null}</td>
                    <td className="px-4 py-4">
                      {item.status === 'Submitted' ? (
                        <div><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 font-bold text-emerald-800"><APP_ICONS.check className="h-4 w-4" aria-hidden="true" />Submitted</span>{item.submittedDate && <p className="mt-1 text-xs text-slate-500">{item.submittedDate}</p>}</div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-900"><APP_ICONS.clock className="h-4 w-4" aria-hidden="true" />Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-max justify-end gap-2">
                        {item.isRosterMatch === false ? (
                          <button type="button" onClick={() => removeOrphan(item)} className="min-h-11 rounded-xl border border-rose-200 px-3 font-bold text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500">Remove</button>
                        ) : item.status === 'Submitted' ? (
                          <><button type="button" onClick={() => openEditor(item)} className="min-h-11 rounded-xl border border-slate-200 px-3 font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Edit</button><button type="button" onClick={() => returnToPending(item)} className="min-h-11 rounded-xl border border-amber-200 px-3 font-bold text-amber-800 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500">Set pending</button></>
                        ) : (
                          <button type="button" onClick={() => openEditor(item, 'Submitted')} className="min-h-11 rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">Mark submitted</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingItem && form && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <form onSubmit={saveEditor} className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="leave-form-title">
            <div className="flex items-start justify-between gap-4">
              <div><h3 id="leave-form-title" className="text-lg font-extrabold text-slate-900">Leave form status</h3><p className="mt-1 text-sm text-slate-500">{editingItem.memberName} · {editingItem.leaveType} · {editingItem.startDate}{editingItem.endDate !== editingItem.startDate ? ` to ${editingItem.endDate}` : ''}</p></div>
              <button type="button" onClick={closeEditor} disabled={isSaving} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"><APP_ICONS.close className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-bold text-slate-700">Status<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value, submittedDate: event.target.value === 'Submitted' ? (current.submittedDate || todayIso()) : '' }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"><option value="Pending">Pending</option><option value="Submitted">Submitted</option></select></label>
              {form.status === 'Submitted' && <label className="block text-sm font-bold text-slate-700">Submitted date<input required type="date" value={form.submittedDate} onChange={(event) => setForm((current) => ({ ...current, submittedDate: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" /></label>}
              <label className="block text-sm font-bold text-slate-700">Reference number <span className="font-normal text-slate-400">(optional)</span><input type="text" maxLength="100" value={form.referenceNo} onChange={(event) => setForm((current) => ({ ...current, referenceNo: event.target.value }))} placeholder="e.g. HR form reference" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" /></label>
              <label className="block text-sm font-bold text-slate-700">Administrative note <span className="font-normal text-slate-400">(optional)</span><textarea rows="3" maxLength="500" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Avoid clinical or sensitive medical details" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" /></label>
              {formError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{formError}</p>}
            </div>
            <div className="mt-6 flex gap-3"><button type="button" onClick={closeEditor} disabled={isSaving} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-4 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button><button type="submit" disabled={isSaving} className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">{isSaving ? 'Saving…' : 'Save status'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
