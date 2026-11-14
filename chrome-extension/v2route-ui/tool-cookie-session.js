/* Preserve only provider-created session values inside the embedded partition.
 * No token is solved, logged, persisted by the extension or sent to its parent. */
(function(){
  'use strict';
  const host=location.hostname;
  if(top===self||host!=='ping0.cc'||name!=='v2route-tool-'+host)return;
  const descriptor=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');if(!descriptor?.get||!descriptor?.set)return;
  const expected=new Set(['token','tokentype']);const written=new Set();
  Object.defineProperty(document,'cookie',{configurable:true,get(){return descriptor.get.call(this);},set(value){
    let cookie=String(value);const at=cookie.indexOf('='),key=cookie.slice(0,at).trim();
    if(expected.has(key)){
      cookie=cookie.replace(/;\s*samesite\s*=\s*[^;]*/ig,'').replace(/;\s*secure(?=;|$)/ig,'').replace(/;\s*partitioned(?=;|$)/ig,'');
      cookie+='; SameSite=None; Secure; Partitioned';
    }
    descriptor.set.call(this,cookie);
    if(expected.has(key)){written.add(key);if(written.size===2)parent.postMessage({type:'v2route-tool-session-written'},'*');}
  }});
})();
