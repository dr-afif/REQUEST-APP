import {useCallback,useEffect,useMemo,useState} from 'react';
import guidance from '../guidance.js';
import {createGuidanceRepository,createPolicyMutation} from '../data/guidanceRepository.js';
import {getAdminSessionToken, isSessionTokenActive} from '../auth/adminAuth.js';

const messages={
  PROVISIONAL_WEEK:'Week is incomplete because an adjacent period is unavailable.',
  WEEKLY_OFF_SHORTFALL:'Normal OFF requirement is not met operationally.',
  UNKNOWN_SEMANTIC:'An unknown shift prevents a reliable result.',
  SEVENTH_WORKED_DAY:'Worked-day sequence exceeds the six-day guidance threshold.',
  NIGHT_BUNDLE_PREDECESSOR:'Night recovery marker has an unexpected predecessor.',
  NIGHT_BUNDLE_FOLLOWER:'Night duty is missing its expected continuation or PN.',
  INSUFFICIENT_POST_NIGHT_REST:'Worked duty continues after night duty without protected recovery.',
  INCOMPLETE_SEQUENCE_CONTEXT:'Adjacent roster context is unavailable, so consecutive-work and night guidance is provisional.'
};

const guidanceErrorMessages={AUTHORIZATION_REQUIRED:'Administrator identity could not be verified'};
const monthBefore=period=>guidance.addDays(period+'-01',-1).slice(0,7);
const monthAfter=period=>guidance.addDays(guidance.periodDates(period).at(-1),1).slice(0,7);

function getBoundaryReason(weekStart, currentPeriod) {
  if (weekStart < currentPeriod + '-01') {
    const prev = monthBefore(currentPeriod);
    return `boundary week ${weekStart} is provisional because previous month (${prev}) V2 context is unavailable.`;
  }
  const dates = guidance.weekDates(weekStart);
  const lastDate = dates[dates.length - 1];
  if (lastDate > currentPeriod + '-31') {
    const next = monthAfter(currentPeriod);
    return `boundary week ${weekStart} is provisional because following month (${next}) V2 context is unavailable.`;
  }
  return `boundary week ${weekStart} is provisional because adjacent period context is incomplete.`;
}

