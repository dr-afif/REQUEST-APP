import React from 'react';
import {createRoot} from 'react-dom/client';
import Panel from '../../src/features/roster/components/RosterGuidancePanel.jsx';

const person={PersonId:'11111111-1111-4111-8111-111111111111',CurrentDisplayName:'Synthetic Person',DirectoryType:'MO'};
const policy={PolicyId:'33333333-3333-4333-8333-333333333333',PolicyCode:'A',EffectiveMonday:'2030-01-07',RuleVersion:1,RuleJson:'{\"policyCode\":\"A\",\"ruleVersion\":1,\"normalOffBaseCode\":\"OFF\",\"nightQualification\":\"PUBLISHED_PLANNED_SHIFT_SEMANTICS\"}',Active:true,Revision:1};
window.mountGuidanceTest=({enabled=true,complete=true,writes=false,enrolled=true,race=false,night=false}={})=>{
  const views=new Map(),saved=[];let stored=null,refreshes=0,policyCalls=0,releaseFirst;const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
  for(const month of ['2030-06','2030-07','2030-08','2030-09'])views.set('draft:'+month,{baseline:{checksum:enrolled&&(complete||month==='2030-07')?'confirmed':null},cells:{}});
  views.get('draft:2030-07').cells[person.PersonId+'/2030-07-01']=[{assignmentId:crypto.randomUUID(),rawShift:'AM'}];
  const queue={clientId:'44444444-4444-4444-8444-444444444444',tabId:'55555555-5555-4555-8555-555555555555',views,
    view:key=>views.get(key)||{baseline:{checksum:null},cells:{}},refresh:async()=>{refreshes++;},store:{transaction:async(_name,_key,update)=>{if(update)stored=await update(stored);return stored;}}};
  let policies=writes?[]:[policy],revision=writes?0:1;
  const repository={policies:async()=>{const call=++policyCalls;if(race&&call===1)await firstGate;return {ok:true,policies:race&&call>1?[{...policy,PolicyCode:'B',RuleJson:'{\"policyCode\":\"B\",\"ruleVersion\":1,\"normalOffBaseCode\":\"OFF\",\"nightQualification\":\"PUBLISHED_PLANNED_SHIFT_SEMANTICS\"}'}]:policies,revision};},status:async()=>({ok:true,status:'NOT_FOUND'}),recover:async()=>{throw Error('unexpected recovery')},
    save:async operation=>{saved.push(operation);policies=[{...policy,PolicyId:operation.payload.policyId,PolicyCode:operation.payload.policyCode,EffectiveMonday:operation.payload.effectiveMonday}];revision=1;
      return {ok:true,status:'CONFIRMED',operationId:operation.operationId,payloadHash:operation.payloadHash,result:{revision:1}};}};
  const settings=enabled?{weekly_off_guidance_enabled:true,night_safety_guidance_enabled:night,...(writes?{roster_v2_write_enabled:true,write_queue_v2_enabled:true}:{})}:{};
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container),render=period=>root.render(<Panel period={period} settings={settings} queue={queue} people={[person]} repository={repository}/>);
  render('2030-07');
  window.guidanceTest={queue,saved,render,releaseFirst,get refreshes(){return refreshes;},get policyCalls(){return policyCalls;},close:()=>{if(container.isConnected){root.unmount();container.remove();localStorage.clear();}window.guidanceTest=null;}};
};
