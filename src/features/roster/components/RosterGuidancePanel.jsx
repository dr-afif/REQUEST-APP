import {useCallback,useEffect,useMemo,useState} from 'react';
import guidance from '../guidance.js';
import {createGuidanceRepository,createPolicyMutation} from '../data/guidanceRepository.js';

const messages={PROVISIONAL_WEEK:'Week is incomplete because an adjacent period is unavailable.',WEEKLY_OFF_SHORTFALL:'Normal OFF requirement is not met operationally.',
  UNKNOWN_SEMANTIC:'An unknown shift prevents a reliable result.',SEVENTH_WORKED_DAY:'Worked-day sequence exceeds the six-day guidance threshold.',
  NIGHT_BUNDLE_PREDECESSOR:'Night recovery marker has an unexpected predecessor.',NIGHT_BUNDLE_FOLLOWER:'Night duty is missing its expected continuation or PN.',
  INSUFFICIENT_POST_NIGHT_REST:'Worked duty continues after night duty without protected recovery.',INCOMPLETE_SEQUENCE_CONTEXT:'Adjacent roster context is unavailable, so consecutive-work and night guidance is provisional.'};
const monthBefore=period=>guidance.addDays(period+'-01',-1).slice(0,7);
const monthAfter=period=>guidance.addDays(guidance.periodDates(period).at(-1),1).slice(0,7);
export default function RosterGuidancePanel({period,settings,queue,people,repository}){
  const [policies,setPolicies]=useState([]),[revision,setRevision]=useState(0),[ready,setReady]=useState(false),[loadedPeriod,setLoadedPeriod]=useState(null),[error,setError]=useState('');
  const [policyCode,setPolicyCode]=useState('A'),[effectiveMonday,setEffectiveMonday]=useState(guidance.mondayOf(period+'-01')),[reason,setReason]=useState('');
  const [acknowledgements,setAcknowledgements]=useState(()=>{try{return JSON.parse(localStorage.getItem('roster_phase3_acknowledgements_v1')||'[]');}catch{return[];}});
  const flags=useMemo(()=>({weekly:settings.weekly_off_guidance_enabled===true||settings.weekly_off_guidance_enabled==='true',night:settings.night_safety_guidance_enabled===true||settings.night_safety_guidance_enabled==='true'}),[settings]);
  const repo=useMemo(()=>repository||createGuidanceRepository(),[repository]);
  const policyMutation=useMemo(()=>createPolicyMutation({store:queue.store,repository:repo,clientId:queue.clientId,tabId:queue.tabId}),[queue,repo]);
  const load=useCallback(async()=>{const result=await repo.policies();if(!result.ok)throw new Error(result.error.code);return result;},[repo]);
  useEffect(()=>{setReady(false);setError('');if(!flags.weekly&&!flags.night)return;let live=true;(async()=>{try{if(flags.weekly){const resumed=await policyMutation.resume();if(resumed&&resumed.status!=='CONFIRMED')throw new Error(resumed.errorCode||resumed.status);
        const result=await load();if(!live)return;setPolicies(result.policies);setRevision(result.revision);}for(const month of [monthBefore(period),period,monthAfter(period)])try{await queue.refresh('draft:'+month);}catch{/* unavailable adjacent period remains provisional */}
      if(live){setLoadedPeriod(period);setReady(true);}}catch(e){if(live)setError(e.message);}})();return()=>{live=false;};},[period,queue,flags.weekly,flags.night,policyMutation,load]);
  const evaluations=useMemo(()=>{
    if(!ready||loadedPeriod!==period)return {weeks:[],issues:[]};const months=[monthBefore(period),period,monthAfter(period)],available=[],cells={};
    let availableMonths=0;for(const month of months){const view=queue.view('draft:'+month);if(view.baseline.checksum!==null){availableMonths++;available.push(...guidance.periodDates(month));}Object.assign(cells,view.cells);}
    const weeks=[],issues=[];for(const person of people.filter(item=>item.DirectoryType==='MO')){
      const byDate={};for(const [cell,value]of Object.entries(cells))if(cell.startsWith(person.PersonId+'/'))byDate[cell.split('/')[1]]=value;
      if(flags.weekly)for(const weekStart of guidance.weeksForPeriod(period)){try{const result=guidance.evaluateWeek({weekStart,personId:person.PersonId,plannedByDate:byDate,currentByDate:byDate,availablePlannedDates:available,policies,acknowledgements});weeks.push(result);issues.push(...result.issues);}catch(e){issues.push({id:'policy:'+person.PersonId+':'+weekStart,code:e.message,personId:person.PersonId,weekStart,severity:'ADVISORY'});}}
      const ordered=available.sort().map(date=>({date,assignments:byDate[date]||[]}));if(flags.night){const sequence=guidance.evaluateSequences({personId:person.PersonId,days:ordered,completeContext:availableMonths===3,contextKey:period,acknowledgements});issues.push(...sequence.issues);}
    }return {weeks,issues:[...new Map(issues.map(item=>[item.id,item])).values()]};
  },[ready,loadedPeriod,policies,period,people,queue,acknowledgements,flags.weekly,flags.night]);
  const acknowledge=item=>{const next=[...acknowledgements.filter(record=>record.issueId!==item.id),guidance.acknowledgeIssue(item)];setAcknowledgements(next);try{localStorage.setItem('roster_phase3_acknowledgements_v1',JSON.stringify(next));}catch{/* acknowledgement remains effective for this session */}};
  const savePolicy=async()=>{setError('');try{const result=await policyMutation.save({policyId:crypto.randomUUID(),policyCode,effectiveMonday,reason},revision);if(!result?.ok||result.status!=='CONFIRMED')throw new Error(result?.error?.code||result?.status||'RECOVERY_REQUIRED');const refreshed=await load();setPolicies(refreshed.policies);setRevision(refreshed.revision);setReason('');}catch(e){setError(e.message);}};
  if(!flags.weekly&&!flags.night)return null;
  if(ready&&queue.view('draft:'+period).baseline.checksum===null)return null;
  return <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Roster guidance">
    <h2 className="text-lg font-semibold">Advisory roster guidance — {period}</h2><p className="text-sm">Warnings never change assignments. Draft values act as planning inputs until Phase 4 provides published snapshots.</p>
    {error&&<p role="alert">{error}</p>}
    {flags.weekly&&<><h3 className="mt-3 font-semibold">Weekly OFF</h3><table className="w-full text-sm"><thead><tr><th>Week</th><th>Policy</th><th>State</th><th>Planned OFF</th><th>Operational OFF</th><th>Shortfall</th></tr></thead><tbody>
      {evaluations.weeks.map(row=><tr key={row.personId+row.weekStart}><td>{row.weekStart}</td><td>{row.policy.policyCode}</td><td>{row.status}</td><td>{row.plannedAssignedOff??'—'}</td><td>{row.currentOperationalOff??'—'}</td><td>{row.shortfall??'—'}</td></tr>)}</tbody></table></>}
    <h3 className="mt-3 font-semibold">Issues</h3><ul>{evaluations.issues.map(item=><li key={item.id} className="my-2"><span>{item.date||item.weekStart||item.contextKey}: {messages[item.code]||item.code} {item.acknowledged?'— Reviewed':''}</span>{!item.acknowledged&&<button className="ml-2 min-h-11 border rounded px-3" onClick={()=>acknowledge(item)}>Mark reviewed</button>}</li>)}</ul>
    {flags.weekly&&guidance.policyWritesEnabled(settings)&&<fieldset className="mt-3 border-t pt-3"><legend className="font-semibold">Add effective OFF policy</legend>
      <label>Policy<select value={policyCode} onChange={event=>setPolicyCode(event.target.value)}><option>A</option><option>B</option></select></label>
      <label className="ml-2">Effective Monday<input type="date" value={effectiveMonday} onChange={event=>setEffectiveMonday(event.target.value)}/></label>
      <label className="ml-2">Reason<input value={reason} maxLength={500} onChange={event=>setReason(event.target.value)}/></label>
      <button className="ml-2 min-h-11 border rounded px-3" onClick={savePolicy}>Add policy</button></fieldset>}
  </section>;
}
