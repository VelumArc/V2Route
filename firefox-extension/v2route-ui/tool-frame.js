/* Adapt only an iframe that receives approval from this extension's current dialog. */
(function(){
  'use strict';
  if(top===self)return;
  const api=globalThis.browser||chrome,origin=api.runtime.getURL('').replace(/\/$/,'');
  let enabled=false;
  addEventListener('message',event=>{
    if(enabled||event.source!==parent||event.origin!==origin||event.data?.type!=='v2route-tool-adapt')return;
    enabled=true;
    const host=location.hostname,style=document.createElement('style');
    if(host==='ping0.cc')style.textContent='body:has(.line.loc) header,body:has(.line.loc) nav,body:has(.line.loc) footer,body:has(.line.loc) .gg_link,body:has(.line.loc) .adsbygoogle{display:none!important}';
    if(style.textContent)document.documentElement.append(style);
    if(host==='ping0.cc'){
      let observer;
      const ready=()=>{if(!document.querySelector('.line.loc'))return;parent.postMessage({type:'v2route-tool-report-ready'},origin);observer?.disconnect();};
      observer=new MutationObserver(ready);observer.observe(document.documentElement,{childList:true,subtree:true});ready();
      addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    }

  });
  parent.postMessage({type:'v2route-tool-ready'},origin);
  addEventListener('DOMContentLoaded',()=>parent.postMessage({type:'v2route-tool-ready'},origin),{once:true});
})();
