import React from 'react';import {createRoot} from 'react-dom/client';
import Panel from '../../src/features/roster/components/DraftQueuePanel.jsx';
import {setup} from './browser-cases.js';
window.mountDraftTest=async({holdSchema=false}={})=>{
 const context=await setup({options:{debounceMs:5000}});
 let releaseSchema;const schemaGate=holdSchema?new Promise(resolve=>{releaseSchema=resolve;}):Promise.resolve();context.releaseSchema=()=>releaseSchema?.();
 context.repo.schema=async()=>{await schemaGate;return {ok:true,draftWritesEnabled:true,people:[{PersonId:'11111111-1111-4111-8111-111111111111',CurrentDisplayName:'Example Person',DirectoryType:'MO'}]};};
 const read=context.repo.read;context.readCount=0;context.repo.read=async key=>{context.readCount++;return read(key);};
 window.draftTest=context;
 const container=document.createElement('div');document.body.append(container);
 const root=createRoot(container);root.render(<Panel period="2030-07" settings={{roster_v2_write_enabled:true,write_queue_v2_enabled:true}} runtimeFactory={async()=>context.q}/>);
 window.unmountDraftTest=(close=true)=>{root.unmount();if(close)context.close();};
};
