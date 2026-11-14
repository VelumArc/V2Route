/* SPDX-License-Identifier: GPL-3.0-or-later
 * User-enabled subscription scheduling and private native operations. */
(function(root){
'use strict';
const ALARM='v2route-subscriptions', SCHEDULE_KEY='v2routeSubscriptionSchedule';
const COMMANDS=['subscriptionState','libraryGroups','libraryImport','subscriptionSave','subscriptionRemove','subscriptionContext','subscriptionRefresh'];
const METHODS={v2routeLibraryState:'subscriptionState',v2routeLibraryGroups:'libraryGroups',v2routeLibraryImport:'libraryImport',v2routeSubscriptionSave:'subscriptionSave',v2routeSubscriptionRemove:'subscriptionRemove'};
const unavailable=reason=>({kind:'unavailable',reason});
function wildcard(pattern,value){
 const escaped=String(pattern).replace(/[|\\{}()[\]^$+?.]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\?/g,'.');
 return new RegExp('^'+escaped+'$').test(value);
}
function matches(pattern,urlMode,url){
 if(pattern==='<local>')return !url.hostname.includes('.');
 if(!urlMode&&pattern.startsWith('.'))return url.hostname===pattern.slice(1)||url.hostname.endsWith(pattern);
 return wildcard(pattern,urlMode?url.href:url.hostname);
}
async function transportFor(model,target,readSystem){
 let url;try{url=new URL(target);}catch(_){return unavailable('invalid_subscription_url');}
 if(!['http:','https:'].includes(url.protocol))return unavailable('invalid_subscription_url');
 const seen=new Set();
 async function pick(name){
  if(seen.has(name)||seen.size>64)return unavailable('profile_cycle');
  seen.add(name);
  if(name==='direct')return unavailable('current_route_direct');
  if(name==='system'){
   const value=await readSystem();
   if(value.mode==='direct')return unavailable('current_route_direct');
   for(const rule of value.bypass||[]){
    if(rule.scheme&&rule.scheme!==url.protocol.slice(0,-1)||rule.port&&rule.port!==(Number(url.port)||(url.protocol==='https:'?443:80)))continue;
    if(rule.kind==='local'&&!url.hostname.includes('.')||rule.kind==='host'&&wildcard(rule.host,url.hostname)||rule.kind==='ip'&&rule.host===url.hostname)return unavailable('current_route_direct');
   }
   return endpoint(value.proxies?.[url.protocol.slice(0,-1)]||value.proxies?.fallback);
  }
  const p=Object.hasOwn(model.profiles,name)?model.profiles[name]:null;
  if(!p)return unavailable('profile_missing');
  if(p.profileType==='FixedProfile'){
   if((p.bypassList||[]).some(x=>matches(typeof x==='string'?x:x.pattern,false,url)))return unavailable('current_route_direct');
   return endpoint(p.fallbackProxy);
  }
  if(p.profileType==='SwitchProfile'){
   const rule=(p.rules||[]).find(r=>matches(r.condition?.pattern||'',r.condition?.conditionType==='UrlWildcardCondition',url));
   return pick(rule?rule.profileName:p.defaultProfileName);
  }
  return unavailable('inline_pac_unresolved');
 }
 function endpoint(p){
  if(!p||!['http','https','socks5'].includes(p.scheme)||typeof p.host!=='string'||!p.host||!Number.isInteger(p.port)||p.port<1||p.port>65535)return unavailable('proxy_unavailable');
  return {kind:p.scheme,host:p.host,port:p.port};
 }
 return pick(model.currentProfileName);
}
function create({api,nativeRequest,resolveTransport}){
 let running=false,attached=false,scheduleRevision=-1,scheduleTail=Promise.resolve();
 const call=(object,method,...args)=>new Promise((resolve,reject)=>{try{object[method](...args,value=>api.runtime.lastError?reject(new Error('Browser scheduling unavailable / 浏览器调度不可用')):resolve(value));}catch(e){reject(e);}});
 function schedule(operation){
  const result=scheduleTail.then(operation);
  scheduleTail=result.catch(()=>{});
  return result;
 }
 function saveSchedule(state){return schedule(async()=>{
  if(!Array.isArray(state?.subscriptions))return;
  if(Number.isInteger(state.revision)){
   if(state.revision<scheduleRevision)return;
   scheduleRevision=state.revision;
  }
  const rows=Array.isArray(state?.subscriptions)?state.subscriptions:[],enabled=rows.filter(s=>s.enabled===true);
  await call(api.storage.local,'set',{[SCHEDULE_KEY]:{enabled:enabled.length>0}});
  if(!api.alarms)return;
  if(!enabled.length){await call(api.alarms,'clear',ALARM);return;}
  const due=enabled.map(s=>Number(s.next_due)).filter(n=>Number.isFinite(n)&&n>0);
  const when=Math.max(Date.now()+60000,due.length?Math.min(...due):Date.now()+300000);
  // Chrome 120 and Firefox accept when. Avoid newer persistence-only fields.
  await api.alarms.create(ALARM,{when});
 });}
 async function state(){const value=await nativeRequest('subscriptionState',{});await saveSchedule(value);return value;}
 async function refresh(id,trigger='manual'){
  if(typeof id!=='string'||!id||id.length>128)throw new Error('Invalid subscription / 订阅无效');
  const context=await nativeRequest('subscriptionContext',{id});
  let transport={kind:'direct'};
  if(context.policy!=='direct-only'){
   try{transport=await resolveTransport(context.url);}catch(_){transport=unavailable('proxy_unavailable');}
  }
  const value=await nativeRequest('subscriptionRefresh',{id,transport,trigger,expected_generation:context.generation});
  await saveSchedule(value);
  return value;
 }
 async function run(method,value={}){
  if(method==='v2routeSubscriptionRefresh'){
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='id'))throw new Error('Invalid subscription request / 订阅请求无效');
   return refresh(value.id);
  }
  const command=METHODS[method];
  if(!command)throw new Error('Unsupported library request / 不支持的节点库请求');
  if(method==='v2routeLibraryState')return state();
  const result=await nativeRequest(command,value);
  if(Array.isArray(result?.subscriptions)){await saveSchedule(result);return result;}
  return {...await state(),...result};
 }
 function scheduleFailure(){return schedule(async()=>{
  try{
   const cached=await call(api.storage.local,'get',SCHEDULE_KEY);
   if(cached[SCHEDULE_KEY]?.enabled&&api.alarms)await api.alarms.create(ALARM,{when:Date.now()+300000});
  }catch(_){}
 });}
 async function tick(){
  if(running)return;
  running=true;
  try{
   const before=await nativeRequest('subscriptionState',{}),now=Date.now();
   // Bounded batches; remaining overdue sources get the next shared alarm.
   for(const source of (before.subscriptions||[]).filter(s=>s.enabled===true&&Number(s.next_due)<=now).slice(0,10)){
    try{await refresh(source.id,'automatic');}catch(_){}
   }
   await state();
  }catch(_){await scheduleFailure();}
  finally{running=false;}
 }
 async function bootstrap(){
  try{
   const cache=await call(api.storage.local,'get',SCHEDULE_KEY);
   if(cache[SCHEDULE_KEY]?.enabled)await tick();
  }catch(_){await scheduleFailure();}
 }
 function attach(){
  if(attached)return;attached=true;
  api.alarms?.onAlarm?.addListener(a=>{if(a.name===ALARM)void tick();});
  api.runtime.onStartup?.addListener(()=>{void bootstrap();});
  void bootstrap();
 }
 return {run,attach,refresh,tick,saveSchedule,methods:new Set([...Object.keys(METHODS),'v2routeSubscriptionRefresh'])};
}
const exported={create,transportFor,wildcard,ALARM,SCHEDULE_KEY,COMMANDS};
root.V2RouteLibrary=exported;
if(typeof module==='object'&&module.exports)module.exports=exported;
})(typeof globalThis==='object'?globalThis:this);

