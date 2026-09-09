// IndexedDB transactions contain synchronous mutations only: no fetch/hash await inside them.
export class IndexedOutbox {
  constructor(db) { this.db=db; this.name=db.name; }
  static open({name='request-app-roster-outbox-v1', indexedDB=globalThis.indexedDB}={}) {
    return new Promise((resolve,reject)=>{
      if(!indexedDB) return reject(new Error('INDEXEDDB_UNAVAILABLE'));
      const req=indexedDB.open(name,1);let rejected=false;
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('entities')) db.createObjectStore('entities',{keyPath:'entityKey'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onerror=()=>{rejected=true;reject(req.error);};
      req.onblocked=()=>{rejected=true;reject(new Error('INDEXEDDB_UPGRADE_BLOCKED'));};
      req.onsuccess=()=>{if(rejected){req.result.close();return;}req.result.onversionchange=()=>req.result.close();resolve(new IndexedOutbox(req.result));};
    });
  }
  transaction(store,key,mutate) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(store,mutate?'readwrite':'readonly',mutate?{durability:'strict'}:undefined);
      let result, failure;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(failure||tx.error||new Error('PERSISTENCE_FAILED'));
      tx.onerror=()=>{};
      const object=tx.objectStore(store),req=key===undefined?object.getAll():object.get(key);
      req.onsuccess=()=>{
        try {
          result=req.result;
          if(mutate){ result=mutate(result);if(result?.then)throw new Error('ASYNC_IDB_MUTATION');
            if(store==='meta')object.put(result,key);else object.put(result); }
        }catch(error){failure=error;tx.abort();}
      };
    });
  }
  read(key){return this.transaction('entities',key);}
  all(){return this.transaction('entities');}
  update(key,fn){return this.transaction('entities',key,fn);}
  clientId(){return this.transaction('meta','clientId',id=>id||crypto.randomUUID());}
  close(){this.db.close();}
}
