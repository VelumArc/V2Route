/* Tool cache cleanup is restricted to known HTTPS provider origins.
 * SPDX-License-Identifier: GPL-3.0-or-later */
(function(root){
  'use strict';
  const ORIGINS=Object.freeze(['https://ping0.cc','https://en.greatfire.org','https://fast.com','https://speed.cloudflare.com','https://api.globalping.io']);
  const PRESERVED=Object.freeze(['cookies','localStorage','indexedDB','passwords','serviceWorkers']);
  function originFor(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'url')||typeof value.url!=='string'||value.url.length>4096)throw new Error('Invalid tool cache request / 工具缓存请求无效');
    let url;try{url=new URL(value.url);}catch{throw new Error('Invalid tool cache URL / 工具缓存地址无效');}
    if(url.protocol!=='https:'||url.username||url.password||!ORIGINS.includes(url.origin))throw new Error('Tool cache origin is not allowed / 不允许清理此工具来源的缓存');
    return url.origin;
  }
  function create(api,firefox=false){
    const pending=new Map(),latest=new Map();
    const result=(origin,status,code)=>({origin,status,cleared:status==='cleared'?['httpCache','cacheStorage']:[],unsupported:status==='unsupported'?['httpCache','cacheStorage']:[],preserved:[...PRESERVED],...(code?{code}:{})});
    function remove(origin){
      // Firefox cannot guarantee site-scoped cache removal; never fall back to
      // removeCache/hostnames or clear unrelated data to imitate this feature.
      if(firefox)return Promise.resolve(result(origin,'unsupported','SCOPED_CACHE_UNSUPPORTED'));
      if(typeof api.browsingData?.remove!=='function')return Promise.resolve(result(origin,'failed','CACHE_API_UNAVAILABLE'));
      return new Promise(resolve=>{
        let settled=false;
        const finish=failed=>{if(settled)return;settled=true;resolve(result(origin,failed?'failed':'cleared',failed?'CACHE_CLEAR_FAILED':undefined));};
        try{
          const work=api.browsingData.remove({origins:[origin]},{cache:true,cacheStorage:true},()=>finish(!!api.runtime?.lastError));
          if(work&&typeof work.then==='function')work.then(()=>finish(false),()=>finish(true));
        }catch{finish(true);}
      });
    }
    function clear(value){
      const origin=originFor(value),before=pending.get(origin)||Promise.resolve();
      const work=before.then(()=>remove(origin)).then(outcome=>{latest.set(origin,outcome);return outcome;});
      pending.set(origin,work);work.finally(()=>{if(pending.get(origin)===work)pending.delete(origin);});return work;
    }
    async function wait(value){const origin=originFor(value);let work;do{work=pending.get(origin);if(work)await work;}while(work&&pending.get(origin)&&pending.get(origin)!==work);return latest.get(origin)||result(origin,'idle');}
    return Object.freeze({clear,wait});
  }
  const exported=Object.freeze({create,originFor,ORIGINS});
  if(typeof module==='object'&&module.exports)module.exports=exported;else root.V2RouteToolCache=exported;
})(globalThis);