export default function RosterGuidancePanel({period,settings,queue,people=[],repository,isVerifiedAdmin=false,allowPolicyWrites=true,initialReady=false,initialPolicies=[]}){
  const isVerified=Boolean(isVerifiedAdmin);
  const [policies,setPolicies]=useState(initialPolicies),[revision,setRevision]=useState(0),[ready,setReady]=useState(initialReady),[loadedPeriod,setLoadedPeriod]=useState(initialReady ? period : null),[error,setError]=useState('');
  const [policyCode,setPolicyCode]=useState('B'),[effectiveMonday,setEffectiveMonday]=useState(guidance.mondayOf(period+'-01')),[reason,setReason]=useState('');
  const [acknowledgements,setAcknowledgements]=useState(()=>{try{return JSON.parse(localStorage.getItem('roster_phase3_acknowledgements_v1')||'[]');}catch{return[];}});
  // Compact / operator view toggles
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllWeeks, setShowAllWeeks] = useState(false);

  const flags=useMemo(()=>({weekly:settings.weekly_off_guidance_enabled===true||settings.weekly_off_guidance_enabled==='true',night:settings.night_safety_guidance_enabled===true||settings.night_safety_guidance_enabled==='true'}),[settings]);
  const repo=useMemo(()=>repository||createGuidanceRepository({getAdminSessionToken}),[repository]);
  const policyMutation=useMemo(()=>createPolicyMutation({store:queue.store,repository:repo,clientId:queue.clientId,tabId:queue.tabId}),[queue,repo]);
  const load=useCallback(async()=>{const result=await repo.policies();if(!result.ok)throw new Error(result.error.code);return result;},[repo]);

  useEffect(()=>{
    setReady(false);
    setError('');
    if(!flags.weekly&&!flags.night)return;
    let live=true;
    (async()=>{
      try{
        if(flags.weekly){
          if(allowPolicyWrites){
            const resumed=await policyMutation.resume();
            if(resumed&&resumed.status!=='CONFIRMED')throw new Error(resumed.errorCode||resumed.status);
          }
          const result=await load();
          if(!live)return;
          setPolicies(result.policies);
          setRevision(result.revision);
        }
        for(const month of [monthBefore(period),period,monthAfter(period)]) {
          try { await queue.refresh('draft:'+month); } catch { /* unavailable adjacent period remains provisional */ }
        }
        if(live){
          setLoadedPeriod(period);
          setReady(true);
        }
      }catch(e){
        if(live)setError(e.message);
      }
    })();
    return()=>{live=false;};
  },[period,queue,flags.weekly,flags.night,policyMutation,load,allowPolicyWrites]);

  const peopleMap = useMemo(() => new Map((people || []).map(p => [p.PersonId, p])), [people]);
  const getPersonName = useCallback(id => peopleMap.get(id)?.CurrentDisplayName || id, [peopleMap]);

  const evaluations=useMemo(()=>{
    if(!ready||loadedPeriod!==period)return {weeks:[],issues:[]};
    const months=[monthBefore(period),period,monthAfter(period)],available=[],cells={};
    let availableMonths=0;
    for(const month of months){
      const view=queue.view('draft:'+month);
      if(view?.baseline?.checksum!==null){
        availableMonths++;
        available.push(...guidance.periodDates(month));
      }
      Object.assign(cells,view?.cells||{});
    }
    const weeks=[],issues=[];
    for(const person of people.filter(item=>item.DirectoryType==='MO')){
      const byDate={};
      for(const [cell,value] of Object.entries(cells)) {
        if(cell.startsWith(person.PersonId+'/')) byDate[cell.split('/')[1]]=value;
      }
      if(flags.weekly) {
        for(const weekStart of guidance.weeksForPeriod(period)){
          try{
            const result=guidance.evaluateWeek({weekStart,personId:person.PersonId,plannedByDate:byDate,currentByDate:byDate,availablePlannedDates:available,policies,acknowledgements});
            weeks.push(result);
            issues.push(...result.issues);
          }catch(e){
            issues.push({id:'policy:'+person.PersonId+':'+weekStart,code:e.message,personId:person.PersonId,weekStart,severity:'ADVISORY'});
          }
        }
      }
      const ordered=available.sort().map(date=>({date,assignments:byDate[date]||[]}));
      if(flags.night){
        const sequence=guidance.evaluateSequences({personId:person.PersonId,days:ordered,completeContext:availableMonths===3,contextKey:period,acknowledgements});
        issues.push(...sequence.issues);
      }
    }
    return {weeks,issues:[...new Map(issues.map(item=>[item.id,item])).values()]};
  },[ready,loadedPeriod,policies,period,people,queue,acknowledgements,flags.weekly,flags.night]);

  const acknowledge=item=>{
    const next=[...acknowledgements.filter(record=>record.issueId!==item.id),guidance.acknowledgeIssue(item)];
    setAcknowledgements(next);
    try{localStorage.setItem('roster_phase3_acknowledgements_v1',JSON.stringify(next));}catch{/* session storage */}
  };

  const authReady = ready && !error;
  const canAddPolicy = Boolean(
    allowPolicyWrites &&
    flags.weekly &&
    guidance.policyWritesEnabled(settings) &&
    isVerified &&
    !error &&
    (typeof window === 'undefined' ? true : authReady)
  );

  const savePolicy=async()=>{
    if(!allowPolicyWrites || !isVerified || (typeof window !== 'undefined' && !authReady)){
      setError('AUTHORIZATION_REQUIRED');
      return;
    }
    setError('');
    try{
      const result=await policyMutation.save({policyId:crypto.randomUUID(),policyCode,effectiveMonday,reason},revision);
      if(!result?.ok||result.status!=='CONFIRMED')throw new Error(result?.error?.code||result?.status||'RECOVERY_REQUIRED');
      const refreshed=await load();
      setPolicies(refreshed.policies);
      setRevision(refreshed.revision);
      setReason('');
    }catch(e){
      setError(e.message);
    }
  };

  const activePolicyCode = useMemo(() => {
    try {
      if (policies && policies.length > 0) {
        const p = guidance.selectPolicy(policies, guidance.mondayOf(period + '-01'));
        return p?.policyCode || 'B';
      }
    } catch (_) {}
    return 'B';
  }, [policies, period]);

  const totalShortfall = useMemo(() => {
    return evaluations.weeks.reduce((sum, w) => sum + (Number(w.shortfall) || 0), 0);
  }, [evaluations.weeks]);

  const affectedDoctorsCount = useMemo(() => {
    const doctorIds = new Set();
    for (const w of evaluations.weeks) {
      if (w.shortfall && w.shortfall > 0) {
        doctorIds.add(w.personId);
      }
    }
    return doctorIds.size;
  }, [evaluations.weeks]);

  const safetyIssues = useMemo(() => {
    return evaluations.issues.filter(i => ['SEVENTH_WORKED_DAY', 'NIGHT_BUNDLE_PREDECESSOR', 'NIGHT_BUNDLE_FOLLOWER', 'INSUFFICIENT_POST_NIGHT_REST', 'UNKNOWN_SEMANTIC'].includes(i.code));
  }, [evaluations.issues]);

  const hasIncompleteSequenceContext = useMemo(() => {
    return evaluations.issues.some(i => i.code === 'INCOMPLETE_SEQUENCE_CONTEXT');
  }, [evaluations.issues]);

  const hasProvisionalWeek = useMemo(() => {
    return evaluations.issues.some(i => i.code === 'PROVISIONAL_WEEK');
  }, [evaluations.issues]);

  const hasIncompleteContext = hasIncompleteSequenceContext || hasProvisionalWeek;
  const isBoundaryProvisional = hasIncompleteContext;

  // Filtered weeks for expanded table: default problem weeks only
  const displayedWeeks = useMemo(() => {
    if (showAllWeeks) return evaluations.weeks;
    return evaluations.weeks.filter(w => w.status !== 'COMPLETE' || (w.shortfall && w.shortfall > 0));
  }, [evaluations.weeks, showAllWeeks]);

  // Aggregated boundary issues grouped by context / week
  const provisionalWeeksByDate = useMemo(() => {
    const map = new Map();
    for (const item of evaluations.issues) {
      if (item.code === 'PROVISIONAL_WEEK') {
        const key = item.weekStart;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
      }
    }
    return map;
  }, [evaluations.issues]);

  const incompleteSequenceIssues = useMemo(() => {
    return evaluations.issues.filter(i => i.code === 'INCOMPLETE_SEQUENCE_CONTEXT');
  }, [evaluations.issues]);

  // Actionable issues (non-boundary context)
  const actionableIssues = useMemo(() => {
    return evaluations.issues.filter(i => i.code !== 'PROVISIONAL_WEEK' && i.code !== 'INCOMPLETE_SEQUENCE_CONTEXT');
  }, [evaluations.issues]);

  if(!flags.weekly&&!flags.night)return null;
  if(ready&&queue?.view?.('draft:'+period)?.baseline?.checksum===null)return null;

  return (
    <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-xs" aria-label="Roster guidance">
      {/* Collapsed Operator Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-slate-900">Advisory roster guidance — {period}</span>
          <span className="text-amber-400">·</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-200 text-amber-900 border border-amber-300">
            Policy {activePolicyCode}
          </span>
          <span className="text-amber-400">·</span>
          <span className={`text-xs font-medium ${totalShortfall > 0 ? 'text-amber-900 font-semibold' : 'text-slate-600'}`}>
            OFF deficit: {totalShortfall} {totalShortfall === 1 ? 'day' : 'days'}
            {totalShortfall > 0 && affectedDoctorsCount > 0 && (
              <> · {affectedDoctorsCount} {affectedDoctorsCount === 1 ? 'doctor' : 'doctors'} affected</>
            )}
          </span>
          <span className="text-amber-400">·</span>
          <span className={`text-xs font-medium ${safetyIssues.length > 0 ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
            {safetyIssues.length > 0
              ? `${safetyIssues.length} safety ${safetyIssues.length === 1 ? 'warning' : 'warnings'}`
              : hasIncompleteContext
                ? '0 detected safety warnings'
                : '0 safety warnings'}
          </span>
          {hasIncompleteContext && (
            <>
              <span className="text-amber-400">·</span>
              <span className="text-xs text-amber-800 italic">
                {hasIncompleteSequenceContext && hasProvisionalWeek
                  ? 'boundary & safety context provisional'
                  : hasIncompleteSequenceContext
                    ? 'safety context provisional'
                    : 'boundary context provisional'}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(prev => !prev)}
          className="min-h-8 px-3 py-1 text-xs font-medium rounded-lg border border-amber-400 bg-white hover:bg-amber-100/70 text-amber-950 transition-colors shadow-xs"
        >
          {isExpanded ? 'Hide guidance' : 'View guidance'}
        </button>
      </div>
      <p className="text-xs text-slate-600 mt-1">
        Warnings are advisory and never change roster assignments. Guidance is calculated from the current draft roster.
      </p>

      {error && (
        <p role="alert" className="text-sm font-medium text-amber-900 bg-amber-100 p-2 rounded border border-amber-300 mt-2">
          {guidanceErrorMessages[error] || error}
        </p>
      )}

      {/* Expanded Guidance Details */}
      {isExpanded && ready && !error && (
        <div className="mt-4 pt-3 border-t border-amber-200/80 space-y-4">
          <h2 className="text-base font-semibold text-slate-900 sr-only">Advisory roster guidance details — {period}</h2>

          {/* Weekly OFF Requirements */}
          {flags.weekly && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">Weekly OFF Requirements</h3>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllWeeks}
                    onChange={e => setShowAllWeeks(e.target.checked)}
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span>Show all weeks ({evaluations.weeks.length})</span>
                </label>
              </div>

              {displayedWeeks.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 bg-white/60 rounded border border-amber-200">
                  No weekly OFF shortfalls or incomplete weeks detected. All evaluated weeks meet requirements.
                </p>
              ) : (
                <div className="overflow-x-auto rounded border border-amber-200 bg-white">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-amber-100/70 border-b border-amber-200 text-slate-700 font-semibold">
                      <tr>
                        <th className="p-2">Doctor</th>
                        <th className="p-2">Week</th>
                        <th className="p-2">Policy</th>
                        <th className="p-2">Required OFF</th>
                        <th className="p-2">Assigned / Operational OFF</th>
                        <th className="p-2">Shortfall</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {displayedWeeks.map(row => {
                        const isProblem = row.status !== 'COMPLETE' || (row.shortfall && row.shortfall > 0);
                        return (
                          <tr key={row.personId + row.weekStart} className={isProblem ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-slate-50'}>
                            <td className="p-2 font-medium text-slate-900">{getPersonName(row.personId)}</td>
                            <td className="p-2 font-mono text-slate-700">{row.weekStart}</td>
                            <td className="p-2 text-slate-700">{row.policy?.policyCode || activePolicyCode}</td>
                            <td className="p-2 text-slate-700">{row.requiredOff ?? '—'}</td>
                            <td className="p-2 text-slate-700">
                              {row.plannedAssignedOff != null
                                ? `${row.plannedAssignedOff} / ${row.currentOperationalOff ?? 0}`
                                : (row.currentOperationalOff ?? '—')}
                            </td>
                            <td className="p-2">
                              {row.shortfall ? (
                                <span className="font-semibold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded">
                                  {row.shortfall}
                                </span>
                              ) : '0'}
                            </td>
                            <td className="p-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium ${
                                row.status === 'COMPLETE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : row.status === 'SHORTFALL'
                                  ? 'bg-amber-100 text-amber-900 font-semibold'
                                  : 'bg-slate-100 text-slate-700'
                              }`}>
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Issues Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">Issues & Guidance</h3>

            {/* Aggregated Boundary Context Notices */}
            {(provisionalWeeksByDate.size > 0 || incompleteSequenceIssues.length > 0) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Boundary & Context Notices</h4>
                {[...provisionalWeeksByDate.entries()].map(([weekStart, items]) => (
                  <div key={weekStart} className="p-2.5 rounded-lg border border-amber-200 bg-amber-100/50 text-xs text-amber-950">
                    <p className="font-medium">
                      {items.length} doctors — {getBoundaryReason(weekStart, period)}
                    </p>
                    <details className="mt-1 text-slate-600">
                      <summary className="cursor-pointer text-[11px] text-amber-900 hover:underline">
                        Inspect {items.length} underlying doctor records
                      </summary>
                      <ul className="mt-2 space-y-1.5 pl-2 border-l border-amber-300">
                        {items.map(item => (
                          <li key={item.id} className="flex items-center justify-between gap-2">
                            <span>{getPersonName(item.personId)} — {item.weekStart}: {messages[item.code] || item.code}</span>
                            {!item.acknowledged && (
                              <button
                                type="button"
                                className="min-h-7 border border-slate-300 rounded px-2 py-0.5 text-[11px] bg-white hover:bg-slate-50 text-slate-700"
                                onClick={() => acknowledge(item)}
                              >
                                Mark reviewed
                              </button>
                            )}
                            {item.acknowledged && <span className="text-[11px] text-emerald-700 font-medium">Reviewed</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                ))}

                {incompleteSequenceIssues.length > 0 && (
                  <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-100/50 text-xs text-amber-950">
                    <p className="font-medium">
                      Adjacent-period context unavailable for {incompleteSequenceIssues.length} doctors (adjacent V2 periods not enrolled/loaded). Consecutive-work and night guidance is provisional.
                    </p>
                    <details className="mt-1 text-slate-600">
                      <summary className="cursor-pointer text-[11px] text-amber-900 hover:underline">
                        Inspect {incompleteSequenceIssues.length} underlying doctor records
                      </summary>
                      <ul className="mt-2 space-y-1.5 pl-2 border-l border-amber-300">
                        {incompleteSequenceIssues.map(item => (
                          <li key={item.id} className="flex items-center justify-between gap-2">
                            <span>{getPersonName(item.personId)}: {messages[item.code] || item.code}</span>
                            {!item.acknowledged && (
                              <button
                                type="button"
                                className="min-h-7 border border-slate-300 rounded px-2 py-0.5 text-[11px] bg-white hover:bg-slate-50 text-slate-700"
                                onClick={() => acknowledge(item)}
                              >
                                Mark reviewed
                              </button>
                            )}
                            {item.acknowledged && <span className="text-[11px] text-emerald-700 font-medium">Reviewed</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
              </div>
            )}

            {/* Actionable Clinical / Operational Issues */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Actionable Issues</h4>
              {actionableIssues.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-2 bg-white/60 rounded border border-amber-200">
                  No actionable shortfall or safety issues.
                </p>
              ) : (
                <ul className="space-y-2">
                  {actionableIssues.map(item => (
                    <li key={item.id} className="p-2.5 rounded-lg border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2 shadow-xs">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{getPersonName(item.personId)}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs font-mono text-slate-600">{item.date || item.weekStart || item.contextKey || period}</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                            {item.code}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700">
                          {messages[item.code] || item.code}
                          {item.shortfall ? ` (${item.shortfall} day shortfall)` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.acknowledged ? (
                          <span className="text-xs text-emerald-700 font-medium px-2 py-1 rounded bg-emerald-50 border border-emerald-200">
                            Reviewed
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="min-h-8 border border-slate-300 rounded px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-50 text-slate-800 transition-colors"
                            onClick={() => acknowledge(item)}
                          >
                            Mark reviewed
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add effective OFF policy controls (admin only) */}
      {canAddPolicy && (
        <fieldset className="mt-3 border-t border-amber-200 pt-3">
          <legend className="font-semibold text-xs text-slate-800 uppercase tracking-wider">Add effective OFF policy</legend>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <label className="text-xs">
              Policy
              <select
                className="ml-1 border border-slate-300 rounded p-1 bg-white text-xs"
                value={policyCode}
                onChange={event => setPolicyCode(event.target.value)}
              >
                <option value="B">B</option>
                <option value="A">A</option>
              </select>
            </label>
            <label className="text-xs">
              Effective Monday
              <input
                type="date"
                className="ml-1 border border-slate-300 rounded p-1 bg-white text-xs"
                value={effectiveMonday}
                onChange={event => setEffectiveMonday(event.target.value)}
              />
            </label>
            <label className="text-xs">
              Reason
              <input
                className="ml-1 border border-slate-300 rounded p-1 bg-white text-xs"
                value={reason}
                maxLength={500}
                onChange={event => setReason(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="min-h-8 border border-amber-400 bg-white hover:bg-amber-100 rounded px-3 text-xs font-medium"
              onClick={savePolicy}
            >
              Add policy
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
