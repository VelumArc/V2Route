/* Popup-scoped checks. No polling, persistent observations or proxy mutations. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V2RHealth=api;
})(globalThis,function(){
  'use strict';
  function create({inspect,probe,onChange,clock=()=>Date.now(),timer=setTimeout,clear=clearTimeout}){
    let generation=0,controller=null,closed=false,pending=false;
    let value={status:'unknown',code:'UNVERIFIED',checkedAt:null};
    const emit=next=>{value=next;if(!closed)onChange({...value});};
    function invalidate(code='UNVERIFIED',status='unknown'){
      generation++;controller?.abort();controller=null;pending=false;
      if(!closed)emit({status,code,checkedAt:null});
    }
    async function boundedInspect(signal){
      let id,abort;
      try{return await Promise.race([inspect(),new Promise((_,reject)=>{
        abort=()=>reject(Object.assign(new Error('Cancelled'),{code:'CANCELLED'}));
        if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});
        id=timer(()=>reject(Object.assign(new Error('Background unavailable'),{code:'BACKGROUND'})),5000);
      })]);}finally{clear(id);if(abort)signal.removeEventListener('abort',abort);}
    }
    async function check({force=false}={}){
      if(closed||pending)return;
      if(!force&&value.checkedAt&&clock()-value.checkedAt<15000)return;
      invalidate();pending=true;const own=++generation,abort=new AbortController();controller=abort;
      emit({status:'checking',code:'CHECKING',checkedAt:null});
      const live=()=>!closed&&own===generation&&!abort.signal.aborted;
      try{
        const before=await boundedInspect(abort.signal);if(!live())return;
        if(before.status!=='ready'){emit({...before,checkedAt:clock()});return;}
        await probe(abort.signal);if(!live())return;
        const after=await boundedInspect(abort.signal);if(!live())return;
        if(after.status!=='ready'){emit({...after,checkedAt:clock()});return;}
        if(before.token!==after.token||before.profile!==after.profile){emit({status:'unknown',code:'CHANGED',checkedAt:null});return;}
        emit({status:'ok',code:'OK',checkedAt:clock(),limited:after.limited,profile:after.profile});
        // Keep the last verified observation for this popup session. Route and
        // network events invalidate it; reopening starts a fresh finite check.
      }catch(e){if(live()&&e?.code!=='CANCELLED')emit({status:'error',code:e?.code==='BACKGROUND'?'BACKGROUND':e?.code==='TIMEOUT'?'TIMEOUT':'NETWORK',checkedAt:clock()});}
      finally{if(own===generation){pending=false;controller=null;}}
    }
    function stop(){closed=true;generation++;controller?.abort();controller=null;pending=false;}
    return {check,invalidate,stop,get value(){return {...value};}};
  }
  return {create};
});
