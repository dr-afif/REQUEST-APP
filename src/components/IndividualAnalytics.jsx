import { useEffect, useMemo, useState } from 'react';
import { buildIndividualRosterTracking, deriveLeaveEpisodes, filterLeaveItemsByPeriod } from '../utils/leaveTracking';
import { normalizeForComparison } from '../utils/normalise';

const currentMonthKey = () => new Date().toISOString().slice(0, 7);

export default function IndividualAnalytics({ names = [], masterRoster = [], initialMonth = '' }) {
  const initialPeriod = initialMonth || currentMonthKey();
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState(names[0] || '');
  const [periodMode, setPeriodMode] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(initialPeriod);
  const [selectedYear, setSelectedYear] = useState(initialPeriod.slice(0, 4));

  useEffect(() => {
    if (!selectedMember && names.length) setSelectedMember(names[0]);
  }, [names, selectedMember]);

  const filteredNames = useMemo(() => {
    const query = normalizeForComparison(memberSearch);
    return names.filter((name) => !query || normalizeForComparison(name).includes(query));
  }, [names, memberSearch]);

  const tracking = useMemo(() => buildIndividualRosterTracking({
    masterRoster,
    memberName: selectedMember,
    year: selectedYear,
  }), [masterRoster, selectedMember, selectedYear]);

  const selectedMonthStats = tracking.months.find((month) => month.monthKey === selectedMonth)
    || tracking.months[0];
  const selectedStats = periodMode === 'year' ? tracking.totals : selectedMonthStats;
  const periodValue = periodMode === 'year' ? selectedYear : selectedMonth;
  const memberKey = normalizeForComparison(selectedMember);
  const leaveEpisodes = useMemo(() => filterLeaveItemsByPeriod(
    deriveLeaveEpisodes(masterRoster).filter((item) => item.memberKey === memberKey),
    { mode: periodMode, value: periodValue },
  ), [masterRoster, memberKey, periodMode, periodValue]);

  const stats = [
    ['AM', selectedStats?.AM || 0, 'bg-sky-50 border-sky-100 text-sky-950'],
    ['PM', selectedStats?.PM || 0, 'bg-indigo-50 border-indigo-100 text-indigo-950'],
    ['Night', selectedStats?.NIGHT || 0, 'bg-violet-50 border-violet-100 text-violet-950'],
    ['Weekend duties', selectedStats?.weekendShifts || 0, 'bg-emerald-50 border-emerald-100 text-emerald-950'],
    ['Public holiday duties', selectedStats?.publicHolidayShifts || 0, 'bg-teal-50 border-teal-100 text-teal-950'],
    ['MC', selectedStats?.MC || 0, 'bg-rose-50 border-rose-100 text-rose-950'],
    ['EL', selectedStats?.EL || 0, 'bg-amber-50 border-amber-100 text-amber-950'],
    ['AL', selectedStats?.AL || 0, 'bg-blue-50 border-blue-100 text-blue-950'],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="individual-heading">
        <div>
          <h2 id="individual-heading" className="text-lg font-extrabold text-slate-900">Individual shift and leave history</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a member and review monthly or yearly totals. The roster remains the source of truth.</p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-bold text-slate-700">
            Search member
            <input
              type="search"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Type a name"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Member
            <select
              value={selectedMember}
              onChange={(event) => setSelectedMember(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              {filteredNames.length === 0 && <option value={selectedMember}>{selectedMember || 'No match'}</option>}
              {filteredNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-bold text-slate-700">Period</legend>
            <div className="mt-2 flex min-h-11 rounded-xl border border-slate-300 bg-slate-50 p-1">
              {['month', 'year'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPeriodMode(mode)}
                  aria-pressed={periodMode === mode}
                  className={`flex-1 rounded-lg px-3 text-sm font-bold capitalize transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${periodMode === mode ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-bold text-slate-700">
            {periodMode === 'year' ? 'Year' : 'Month'}
            {periodMode === 'year' ? (
              <input
                type="number"
                min="2020"
                max="2100"
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value.slice(0, 4))}
                className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              />
            ) : (
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => {
                  setSelectedMonth(event.target.value);
                  setSelectedYear(event.target.value.slice(0, 4));
                }}
                className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              />
            )}
          </label>
        </div>
      </section>

      {!selectedMember ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No roster member is available.</div>
      ) : (
        <>
          <section aria-label="Selected member totals">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-extrabold text-slate-900">{selectedMember}</h3>
              <p className="text-sm font-semibold text-slate-500">{periodMode === 'year' ? selectedYear : selectedMonth}</p>
            </div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {stats.map(([label, value, style]) => (
                <article key={label} className={`rounded-2xl border p-4 ${style}`}>
                  <p className="text-xs font-bold uppercase tracking-wide opacity-70">{label}</p>
                  <p className="mt-2 text-2xl font-black">{value}</p>
                </article>
              ))}
            </div>
          </section>

          {periodMode === 'year' && (
            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="monthly-breakdown-heading">
              <h3 id="monthly-breakdown-heading" className="text-base font-extrabold text-slate-900">12-month breakdown</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-[760px] w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      {['Month', 'AM', 'PM', 'Night', 'Weekend', 'PH', 'MC', 'EL', 'AL'].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tracking.months.map((month) => (
                      <tr key={month.monthKey} className="hover:bg-slate-50">
                        <th className="px-3 py-3 font-bold text-slate-900">{month.monthLabel}</th>
                        <td className="px-3 py-3">{month.AM}</td><td className="px-3 py-3">{month.PM}</td><td className="px-3 py-3">{month.NIGHT}</td>
                        <td className="px-3 py-3">{month.weekendShifts}</td><td className="px-3 py-3">{month.publicHolidayShifts}</td>
                        <td className="px-3 py-3 font-bold text-rose-700">{month.MC}</td><td className="px-3 py-3 font-bold text-amber-700">{month.EL}</td><td className="px-3 py-3 font-bold text-blue-700">{month.AL}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <details className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <summary className="min-h-11 cursor-pointer select-none py-2 text-sm font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">Exact MC / EL / AL episodes ({leaveEpisodes.length})</summary>
            <div className="mt-3 divide-y divide-slate-100">
              {leaveEpisodes.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">No MC, EL or AL entries were found for this period.</p>
              ) : leaveEpisodes.map((episode) => (
                <div key={episode.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div><span className="font-extrabold text-slate-900">{episode.leaveType}</span><span className="ml-2 text-slate-600">{episode.startDate}{episode.endDate !== episode.startDate ? ` to ${episode.endDate}` : ''}</span></div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-bold text-slate-700">{episode.days} day{episode.days === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
