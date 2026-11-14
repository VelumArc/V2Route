/* V2Route browser controller. Copyright 2026 V2Route contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Readable source; no remote code, telemetry, cloud sync or web page access. */
(function (root) {
'use strict';
if(!root.V2RouteToolCache&&typeof importScripts==='function')importScripts('v2route-tool-cache.js');
if(typeof importScripts==='function'){
 if(!root.V2RNativeClient)importScripts('v2route-ui/node-measure-client.js');
 if(!root.V2RouteLibrary)importScripts('v2route-library.js');
}
const ToolCache=typeof module==='object'&&module.exports?require('./v2route-tool-cache.js'):root.V2RouteToolCache;
const Library=typeof module==='object'&&module.exports?require('./v2route-library.js'):root.V2RouteLibrary;
const NativeClient=typeof module==='object'&&module.exports?require('./v2route-ui/node-measure-client.js'):root.V2RNativeClient;
const HOST='local.v2route', KEY='v2routeModel';
const clone=v=>JSON.parse(JSON.stringify(v));
const own=(object,key)=>Object.hasOwn(object,key)?object[key]:undefined;
const builtins={direct:{name:'direct',profileType:'DirectProfile',color:'#42ad8c',builtin:true},system:{name:'system',profileType:'SystemProfile',color:'#7792ad',builtin:true}};
function error(en,zh){return new Error(en+' / '+zh);}
function nameValid(name){return typeof name==='string'&&name.trim()===name&&name.length>0&&name.length<=128&&!/[\x00-\x1f\x7f]/.test(name)&&!['direct','system','__proto__','constructor','prototype'].includes(name)&&!Object.hasOwn(Object.prototype,name)&&!name.startsWith('_');}
function validPort(port){return Number.isInteger(port)&&port>0&&port<65536;}
function revision(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function references(p){return p.profileType==='SwitchProfile'?[p.defaultProfileName,...p.rules.map(r=>r.profileName)]:[];}
function sanitize(input,existing){
 if(!input||!nameValid(input.name))throw error('Invalid profile name','情景名称无效');
 if(!['FixedProfile','SwitchProfile','PacProfile'].includes(input.profileType))throw error('Unsupported profile type','不支持的情景类型');
 const p={name:input.name,profileType:input.profileType,color:/^#[0-9a-f]{6}$/i.test(input.color||'')?input.color:'#269eab',revision:revision()};
 if(p.profileType==='FixedProfile'){
  const proxy=input.fallbackProxy;
  if(!proxy||!['http','https','socks4','socks5'].includes(proxy.scheme)||typeof proxy.host!=='string'||!proxy.host.trim()||/[\s;\r\n/@]/.test(proxy.host)||!validPort(proxy.port))throw error('Enter a valid proxy host and port','请输入有效代理地址和端口');
  if(input.proxyDNS===false)throw error('SOCKS5 DNS is resolved through the proxy in V2Route','V2Route 的 SOCKS5 DNS 使用代理端解析');
  p.fallbackProxy={scheme:proxy.scheme,host:proxy.host,port:proxy.port};p.proxyDNS=true;
  if(!Array.isArray(input.bypassList||[])||(input.bypassList||[]).length>500)throw error('Invalid bypass list','绕过列表无效');
  p.bypassList=(input.bypassList||[]).map(c=>{const pattern=typeof c==='string'?c:c?.pattern;if(typeof pattern!=='string'||!pattern||pattern.length>512||/[\x00-\x1f]/.test(pattern))throw error('Invalid bypass entry','绕过条目无效');return {conditionType:'BypassCondition',pattern};});
  if(existing?._zeroRouteSlot){for(const k of ['_zeroRouteSlot','_zeroRouteChoice','_zeroRouteIcon','_zeroRouteCountry','_zeroRoutePredecessor','_zeroRouteChain','_v2routeManual'])if(existing[k]!==undefined)p[k]=clone(existing[k]);p.fallbackProxy=clone(existing.fallbackProxy);}
 }else if(p.profileType==='SwitchProfile'){
  if(!Array.isArray(input.rules)||input.rules.length>1000)throw error('Invalid rules','规则无效');
  p.defaultProfileName=input.defaultProfileName;
  p.rules=input.rules.map(r=>{const c=r?.condition;if(!c||!['HostWildcardCondition','UrlWildcardCondition','BypassCondition'].includes(c.conditionType)||typeof c.pattern!=='string'||!c.pattern||c.pattern.length>2048)throw error('Only host and URL wildcard rules are supported','仅支持主机和网址通配规则');return {condition:{conditionType:c.conditionType,pattern:c.pattern},profileName:r.profileName};});
 }else{
  if(input.pacUrl)throw error('Use inline PAC source; remote PAC is not supported','请粘贴 PAC 源码；不支持远程 PAC 地址');
  if(typeof input.pacScript!=='string'||input.pacScript.length>128*1024||!input.pacScript.includes('FindProxyForURL'))throw error('Enter PAC source with FindProxyForURL','请输入包含 FindProxyForURL 的 PAC 源码');
  p.pacScript=input.pacScript;p.pacUrl='';
 }
 return p;
}
function validateGraph(profiles){
 // Memoize subtree height, not just successful visits: a shared subtree can be
 // reached from a longer path later. The PAC permits depths 0 through 64.
 const heights=new Map(),visiting=new Set();
 const tooDeep=()=>error('Automatic rules exceed the maximum depth of 64','自动规则引用层数不能超过 64 层');
 function visit(name){
  if(typeof name!=='string')throw error('Invalid profile reference','情景引用无效');
  const p=own(builtins,name)||own(profiles,name);
  if(!p)throw error('Referenced profile does not exist: '+name,'引用的情景不存在');
  if(visiting.has(name))throw error('Circular profile references','情景存在循环引用');
  if(heights.has(name))return heights.get(name);
  if(visiting.size>64)throw tooDeep();
  visiting.add(name);
  try{
   let height=0;
   for(const ref of references(p)){
    if(own(profiles,ref)?.profileType==='PacProfile')throw error('Automatic rules cannot target an inline PAC profile','自动规则不能引用内联 PAC 情景');
    height=Math.max(height,1+visit(ref));
    if(height>64)throw tooDeep();
   }
   heights.set(name,height);return height;
  }finally{visiting.delete(name);}
 }
 Object.keys(profiles).forEach(n=>visit(n));
}
function needsSystem(name,profiles,seen=new Set()){
 if(name==='system')return true;if(seen.has(name))return false;seen.add(name);
 const p=own(profiles,name);return !!p&&references(p).some(n=>needsSystem(n,profiles,seen));
}
function systemSnapshot(value){
 const bad=()=>{throw error('Invalid system proxy response; update or repair the companion','系统代理返回无效，请更新或修复本地组件');};
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v),keys=(v,allowed)=>Object.keys(v).every(k=>allowed.includes(k));
 if(!object(value)||!keys(value,['version','mode','proxies','bypass'])||value.version!==1||!['direct','fixed'].includes(value.mode)||!object(value.proxies)||!keys(value.proxies,['http','https','ftp','fallback'])||!Array.isArray(value.bypass)||value.bypass.length>500)bad();
 for(const p of Object.values(value.proxies)){
  if(!object(p)||!keys(p,['scheme','host','port'])||!['http','https','socks4','socks5'].includes(p.scheme)||typeof p.host!=='string'||!p.host||p.host.length>253||!validPort(p.port))bad();
  if(p.host.includes(':')){try{new URL('http://['+p.host+']/');}catch(_){bad();}}
  else if(!/^[a-z0-9_][a-z0-9_.-]*$/i.test(p.host))bad();
 }
 for(const b of value.bypass){
  if(!object(b)||!keys(b,['kind','host','scheme','port'])||!['local','host','ip'].includes(b.kind))bad();
  if(b.kind==='local'){if(Object.keys(b).length!==1)bad();continue;}
  if(typeof b.host!=='string'||!b.host||b.host.length>253)bad();
  if(b.kind==='host'&&!/^[a-z0-9_.*-]+$/i.test(b.host))bad();
  if(b.kind==='ip'&&!(/^[a-f0-9]{32}$/.test(b.host)||/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(b.host)&&b.host.split('.').every(n=>+n<=255)))bad();
  if(b.scheme!==undefined&&!['http','https','ftp','ws','wss'].includes(b.scheme)||b.port!==undefined&&!validPort(b.port))bad();
 }
 if(value.mode==='direct'&&(Object.keys(value.proxies).length||value.bypass.length)||value.mode==='fixed'&&!Object.keys(value.proxies).length)bad();
 return clone(value);
}
// This self-contained function is serialized as PAC source, never evaluated in
// the extension. Its helpers use only the standard PAC JavaScript environment.
function systemProxyForURL(url,host,config){
 function ipKey(h){
  if(h.indexOf(':')<0)return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(h)?h:null;
  var tail=h.match(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);
  if(tail){var bytes=tail[0].split('.');h=h.slice(0,-tail[0].length)+((+bytes[0]<<8)+(+bytes[1])).toString(16)+':'+((+bytes[2]<<8)+(+bytes[3])).toString(16);}
  var halves=h.split('::');if(halves.length>2)return null;
  var a=halves[0]?halves[0].split(':'):[],b=halves.length>1&&halves[1]?halves[1].split(':'):[];
  if(halves.length===1&&a.length!==8||a.length+b.length>8)return null;
  while(a.length+b.length<8)a.push('0');a=a.concat(b);
  var out='';for(var i=0;i<a.length;i++){if(!/^[0-9a-f]{1,4}$/i.test(a[i]))return null;out+=('0000'+a[i]).slice(-4);}return out.toLowerCase();
 }
 if(!config)return 'PROXY 127.0.0.1:0';
 if(config.mode==='direct')return 'DIRECT';
 var h=host.toLowerCase().replace(/^\[|\]$/g,''),ip=ipKey(h);
 var scheme=url.slice(0,url.indexOf(':')).toLowerCase(),authority=url.replace(/^[^:]+:\/\//,'').split('/')[0].split('@').pop(),portMatch=authority.match(/:(\d+)$/);
 var port=portMatch?+portMatch[1]:({http:80,https:443,ftp:21,ws:80,wss:443}[scheme]||0);
 // Match Windows/Chromium implicit local bypass, including IPv6 spellings.
 if(h==='localhost'||/\.localhost\.?$/.test(h)||h==='localhost.'||h==='loopback'||h==='loopback.'||/^127\./.test(h)||/^169\.254\./.test(h)||h==='0.0.0.0'||ip==='00000000000000000000000000000000'||ip==='00000000000000000000000000000001'||ip&&/^fe[89ab]/.test(ip)||ip&&/^00000000000000000000ffff7f/.test(ip)||ip==='00000000000000000000ffff00000000')return 'DIRECT';
 for(var i=0;i<config.bypass.length;i++){
  var r=config.bypass[i];if(r.scheme&&r.scheme!==scheme||r.port&&r.port!==port)continue;
  if(r.kind==='local'&&!ip&&h.indexOf('.')<0||r.kind==='ip'&&ip===r.host||r.kind==='host'&&shExpMatch(h,r.host))return 'DIRECT';
 }
 var p=(scheme==='ws'||scheme==='wss')?(config.proxies.fallback||config.proxies.https||config.proxies.http):(config.proxies[scheme]||config.proxies.fallback);
 if(!p)return 'DIRECT';
 return {http:'PROXY',https:'HTTPS',socks4:'SOCKS',socks5:'SOCKS5'}[p.scheme]+' '+(p.host.indexOf(':')>=0?'['+p.host+']':p.host)+':'+p.port;
}
function pacFor(name,profiles,snapshot){
 // Chrome's inline PAC transport accepts ASCII only. Escape JSON UTF-16 code
 // units rather than changing profile names, references or string semantics.
 const asciiJson=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 function proxy(p){const r=p.fallbackProxy,types={http:'PROXY',https:'HTTPS',socks4:'SOCKS',socks5:'SOCKS5'};return types[r.scheme]+' '+(r.host.includes(':')&&!r.host.startsWith('[')?'['+r.host+']':r.host)+':'+r.port;}
 const table={};for(const [key,p]of Object.entries(profiles)){table[key]=p.profileType==='FixedProfile'?{type:'fixed',proxy:proxy(p),bypass:p.bypassList.map(v=>v.pattern)}:p.profileType==='SwitchProfile'?{type:'rules',rules:p.rules,otherwise:p.defaultProfileName}:{};}
 const system=needsSystem(name,profiles)?systemSnapshot(snapshot):null;
 return 'function FindProxyForURL(url,host){var table='+asciiJson(table)+',target='+asciiJson(name)+',system='+asciiJson(system)+';'+(system?systemProxyForURL.toString():'')+
  'function match(p,urlMode){if(p==="<local>")return host.indexOf(".")<0; if(!urlMode&&p.charAt(0)===".")return host===p.slice(1)||dnsDomainIs(host,p);return shExpMatch(urlMode?url:host,p);}\n'+
  'function pick(n,depth){if(depth>64)return "PROXY 127.0.0.1:0";if(n==="direct")return "DIRECT";if(n==="system")return systemProxyForURL(url,host,system);var p=table[n];if(!p)return "PROXY 127.0.0.1:0";if(p.type==="fixed"){for(var i=0;i<p.bypass.length;i++)if(match(p.bypass[i],false))return "DIRECT";return p.proxy;}if(p.type==="rules"){for(var j=0;j<p.rules.length;j++){var r=p.rules[j];if(match(r.condition.pattern,r.condition.conditionType==="UrlWildcardCondition"))return pick(r.profileName,depth+1);}return pick(p.otherwise,depth+1);}return "PROXY 127.0.0.1:0";}return pick(target,0);}';
}
function createController(api, firefox=false){
 const toolCache=ToolCache.create(api,firefox);
 let model=null,ready=null,queue=Promise.resolve(),latest=null,blobUrl=null,browserTransaction=null,appliedConfig=null;
 const library=Library.create({api,
  nativeRequest:async(command,settings)=>{
   const session=NativeClient.create({api,commands:Library.COMMANDS,timeoutMs:90000});
   try{return await session.request(command,settings);}finally{session.close();}
  },
  resolveTransport:async url=>{
   await load();
   const before=await connectionState();
   if(before.status!=='ready')return {kind:'unavailable',reason:'current_proxy_unverified'};
   const snapshot=clone(model),transport=await Library.transportFor(snapshot,url,readSystem),after=await connectionState();
   return after.status==='ready'&&after.token===before.token?transport:{kind:'unavailable',reason:'current_proxy_changed'};
  }
 });
 const call=(object,method,...args)=>new Promise((resolve,reject)=>{try{object[method](...args,value=>{const e=api.runtime.lastError;e?reject(new Error(e.message)):resolve(value);});}catch(e){reject(e);}});
 async function load(){if(!ready)ready=call(api.storage.local,'get',KEY).then(v=>{model=v[KEY]||{version:1,profiles:{},currentProfileName:'system',zeroRouteError:''};});await ready;}
 async function persist(next){await call(api.storage.local,'set',{[KEY]:next});model=next;}
 async function native(command,settings){const request={command};if(settings!==undefined)request.settings=settings;let c;try{c=await call(api.runtime,'sendNativeMessage',HOST,request);}catch(e){throw error('Install or repair the V2Route Companion: '+e.message,'请安装或修复 V2Route 本地组件');}if(!c?.catalog?.settings||!c?.status)throw new Error(c?.error||'Invalid companion response / 本地组件返回无效');if(c.ok===false)throw new Error(c.error||c.status.error||'Companion operation failed / 本地组件操作失败');latest=c;return c;}
 function profile(name){return own(builtins,name)||own(model.profiles,name);}
 function binding(name,c){const p=profile(name);if(!p)return{exists:false,name,slot:null,route:'manual',predecessor:'inherit'};const slot=p._zeroRouteSlot||null,record=slot&&c.catalog.settings.buttons[slot];return{exists:true,name,slot,route:slot?(record?.route||p._zeroRouteChoice):'manual',predecessor:record?.predecessor||p._zeroRoutePredecessor||'inherit',...chainRecord(storedChain(record,p,c)),port:slot?(c.catalog.settings.ports[slot]||null):null,orphan:!!slot&&!record};}
 function enrich(c,name){const profiles={};for(const p of Object.values(model.profiles))if(p._zeroRouteSlot)profiles[p._zeroRouteSlot]={name:p.name,slot:p._zeroRouteSlot,port:p.fallbackProxy.port};return {...c,apiVersion:4,profiles,binding:name?binding(name,c):null};}
 function needed(name,seen=new Set()){if(seen.has(name))return[];seen.add(name);const p=profile(name);if(!p)throw error('Profile not found','情景不存在');return [...(p._zeroRouteSlot?[p._zeroRouteSlot]:[]),...references(p).flatMap(n=>needed(n,seen))];}
 function checkSlots(c,slots){for(const id of slots){const detail=c.status.slots?.[id],port=c.catalog.settings.ports[id];if(!c.status.running||!detail?.ok||!validPort(port)||c.status.ports?.[id]!==port)throw new Error(detail?.error||c.status.error||'Selected route unavailable / 所选线路不可用');}}
 async function readSystem(){
  let timeout;try{
   const response=await Promise.race([call(api.runtime,'sendNativeMessage',HOST,{command:'systemProxy'}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(error('Reading the system proxy timed out','读取系统代理超时')),5000);})]);
   if(!response?.ok)throw new Error(response?.error||'System proxy unavailable / 系统代理不可用');return systemSnapshot(response.result);
  }finally{clearTimeout(timeout);}
 }
 async function indicator(p){if(!p)return;try{await call(api.action,'setTitle',{title:'Proxy V2Route · '+p.name});await call(api.action,'setBadgeText',{text:p.profileType==='DirectProfile'?'D':p.profileType==='SystemProfile'?'S':''});}catch(_){}}
 async function setBrowser(name,snapshot){
  const p=profile(name);if(!p)throw error('Profile not found','情景不存在');
  let nextBlob=null;
  if(firefox&&!await call(api.extension,'isAllowedIncognitoAccess'))throw error('Allow V2Route in private windows in extension details before changing proxy settings','请先在扩展详情允许 V2Route 在隐私窗口运行');
  const control=await call(api.proxy.settings,'get',{});if(control?.levelOfControl==='not_controllable'||control?.levelOfControl==='controlled_by_other_extensions')throw error('Another extension or policy controls the proxy','其他扩展或策略控制了代理设置');
  let value;
  if(p.profileType==='DirectProfile')value=firefox?{proxyType:'none'}:{mode:'direct'};
  else if(p.profileType==='SystemProfile')value=firefox?{proxyType:'system'}:{mode:'system'};
  else{
   const data=p.profileType==='PacProfile'?p.pacScript:pacFor(name,model.profiles,snapshot);
   if(firefox){nextBlob=URL.createObjectURL(new Blob([data],{type:'application/x-ns-proxy-autoconfig'}));value={proxyType:'autoConfig',autoConfigUrl:nextBlob,proxyDNS:p.proxyDNS!==false};}
   else value={mode:'pac_script',pacScript:{data,mandatory:true}};
  }
  try{const changed=await call(api.proxy.settings,'set',firefox?{value}:{value,scope:'regular'});if(changed===false)throw error('Browser refused the proxy setting','浏览器拒绝代理设置');}catch(e){if(nextBlob)URL.revokeObjectURL(nextBlob);throw e;}
  if(browserTransaction){
    if(!browserTransaction.before)browserTransaction.before={value:clone(control.value),blob:blobUrl,applied:appliedConfig};
   if(nextBlob)browserTransaction.created.add(nextBlob);
  }else if(blobUrl)URL.revokeObjectURL(blobUrl);
   blobUrl=nextBlob;appliedConfig=clone(value);
  await indicator(p);
 }
 async function applyReady(name){const slots=needed(name),snapshot=name!=='system'&&needsSystem(name,model.profiles)?await readSystem():undefined;if(slots.length)checkSlots(await native('ensure'),slots);await setBrowser(name,snapshot);const next=clone(model);next.currentProfileName=name;next.zeroRouteError='';await persist(next);return {name,applied:true};}
 async function apply(name){
  if(needed(name).length)await repairBindings(await native('getState'),false);
  return applyReady(name);
 }
 async function commitProfiles(profiles,currentName=model.currentProfileName){validateGraph(profiles);const before=clone(model),next=clone(model);next.profiles=profiles;next.currentProfileName=currentName;await persist(next);try{if(model.profiles[model.currentProfileName])await apply(model.currentProfileName);}catch(e){await persist(before);throw e;}}
 function savedProfiles(p,from=p.name){
  const profiles=clone(model.profiles);if(from!==p.name)delete profiles[from];profiles[p.name]=p;
  if(from!==p.name)for(const item of Object.values(profiles))if(item.profileType==='SwitchProfile'){
   let changed=false;if(item.defaultProfileName===from){item.defaultProfileName=p.name;changed=true;}
   for(const rule of item.rules)if(rule.profileName===from){rule.profileName=p.name;changed=true;}
   if(changed)item.revision=revision();
  }
  validateGraph(profiles);return profiles;
 }
 function manualAuth(value,scheme){
  if(value===undefined||value===null)return null;
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['username','password'].includes(k)))throw error('Invalid proxy authentication','代理认证参数无效');
  const {username='',password=''}=value;
  if([username,password].some(v=>typeof v!=='string'||v.length>512||/[\x00-\x1f\x7f]/.test(v)))throw error('Invalid proxy credentials','代理账号或密码无效');
  if(!username&&!password)return null;
  if(!username)throw error('Enter a proxy username','请输入代理用户名');
  if(!['http','https','socks5'].includes(scheme))throw error('SOCKS4 authentication is not supported; use HTTP(S) or SOCKS5','SOCKS4 不支持此认证，请使用 HTTP(S) 或 SOCKS5');
  return {username,password};
 }
 async function importManual(p,auth){
  const endpoint=p.fallbackProxy,host=endpoint.host.includes(':')&&!endpoint.host.startsWith('[')?'['+endpoint.host+']':endpoint.host;
  let text;try{text=endpoint.scheme+'://'+encodeURIComponent(auth.username)+':'+encodeURIComponent(auth.password)+'@'+host+':'+endpoint.port+'#'+encodeURIComponent(p.name);}catch(_){throw error('Invalid proxy credentials','代理账号或密码无效');}
  const response=await native('importLinks',{text}),result=response.import_result,id=result?.ids?.[0];
  if(result?.ids?.length!==1||!/^local-[A-Za-z0-9_-]+$/.test(id||''))throw error('Companion did not return the imported proxy','本地组件未返回导入的代理');
  return {route:'node:'+id,added:result.added===1,id,manual:{...endpoint,...auth}};
 }
 async function cleanupManual(items){
  let failed=false;for(const item of items)if(item?.added)try{await native('removeNode',{id:item.id});}catch(_){failed=true;}
  if(failed)throw error('Save failed; a temporary imported proxy remains in the node library','保存失败；临时导入的代理仍保留在节点库，请检查后手动移除');
 }
 async function state(keys){const s={availableProfiles:{...clone(builtins),...clone(model.profiles)},currentProfileName:model.currentProfileName,isSystemProfile:model.currentProfileName==='system',proxyNotControllable:false,zeroRouteError:model.zeroRouteError||''};try{const p=await call(api.proxy.settings,'get',{});s.proxyNotControllable=['not_controllable','controlled_by_other_extensions'].includes(p?.levelOfControl);}catch(e){s.zeroRouteError=e.message;}return keys?Object.fromEntries(keys.map(k=>[k,s[k]])):s;}
 // Read-only effective-setting inspection. It never starts/repairs the Companion
 // or sets a proxy. A separate popup-scoped network check verifies reachability.
 async function connectionState(incognito=false){
  const name=model.currentProfileName,p=profile(name);
  const result={profile:name,limited:p?.profileType==='SwitchProfile'||p?.profileType==='PacProfile'||name==='system'||!!p?.bypassList?.length};
  if(!p)return {...result,status:'error',code:'MISSING'};
  const current=await call(api.proxy.settings,'get',firefox?{}:{incognito:incognito===true});
  if(['not_controllable','controlled_by_other_extensions'].includes(current?.levelOfControl))return {...result,status:'error',code:'OVERRIDDEN'};
  if(model.zeroRouteError)return {...result,status:'error',code:'APPLY_FAILED'};
  const actual=current?.value||{},type=firefox?actual.proxyType:actual.mode;
  let matches=false;
  if(name==='direct'||name==='system')matches=type===(name==='direct'?(firefox?'none':'direct'):'system');
  else if(current?.levelOfControl!=='controlled_by_this_extension')return {...result,status:'error',code:'NOT_APPLIED'};
  else if(appliedConfig){
   matches=firefox?type===appliedConfig.proxyType&&actual.autoConfigUrl===appliedConfig.autoConfigUrl&&actual.proxyDNS===appliedConfig.proxyDNS:
    type===appliedConfig.mode&&actual.pacScript?.data===appliedConfig.pacScript?.data&&actual.pacScript?.mandatory===true;
  }else if(!firefox&&!needsSystem(name,model.profiles)){
   matches=type==='pac_script'&&actual.pacScript?.mandatory===true&&actual.pacScript?.data===(p.profileType==='PacProfile'?p.pacScript:pacFor(name,model.profiles));
  }else return {...result,status:'unknown',code:'UNVERIFIED'};
  if(!matches)return {...result,status:'error',code:'NOT_APPLIED'};
  // Return only a fingerprint; PAC data can include private manual endpoints.
  const bytes=new TextEncoder().encode(JSON.stringify([name,actual,model.profiles]));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {...result,status:'ready',code:'READY',token:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')};
 }
 function revisionCheck(p,expected){if(p?(p.revision!==expected):(expected!==null&&expected!==undefined))throw error('Profile changed in another window. Reopen it and try again','情景已在其他窗口修改，请重新打开后再试');}
 function validRoute(route){if(route!=='follow'&&!/^node:[A-Za-z0-9_-]{1,128}$/.test(route||''))throw error('Invalid route','线路无效');}
 function validPredecessor(route,value){if(!['inherit','none'].includes(value))validRoute(value);if(value==='follow'||(route==='follow'&&!['inherit','none'].includes(value)))throw error('Invalid predecessor for this route','此前置代理不适用于所选线路');}
 function validChain(route,chain){if(chain===undefined)return;if(!Array.isArray(chain)||chain.some(value=>typeof value!=='string'||!/^node:[A-Za-z0-9_-]{1,128}$/.test(value))||(route==='follow'&&chain.length))throw error('Invalid ordered chain','多层代理节点或顺序无效');}
 function chainRecord(chain){return chain===undefined?{}:{chain:clone(chain)};}
 // A capable companion can remove a chain; older services and orphan recovery need saved metadata.
 function storedChain(record,p,c){return record&&c.capabilities?.explicitChains?record.chain:record?.chain??p._zeroRouteChain;}
 function requireChain(c,chain){if(chain!==undefined&&!c.capabilities?.explicitChains)throw error('Upgrade the local companion to enable ordered chains','请升级本地组件以启用多层代理');}
 function routeCountry(c,route){const country=String(c?.catalog?.routes?.find(r=>r.value===route)?.country||'').toLowerCase();return /^[a-z]{2}$/.test(country)&&country!=='xx'?country:'';}
 function managed(p,c,slot,route){const port=c.catalog.settings.ports[slot];if(!validPort(port))throw error('No port was allocated','未分配有效端口');const country=route==='follow'?'':routeCountry(c,route);const result={...p,revision:revision(),_zeroRouteSlot:slot,_zeroRouteChoice:route,_zeroRouteCountry:country,_zeroRoutePredecessor:c.catalog.settings.buttons[slot]?.predecessor||'inherit',_zeroRouteIcon:route==='follow'?'v2route-ui/icons/follow.svg':country?'zero-assets/flags/'+country+'.svg':'v2route-ui/icons/route.svg',fallbackProxy:{scheme:'socks5',host:'127.0.0.1',port},proxyDNS:true,bypassList:p.bypassList||[]};const chain=c.catalog.settings.buttons[slot]?.chain;if(chain===undefined)delete result._zeroRouteChain;else result._zeroRouteChain=clone(chain);return result;}
 async function repairBindings(c,reapply=true){
  if(c.catalog.error||!Array.isArray(c.catalog.routes))return c;
  const available=new Map(c.catalog.routes.map(route=>[route.value,route]));
  const settings=clone(c.catalog.settings),plans=[];
  for(const p of Object.values(model.profiles)){
   if(!p._zeroRouteSlot||p._v2routeManual)continue;
   const slot=p._zeroRouteSlot,previous=settings.buttons[slot];
   let route=previous?.route||p._zeroRouteChoice||'follow';
   if(route==='manual'||route==='none')route=p._zeroRouteChoice||'follow';
   const managedChoice=typeof route==='string'&&(route==='follow'||route.startsWith('node:'));
   if(!managedChoice||!available.has(route)){
    if(storedChain(previous,p,c)!==undefined)continue;
    if(!available.has('follow')||available.get('follow').supported===false)continue;
    route='follow';
   }
   const savedPredecessor=previous?.predecessor||p._zeroRoutePredecessor||'inherit',predecessor=route==='follow'&&!['inherit','none'].includes(savedPredecessor)?'inherit':savedPredecessor,chain=storedChain(previous,p,c);
   if(chain!==undefined&&!c.capabilities?.explicitChains)continue;
   const configure=!previous||previous.route!==route||!validPort(settings.ports[slot]);
   const metadata=p._zeroRouteChoice!==route||p._zeroRoutePredecessor!==predecessor||JSON.stringify(p._zeroRouteChain)!==JSON.stringify(chain)||p.fallbackProxy?.port!==settings.ports[slot];
   if(!configure&&!metadata)continue;
   if(configure)settings.buttons[slot]={label:p.name,route,predecessor,...chainRecord(chain)};
   plans.push({p,slot,route,previous,configure});
  }
  if(!plans.length)return c;
  const before=clone(model),changed=plans.filter(plan=>plan.configure);
  let done=c,configured=false;
  try{
   if(changed.length){
    done=await native('configure',settings);configured=true;
    checkSlots(done,changed.map(plan=>plan.slot));
   }
   const next=clone(model);
   for(const plan of plans)next.profiles[plan.p.name]=managed(plan.p,done,plan.slot,plan.route);
   await persist(next);
   const activeSlots=new Set(needed(model.currentProfileName));
   if(reapply&&plans.some(plan=>activeSlots.has(plan.slot)))await applyReady(model.currentProfileName);
   return done;
  }catch(e){
   await persist(before);
   if(configured)for(const plan of changed){
    try{await rollbackSlot(plan.slot,plan.previous);}
    catch(restore){throw error('Route recovery failed and restoration needs attention: '+restore.message,'线路恢复失败且原绑定尚未完全还原');}
   }
   throw e;
  }
 }
 async function rollbackSlot(slot,record){if(!record)return native('releaseSlot',{id:slot});const c=await native('getState'),settings=clone(c.catalog.settings);settings.buttons[slot]=record;return native('configure',settings);}
 async function bind(name,route,prior,manual,predecessor){let p=model.profiles[name];if(!p||p.profileType!=='FixedProfile')throw error('Choose a proxy profile','请选择代理情景');const c=await native('getState'),current=binding(name,c);if(!prior||prior.slot!==current.slot||prior.route!==current.route||(prior.predecessor||'inherit')!==current.predecessor||JSON.stringify(prior.chain)!==JSON.stringify(current.chain))throw error('Route changed in another window. Refresh first','线路已在其他窗口修改，请先刷新');
  if(route==='manual'){if(!p._zeroRouteSlot)return enrich(c,name);if(!manual)throw error('Enter the replacement manual proxy before detaching','解除绑定前请填写手工代理');const old=p._zeroRouteSlot,before=clone(model),next=clone(model.profiles);const replacement=sanitize({...manual,name,profileType:'FixedProfile',color:p.color});if(replacement.fallbackProxy.host==='127.0.0.1'&&replacement.fallbackProxy.port===p.fallbackProxy.port)throw error('The managed port will be released. Enter a different manual proxy','此自动端口即将释放，请填写其他手工代理');next[name]=replacement;await commitProfiles(next);try{return enrich(await native('releaseSlot',{id:old}),name);}catch(e){await persist(before);try{await setBrowser(before.currentProfileName);}catch(_){}throw e;}}
  validRoute(route);const chain=route==='follow'?undefined:current.chain;requireChain(c,chain);predecessor=chain!==undefined?'none':predecessor??current.predecessor;validPredecessor(route,predecessor);const slot=p._zeroRouteSlot||'zo-'+crypto.randomUUID(),settings=clone(c.catalog.settings),previous=settings.buttons[slot];settings.buttons[slot]={label:name,route,predecessor,...chainRecord(chain)};const done=await native('configure',settings);try{checkSlots(done,[slot]);const profiles=clone(model.profiles);profiles[name]=managed(p,done,slot,route);await commitProfiles(profiles);return enrich(done,name);}catch(e){try{await rollbackSlot(slot,previous);}catch(rollback){throw error('Route save failed and rollback needs attention: '+rollback.message,'线路保存失败且恢复未完成');}throw e;}
 }
 async function saveProfile(input,expected,routeOptions,renameTo){
  const from=input?.name,existing=own(model.profiles,from);revisionCheck(existing,expected);
  const target=renameTo??from;if(!nameValid(from)||!nameValid(target)||(target!==from&&own(model.profiles,target)))throw error('Invalid or duplicate profile name','名称无效或已存在');
  input={...input,name:target};if(routeOptions===null)routeOptions=undefined;
  if(routeOptions!==undefined&&(!routeOptions||typeof routeOptions!=='object'||Array.isArray(routeOptions)||Object.keys(routeOptions).some(k=>!['route','predecessor','auth','chain'].includes(k))||input?.profileType!=='FixedProfile'||(routeOptions.auth!==undefined&&routeOptions.route!=='manual')))throw error('Invalid route settings','线路设置无效');
  const currentName=model.currentProfileName===from?target:model.currentProfileName;
  const auth=routeOptions?.route==='manual'?manualAuth(routeOptions.auth,input.fallbackProxy?.scheme):null;
  if(routeOptions?.route==='manual'&&routeOptions.chain!==undefined)throw error('Manual proxies do not accept a node chain','手工代理不能附带节点链');
  if((routeOptions&&routeOptions.route!=='manual')||auth){
   let imported=null;
   const draft=sanitize(auth?input:{...input,fallbackProxy:{scheme:'socks5',host:'127.0.0.1',port:1}},undefined);savedProfiles(draft,from);
   let route=routeOptions.route,predecessor=auth?'none':routeOptions.predecessor??'inherit',chain=routeOptions.chain;if(!auth){validRoute(route);validPredecessor(route,predecessor);validChain(route,chain);}if(chain!==undefined)predecessor='none';
   const c=await native('getState');requireChain(c,chain);
   const slot=existing?._zeroRouteSlot||'zo-'+crypto.randomUUID(),settings=clone(c.catalog.settings),previous=settings.buttons[slot];
   if(existing?._zeroRouteSlot&&(!previous||previous.route!==existing._zeroRouteChoice||(previous.predecessor||'inherit')!==(existing._zeroRoutePredecessor||'inherit')||JSON.stringify(previous.chain)!==JSON.stringify(existing._zeroRouteChain)))throw error('Route changed in another window. Refresh first','线路已在其他窗口修改，请先刷新');
   let configured=false;
   try{
    if(auth){imported=await importManual(draft,auth);route=imported.route;draft._v2routeManual=imported.manual;}
    settings.buttons[slot]={label:target,route,predecessor,...chainRecord(chain)};const done=await native('configure',settings);configured=true;
    checkSlots(done,[slot]);const p=managed(draft,done,slot,route);await commitProfiles(savedProfiles(p,from),currentName);return clone(p);
   }catch(e){if(configured)try{await rollbackSlot(slot,previous);}catch(rollback){throw error('Save failed and route restoration needs attention: '+rollback.message,'保存失败且线路恢复未完成');}await cleanupManual([imported]);throw e;}
  }
  const detaching=existing?._zeroRouteSlot&&(input.profileType!=='FixedProfile'||routeOptions?.route==='manual');
  const p=sanitize(input,detaching?undefined:existing),before=clone(model);
  if(detaching&&p.profileType==='FixedProfile'&&p.fallbackProxy.host==='127.0.0.1'&&p.fallbackProxy.port===existing.fallbackProxy.port)throw error('The managed port will be released. Enter a different manual proxy','此自动端口即将释放，请填写其他手工代理');
  await commitProfiles(savedProfiles(p,from),currentName);
  if(detaching)try{await native('releaseSlot',{id:existing._zeroRouteSlot});}catch(e){await persist(before);try{await setBrowser(before.currentProfileName);}catch(_){}throw e;}
  return clone(p);
 }
 const methods={
  v2routeClearToolCache:value=>toolCache.clear(value),
  v2routeWaitToolCache:value=>toolCache.wait(value),
  getAll:()=>Object.fromEntries(Object.entries({...builtins,...model.profiles}).map(([k,v])=>['+'+k,clone(v)])),
  getState:state,
   v2routeConnectionState:connectionState,
  v2routeCachedProfileCountries:()=>latest?Object.fromEntries(Object.values(model.profiles).filter(p=>p._zeroRouteChoice?.startsWith('node:')).map(p=>[p.name,{choice:p._zeroRouteChoice,country:routeCountry(latest,p._zeroRouteChoice)}])):{},
  applyProfile:apply,
  zeroRouteGetState:async name=>enrich(await repairBindings(await native('getState')),name),
  zeroRouteEnsure:async()=>enrich(await native('ensure')),
  zeroRouteReorder:async value=>enrich(await native('reorder',value)),
  zeroRouteBind:bind,
  zeroRouteCreate:async(input,route='follow',predecessor='inherit')=>{if(!input||!nameValid(input.name)||model.profiles[input.name])throw error('Choose a unique profile name','请输入不重复的情景名称');validRoute(route);validPredecessor(route,predecessor);const c=await native('getState'),slot='zo-'+crypto.randomUUID(),settings=clone(c.catalog.settings);settings.buttons[slot]={label:input.name,route,predecessor};const done=await native('configure',settings);try{checkSlots(done,[slot]);const p=managed({name:input.name,profileType:'FixedProfile',color:input.color||'#269eab',bypassList:[]},done,slot,route);const profiles=clone(model.profiles);profiles[p.name]=p;await commitProfiles(profiles);return enrich(done,p.name);}catch(e){try{await native('releaseSlot',{id:slot});}catch(_){}throw e;}},
  v2routeSaveProfile:saveProfile,
  v2routeChainProbe:async value=>{
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['route','chain','index','predecessor'].includes(k)))throw error('Invalid chain probe','链路探测请求无效');
   validRoute(value.route);validChain(value.route,value.chain);if(!Array.isArray(value.chain)||!Number.isInteger(value.index)||value.index<0||value.index>value.chain.length)throw error('Invalid hop index','链路层号无效');
   if(Object.hasOwn(value,'predecessor')){if(typeof value.predecessor!=='string')throw error('Invalid legacy predecessor','继承模式前置无效');validPredecessor(value.route,value.predecessor);}
   const response=await call(api.runtime,'sendNativeMessage',HOST,{command:'chainProbe',settings:value});
   if(!response?.ok||typeof response.result?.ok!=='boolean'||response.result.index!==value.index)throw error('Chain probe failed','链路探测失败');return response.result;
  },
  renameProfile:async(from,to)=>{const p=own(model.profiles,from);if(!p||!nameValid(to)||own(model.profiles,to))throw error('Invalid or duplicate profile name','名称无效或已存在');const manual=p._v2routeManual;return saveProfile(manual?{...p,fallbackProxy:{scheme:manual.scheme,host:manual.host,port:manual.port}}:p,p.revision,manual?{route:'manual',auth:{username:manual.username,password:manual.password}}:p._zeroRouteSlot?{route:p._zeroRouteChoice,predecessor:p._zeroRoutePredecessor||'inherit',...chainRecord(p._zeroRouteChain)}:null,to);},
  v2routeDeleteProfile:async(name,expected,options)=>{
   const p=model.profiles[name];revisionCheck(p,expected);
   if(!p)throw error('Profile not found','情景不存在');
   const active=model.currentProfileName===name;
   if(active&&options?.switchTo!=='system')throw error('Switch to another profile before deleting','请切换到其他情景后再删除');
   if(Object.values(model.profiles).some(x=>references(x).includes(name)))throw error('This profile is referenced by an automatic rule','该情景被自动规则引用');
   const before=clone(model),next=clone(model);
   delete next.profiles[name];
   if(active){await setBrowser('system');next.currentProfileName='system';next.zeroRouteError='';}
   await persist(next);
   try{if(p._zeroRouteSlot)await native('releaseSlot',{id:p._zeroRouteSlot});}
   catch(e){await persist(before);throw e;}
   if(active)await indicator(profile('system'));
   return true;
  },
  v2routeImportLinks:async text=>enrich(await native('importLinks',{text})),
  v2routeRemoveNode:async id=>enrich(await native('removeNode',{id})),
  v2routeHostSettings:async value=>enrich(await native('hostSettings',value)),
  v2routeRescan:async()=>enrich(await native('rescan')),
  v2routeChooseV2Folder:async()=>enrich(await native('chooseV2Folder')),
  v2routeBrowseV2Folder:async value=>{
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['path','validate'].includes(key))||typeof value.path!=='string'||value.path.length>1024||(value.validate!==undefined&&typeof value.validate!=='boolean'))throw error('Invalid folder request','文件夹请求无效');
   const response=await call(api.runtime,'sendNativeMessage',HOST,{command:'folderBrowse',settings:value});
   if(!response?.ok)throw error('Folder unavailable; check path, access and Companion version','文件夹不可用，请检查路径、访问权限及本地组件版本');
   return response.result;
  },
  v2routeCoreStatus:async()=>{const response=await call(api.runtime,'sendNativeMessage',HOST,{command:'coreStatus'});if(!response?.ok)throw new Error(response?.error||'Core status unavailable / 核心状态不可用');return response.result;},
  v2routeInstallCore:async()=>{const response=await call(api.runtime,'sendNativeMessage',HOST,{command:'installCore'});if(!response?.ok)throw new Error(response?.error||'Core installation failed / 核心安装失败');return response.result;},
  v2routeNetworkTest:async settings=>{
   if(!settings||typeof settings!=='object'||Array.isArray(settings))throw error('Invalid network test','网络检测参数无效');
   let request={...settings};if(request.target==='current'){
    const p=profile(model.currentProfileName),manual=p?._v2routeManual;
    if(!p||p.profileType!=='FixedProfile')throw error('Select a node or manual proxy profile, or enter a custom target','请先切换到节点或手动代理情景，或填写自定义目标');
    request={kind:request.kind,target:'current',...(request.count!==undefined?{count:request.count}:{})};
    if(manual||!p._zeroRouteSlot){const endpoint=manual||p.fallbackProxy;request.host=endpoint.host;request.port=endpoint.port;}
    else{request.route=p._zeroRouteChoice;request.predecessor=p._zeroRoutePredecessor||'inherit';}
   }
   const response=await call(api.runtime,'sendNativeMessage',HOST,{command:'networkTest',settings:request});if(!response?.ok||!(request.kind==='mtr'?Array.isArray(response.result?.hops):Array.isArray(response.result?.samples)))throw new Error(response?.error||'Network diagnostic failed / 网络检测失败');return response.result;
  },
  v2routeExport:()=>({format:1,product:'V2Route',profiles:Object.values(model.profiles).map(p=>{const q=clone(p);if(q._zeroRouteSlot){if(q._v2routeManual){const m=q._v2routeManual;q.fallbackProxy={scheme:m.scheme,host:m.host,port:m.port};q.manualAuth={username:m.username,password:m.password};}else{q.route=q._zeroRouteChoice;q.predecessor=q._zeroRoutePredecessor||'inherit';if(q._zeroRouteChain!==undefined)q.chain=clone(q._zeroRouteChain);delete q.fallbackProxy;}for(const key of ['_zeroRouteSlot','_zeroRouteChoice','_zeroRouteIcon','_zeroRouteCountry','_zeroRoutePredecessor','_zeroRouteChain','_v2routeManual'])delete q[key];}return q;}),note:'Manual proxy usernames and passwords are included. Node credentials are stored separately by the Companion. Keep this backup private. / 此备份含手动代理用户名和密码；节点凭据另存于本地组件。请妥善保管此文件。'}),
  v2routeImportProfiles:async value=>{
   if(value?.format!==1||!Array.isArray(value.profiles)||value.profiles.length>500)throw error('Invalid V2Route backup','无效的 V2Route 备份');
   const profiles=clone(model.profiles),managedPlans=[],importedManual=[];
   for(const item of value.profiles){
    if(!nameValid(item.name)||own(profiles,item.name))throw error('Duplicate or invalid profile: '+item.name,'名称重复或无效，未导入');
    if(item._zeroRouteSlot)throw error('Backup contains internal bindings','备份含内部绑定标识');
    const route=item.route;if((route||item.manualAuth)&&item.profileType!=='FixedProfile')throw error('Only proxy profiles can have route bindings','仅代理情景可以绑定线路');
    if(route&&item.manualAuth)throw error('Backup has conflicting proxy settings','备份代理设置冲突');
    const p=sanitize(route?{...item,fallbackProxy:{scheme:'socks5',host:'127.0.0.1',port:1}}:item),auth=manualAuth(item.manualAuth,p.fallbackProxy?.scheme);
    profiles[p.name]=p;if(route){validRoute(route);const predecessor=item.predecessor??'inherit';validPredecessor(route,predecessor);validChain(route,item.chain);managedPlans.push({p,route,predecessor,...chainRecord(item.chain)});}else if(auth)managedPlans.push({p,auth,predecessor:'none'});
   }
   validateGraph(profiles);let committed=null;
   try{
    if(managedPlans.length){
     const c=await native('getState'),settings=clone(c.catalog.settings);for(const m of managedPlans)requireChain(c,m.chain);
     for(const m of managedPlans)if(m.auth){const imported=await importManual(m.p,m.auth);importedManual.push(imported);m.route=imported.route;m.p._v2routeManual=imported.manual;}
     for(const m of managedPlans){m.slot='zo-'+crypto.randomUUID();settings.buttons[m.slot]={label:m.p.name,route:m.route,predecessor:m.chain===undefined?m.predecessor:'none',...chainRecord(m.chain)};}
     committed=await native('configure',settings);checkSlots(committed,managedPlans.map(m=>m.slot));
     for(const m of managedPlans)profiles[m.p.name]=managed(m.p,committed,m.slot,m.route);
    }
    await commitProfiles(profiles);return {imported:value.profiles.length};
   }catch(e){
    if(committed){const failed=[];for(const m of managedPlans)try{await native('releaseSlot',{id:m.slot});}catch(_){failed.push(m.slot);}if(failed.length)throw error('Import failed; some allocated ports could not be released','导入失败，部分已分配端口尚未释放');}
    await cleanupManual(importedManual);
    throw e;
   }
  }
 };
 async function dispatch(message){await load();if(library.methods.has(message?.method)){if(!Array.isArray(message.args||[])||(message.args||[]).length>1)throw error('Invalid library request','节点库请求无效');return library.run(message.method,message.args?.[0]);}if(!message||!Object.hasOwn(methods,message.method)||!Array.isArray(message.args||[]))throw error('Unsupported request','不支持的请求');return methods[message.method](...(message.args||[]));}
 function run(message){if(library.methods.has(message?.method)||['v2routeChainProbe','v2routeClearToolCache','v2routeWaitToolCache','v2routeBrowseV2Folder'].includes(message?.method))return dispatch(message);const work=queue.then(async()=>{
  await load();const transaction={before:null,created:new Set(),profile:clone(profile(model.currentProfileName)||null)};browserTransaction=transaction;
  try{return await dispatch(message);}catch(e){
   if(transaction.before){try{const changed=await call(api.proxy.settings,'set',firefox?{value:transaction.before.value}:{value:transaction.before.value,scope:'regular'});if(changed===false)throw error('Browser refused proxy rollback','浏览器拒绝恢复代理');blobUrl=transaction.before.blob;appliedConfig=transaction.before.applied;await indicator(transaction.profile);}
    catch(restore){throw error('Operation failed and the previous browser proxy could not be restored: '+restore.message,'操作失败，且之前的浏览器代理未能恢复');}}
   throw e;
  }finally{
   if(transaction.before?.blob&&transaction.before.blob!==blobUrl)URL.revokeObjectURL(transaction.before.blob);
   for(const url of transaction.created)if(url!==blobUrl)URL.revokeObjectURL(url);
   browserTransaction=null;
  }
 });queue=work.catch(()=>{});return work;}
 function attach(){api.runtime.onMessage.addListener((message,sender,respond)=>{if(sender.id!==api.runtime.id)return false;if(library.methods.has(message?.method)&&!String(sender.url||'').startsWith(api.runtime.getURL('v2route-ui/')))return false;run(message).then(result=>respond({result}),e=>respond({error:{message:e.message}}));return true;});
  library.attach();
  const restore=()=>run({method:'getState'}).then(async()=>{if(model.currentProfileName!=='system')try{await run({method:'applyProfile',args:[model.currentProfileName]});}catch(e){await persist({...model,zeroRouteError:e.message});if(firefox){try{const bad=new Blob(['function FindProxyForURL(){return "PROXY 127.0.0.1:0";}'],{type:'application/x-ns-proxy-autoconfig'});await call(api.proxy.settings,'set',{value:{proxyType:'autoConfig',autoConfigUrl:URL.createObjectURL(bad)}});}catch(_){}}}});
  api.runtime.onInstalled?.addListener(details=>openFirstInstall(api,details));
  api.runtime.onStartup?.addListener(restore);restore().catch(()=>{});
 }
 return {run,attach,getModel:()=>clone(model)};
}
function openFirstInstall(api,details){
 if(details?.reason!=='install')return;
 try{api.tabs.create({url:api.runtime.getURL('v2route-ui/options.html')+'#settings'},()=>{void api.runtime.lastError;});}catch(_){}
}
const exported={createController,sanitize,validateGraph,pacFor,nameValid,openFirstInstall};
if(typeof module==='object'&&module.exports)module.exports=exported;
else if(root.chrome?.runtime)createController(root.chrome,typeof root.browser!=='undefined'&&!!root.browser.runtime?.getBrowserInfo).attach();
})(globalThis);
