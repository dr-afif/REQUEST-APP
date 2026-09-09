import {useEffect,useState} from 'react';
import {draftRuntime} from '../queue/runtime.js';
import {createSignals,terminal} from '../queue/state.js';
import protocol from '../queue/protocol.js';
import RosterGuidancePanel from './RosterGuidancePanel.jsx';

const labels={QUEUED:'Queued',SENDING:'Saving',AWAITING_STATUS:'Retry scheduled — checking confirmation',RETRY_SCHEDULED:'Retry scheduled',
  FAILED:'Failed',CONFLICT:'Conflict — review required',RECOVERY_REQUIRED:'Recovery required',CONFIRMED:'Saved',REVERTED:'Reverted',NOT_DURABLE:'Not saved on this device'};
const errorMessages={AUTHORIZATION_REQUIRED:'Administrator identity could not be verified',FEATURE_DISABLED:'Draft saving is disabled',ENTITY_NOT_FOUND:'The period or person has not been set up for draft editing',REVISION_CONFLICT:'Newer changes need review. Refresh the confirmed draft before replacing your proposal',IDEMPOTENCY_MISMATCH:'This save ID has conflicting content and needs review',RECOVERY_REQUIRED:'The save outcome needs reconciliation before another change can be sent',PERMANENT_FAILURE:'This operation cannot be retried unchanged',PERSISTENCE_FAILED:'Changes could not be saved on this device',LOCK_BUSY:'The server is busy; a safe retry will be scheduled'};
// Opt-in draft editor and persistent save state only. Legacy grid and upload are independent.
export default function DraftQueuePanel({period,settings,runtimeFactory=draftRuntime}) {
  const showDraft=protocol.enabled(settings);
  const [queue,setQueue]=useState(null),[,update]=useState(0),[error,setError]=useState(''),[people,setPeople]=useState([]);
  const [personId,setPersonId]=useState(''),[date,setDate]=useState(period+'-01'),[text,setText]=useState(''),[offline,setOffline]=useState(!navigator.onLine);
  const key='draft:'+period;
  useEffect(()=>{let live=true,q,unsubscribe,refresh;
    (async()=>{
      q=await runtimeFactory(settings);const repository=q.repository;
      if(!live)return;
      unsubscribe=q.subscribe(()=>{if(live)update(n=>n+1);});
      q.bus=createSignals(()=>q.reload().catch(()=>{if(live)setError('Local draft storage unavailable.');}));
      await q.start();if(!live)return;setQueue(q);
      const schema=await repository.schema();if(!live)return;if(!schema.ok)throw new Error(schema.error.code);
      if(showDraft&&!schema.draftWritesEnabled)throw new Error('FEATURE_DISABLED');
      setPeople(schema.people);setPersonId(schema.people[0]?.PersonId||'');
      await q.refresh(key);if(!live)return;refresh=setInterval(()=>q.refresh(key).catch(e=>{if(live)setError(e.message);}),60000);
    })().catch(e=>{if(live)setError(e.message);});
    const connection=()=>setOffline(!navigator.onLine);window.addEventListener('online',connection);window.addEventListener('offline',connection);
    return()=>{live=false;unsubscribe?.();q?.stop();clearInterval(refresh);window.removeEventListener('online',connection);window.removeEventListener('offline',connection);};
  },[key,settings,runtimeFactory]); // Reopen the durable queue for the selected period; no legacy refresh mutation.
  const view=queue?.view(key),pending=[...(queue?.entities.values()||[])].flatMap(e=>e.operations.filter(o=>!terminal(o)));
  const act=fn=>Promise.resolve().then(fn).catch(e=>setError(e.code||e.message));
  const cellKey=personId+'/'+date;
  const cellText=(view?.cells[cellKey]||[]).map(a=>a.rawShift).join('\n');
  useEffect(()=>{setText(cellText);},[personId,date,queue,cellText]);
  const save=(value=text)=>act(async()=>{
    setError('');const old=queue.view(key).cells[cellKey]||[];
    const assignments=value===''?[]:value.split('\n').map((rawShift,i)=>({assignmentId:old[i]?.assignmentId||crypto.randomUUID(),rawShift}));
    await queue.enqueue(key,[{personId,date,assignments}]);
  });
  return <>{showDraft&&<section className="mb-6 rounded-xl border border-slate-300 bg-white p-4" aria-label="V2 draft editor">
    <h2 className="text-lg font-semibold">Private draft — {period}</h2>
    <p className="text-sm">Draft changes are separate from the official roster. This period must already be enrolled.</p>
    <p role="status" aria-live="polite">{offline?'Offline — changes retained locally. ':''}{!queue||view?.baseline.checksum===null?'Loading confirmed draft…':view?.unsafe||view?.error?'Local changes need storage recovery':pending.length?`${pending.length} changes need confirmation`:'All changes saved'}</p>
    {(error||view?.error)&&<p role="alert">{errorMessages[error||view.error]||error||view.error}. Local proposals remain available for review.</p>}
    <div className="flex flex-wrap gap-3 my-3">
      <label>Person<select className="block min-h-11 border p-2" value={personId} onChange={e=>setPersonId(e.target.value)}>{people.map(p=><option key={p.PersonId} value={p.PersonId}>{p.CurrentDisplayName} ({p.DirectoryType})</option>)}</select></label>
      <label>Date<input className="block min-h-11 border p-2" type="date" value={date} min={period+'-01'} max={period+'-31'} onChange={e=>setDate(e.target.value)}/></label>
      <label>Assignments, one per line<textarea className="block border p-2" value={text} disabled={!queue||!personId||view?.baseline.checksum===null} onChange={e=>{setText(e.target.value);save(e.target.value);}} placeholder="AM&#10;PM"/></label>
      <button className="min-h-11 border rounded px-3" disabled={!queue||!personId||view?.baseline.checksum===null} onClick={()=>save()}>Save draft cell</button>
      <button className="min-h-11 border rounded px-3" disabled={!queue} onClick={()=>act(()=>queue.refresh(key))}>Refresh confirmed draft</button>
      {(view?.unsafe||view?.error)&&<button className="min-h-11 border rounded px-3" onClick={()=>act(()=>queue.retryPersistence())}>Retry local storage</button>}
    </div>
    <table className="w-full text-sm"><caption className="text-left">Draft cells and save state</caption><thead><tr><th>Person/date</th><th>Assignments</th><th>State</th></tr></thead>
      <tbody>{Object.entries(view?.cells||{}).map(([cell,assignments])=><tr key={cell}><td>{people.find(p=>p.PersonId===cell.split('/')[0])?.CurrentDisplayName||'Registered person'} / {cell.split('/')[1]}</td><td>{assignments.map(a=>a.rawShift).join(' + ')||'Empty'}</td><td>{labels[view.statuses[cell]?.status]||'Saved'}</td></tr>)}</tbody></table>
    {[...(queue?.unsafe.values()||[])].filter(intent=>intent.persistenceFailed&&!intent.persisting).map(intent=><button key={intent.id} className="min-h-11 border rounded px-3" onClick={()=>queue.discardUnsafe(intent.id)}>Discard unstored edit for {intent.entityKey.slice(6)}</button>)}
    <ul>{pending.map(op=><li key={op.operationId} className="my-2 flex flex-wrap gap-2 items-center"><span>{op.entityKey.slice(6)}: {labels[op.status]} {op.lastError?`(${op.lastError})`:''}</span>
      <button className="min-h-11 border rounded px-3" onClick={()=>act(()=>queue.retry(op.entityKey,op.operationId))}>Retry / recover</button>
      <button className="min-h-11 border rounded px-3" onClick={()=>act(()=>queue.revert(op.entityKey,op.operationId))}>Revert local proposal</button></li>)}</ul>
  </section>}{queue&&<RosterGuidancePanel period={period} settings={settings} queue={queue} people={people}/>}</>;
}
export const draftPanelEnabled=settings=>protocol.enabled(settings);
export const rosterPanelEnabled=settings=>draftPanelEnabled(settings)||['weekly_off_guidance_enabled','night_safety_guidance_enabled'].some(key=>settings?.[key]===true||settings?.[key]==='true');
