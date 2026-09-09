import {IndexedOutbox} from './indexedOutbox.js';
import {DraftQueue,sha256} from './draftQueue.js';
import {createDraftRepository} from '../data/draftRepository.js';
let runtime;
// Keep non-durable intent in memory across in-app navigation. stop() pauses sending,
// but retains an unload warning until the user persists or explicitly discards it.
export async function draftRuntime(settings) {
  if(!runtime) runtime=(async()=>{const endpoint=import.meta.env?.VITE_APPS_SCRIPT_URL?.trim();if(!endpoint)throw new Error('DRAFT_ENDPOINT_UNCONFIGURED');const scope=await sha256(new URL(endpoint).toString());return IndexedOutbox.open({name:'request-app-roster-outbox-v1-'+scope});})().then(store=>new DraftQueue({store,repository:createDraftRepository(),settings})).catch(error=>{runtime=null;throw error;});
  const queue=await runtime;queue.settings=settings;return queue;
}
