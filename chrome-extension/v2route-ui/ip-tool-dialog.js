/* User-opened tools stay in a bounded, disposable dialog. */
(function(root){
  'use strict';
  const tools = Object.freeze([
    {id:'wall',group:'Web',key:'toolWall',provider:'GreatFire',url:'https://en.greatfire.org/analyzer'},
    {id:'global',group:'IP',key:'toolGlobal',provider:'Globalping',kind:'ping'},
    {id:'sites',group:'Web',key:'toolSites',provider:'Proxy V2Route',kind:'sites'},
    {id:'speed',group:'Speed',key:'toolSpeed',provider:'Cloudflare',kind:'speed'},
    {id:'fast',group:'Speed',key:'toolFast',provider:'FAST.com',url:'https://fast.com/'}
  ].map(Object.freeze));
  const allowedHosts = new Set([...tools.filter(tool=>tool.url).map(tool=>new URL(tool.url).hostname),'ping0.cc']);
  const t = key=>I18n.t(key);
  const el = (tag,cls,text)=>{const value=document.createElement(tag);if(cls)value.className=cls;if(text!=null)value.textContent=text;return value;};
  let activeDialog=null,activeController=null;
  const cacheTasks=new Map();
  const cacheOrigin=spec=>spec.url?new URL(spec.url).origin:spec.kind==='speed'?'https://speed.cloudflare.com':spec.kind==='ping'?'https://api.globalping.io':null;
  function cacheRPC(method,url){try{return Promise.resolve(V2R.rpc(method,[{url}])).then(value=>value||{status:'failed'},()=>({status:'failed'}));}catch{return Promise.resolve({status:'failed'});}}
  function clearToolCache(origin){
    if(!origin)return;
    const pending=cacheRPC('v2routeClearToolCache',origin);cacheTasks.set(origin,pending);
    pending.finally(()=>{if(cacheTasks.get(origin)===pending)cacheTasks.delete(origin);});
  }
  async function waitToolCache(origin){
    if(!origin)return {status:'idle'};
    await cacheTasks.get(origin);
    return cacheRPC('v2routeWaitToolCache',origin);
  }

  function close(){activeController?.abort();activeDialog?.close();}

  async function probe(url,signal){
    const controller=new AbortController(),cancel=()=>controller.abort();
    signal.addEventListener('abort',cancel,{once:true});
    const timeout=setTimeout(cancel,8000),started=performance.now();
    try{
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      const response=await fetch(url,{mode:'no-cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      response.body?.cancel().catch(()=>{});
      return {ok:true,duration:Math.round(performance.now()-started)};
    }catch{return {ok:false};}
    finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);controller.abort();}
  }

  function renderSites(body,dialog,signal){
    const controls=el('div','ip-tool-controls'),filter=el('select'),start=el('button','button primary',t('toolStart')),stop=el('button','button subtle',t('netStop'));
    filter.setAttribute('aria-label',t('siteCategory'));for(const group of ['',...ToolCatalog.groups]){const option=el('option','',t(group?'site'+group:'siteAll'));option.value=group;filter.append(option);}
    start.type=stop.type='button';stop.hidden=true;controls.append(filter,start,stop);
    const summary=el('p','ip-tool-status',t('toolSiteHelp')),grid=el('div','ip-site-results'),rows=ToolCatalog.sites.map(site=>{
      const row=el('label','ip-site-result'),selected=el('input'),label=el('strong','',site.name),value=el('span','',t('toolReady'));
      selected.type='checkbox';selected.checked=true;row.dataset.group=site.group;row.append(selected,label,value);grid.append(row);return {...site,row,selected,value};
    });
    body.append(summary,controls,grid);filter.onchange=()=>rows.forEach(x=>{x.row.hidden=!!filter.value&&filter.value!==x.group;});
    let running=null;const cancel=()=>running?.abort();stop.onclick=cancel;signal.addEventListener('abort',cancel,{once:true});
    start.onclick=async()=>{
      if(running)return;const controller=new AbortController();running=controller;signal.addEventListener('abort',cancel,{once:true});
      start.disabled=true;stop.hidden=false;const queue=rows.filter(x=>!x.row.hidden&&x.selected.checked);let at=0,finished=0;
      queue.forEach(x=>{x.row.removeAttribute('data-outcome');x.value.textContent=t('toolReady');});
      await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
        while(at<queue.length&&!controller.signal.aborted){const item=queue[at++];item.value.textContent=t('ipChecking');const value=await probe(item.url,controller.signal);
          if(!dialog.open||signal.aborted)return;finished++;item.row.dataset.outcome=value.ok?'ok':'error';item.value.textContent=controller.signal.aborted?t('netStopped'):value.ok?t('toolResponded')+' · '+value.duration+' ms':t('toolNoResponse');summary.textContent=finished+' / '+queue.length+' · '+t('toolSiteHelp');}
      }));
      signal.removeEventListener('abort',cancel);running=null;if(dialog.open){start.disabled=false;stop.hidden=true;}
    };
  }

  function fillCurrentIP(target,status,signal,spec){
    let edited=false;target.addEventListener('input',()=>{edited=true;});
    status.textContent=t('toolCurrentIPLoading');
    Promise.resolve().then(()=>spec.getCurrentIP?spec.getCurrentIP(signal):V2RIP.runCheck({family:'ipv4',signal}).then(x=>x.ip)).then(ip=>{
      V2RIP.qualityURL(ip);if(signal.aborted||!target.isConnected||!target.closest('dialog')?.open)return;if(!edited)target.value=ip;status.textContent=t('toolCurrentIP');target.dispatchEvent(new Event('change'));
    }).catch(()=>{if(!signal.aborted&&target.isConnected)status.textContent=t('toolCurrentIPFailed');});
  }

  function renderGlobalPing(body,dialog,signal,spec){
    const controls=el('div','ip-tool-controls'),target=el('input'),region=el('select'),start=el('button','button primary',t('toolStart'));
    target.type='text';target.value='';target.placeholder=t('toolCurrentIP');target.maxLength=253;target.setAttribute('aria-label',t('netHost'));
    for(const [value,key]of [['','globalWorld'],['CN','netChina'],['AS','toolAsia'],['EU','toolEurope'],['NA','toolAmerica']]){const option=el('option','',t(key));option.value=value;region.append(option);}
    region.setAttribute('aria-label',t('netRegion'));region.value=I18n.language==='zh'?'AS':'';start.type='button';
    const current=el('p','ip-tool-status'),help=el('p','ip-tool-status',t('toolGlobalHelp')),caution=el('p','ip-tool-status',t('globalIcmpCaution')),status=el('p','ip-tool-status'),results=el('div','ip-global-results');status.setAttribute('role','status');
    const method=el('select');method.setAttribute('aria-label',t('globalMethod'));for(const value of ['ping','traceroute','mtr']){const option=el('option','',value==='ping'?'Ping':value==='mtr'?'MTR':'Traceroute');option.value=value;method.append(option);}
    controls.append(target,region,method,start);body.append(current,help,controls,caution,status,results);fillCurrentIP(target,current,signal,spec);
    start.onclick=async()=>{
      if(start.disabled)return;
      const host=target.value.trim();
      let privateIPv6=false;
      if(host.includes(':'))try{privateIPv6=/^\[(?:f[cd][\da-f]{2}|fe[89ab][\da-f]):/i.test(new URL('http://['+host+']/').hostname);}catch{}
      if(privateIPv6||!host||!/^[a-zA-Z0-9.:-]{1,253}$/.test(host)||/^(?:localhost|127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1$)/i.test(host)){status.textContent=t('netInvalidTarget');return;}
      const controller=new AbortController(),cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});const timer=setTimeout(cancel,35000);
      start.disabled=target.disabled=region.disabled=method.disabled=true;results.replaceChildren();status.textContent=t('netRunning');
      async function api(url,options={}){
        const response=await fetch(url,{...options,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Object.assign(new Error('HTTP'),{status:response.status});const raw=await response.text();if(raw.length>524288)throw new Error('Large response');return JSON.parse(raw);
      }
      try{
        const request={type:method.value,target:host,limit:3,inProgressUpdates:true};if(region.value)request.locations=[region.value==='CN'?{country:'CN'}:{continent:region.value}];
        const created=await api('https://api.globalping.io/v1/measurements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
        if(!/^[\w-]{1,128}$/.test(created.id||''))throw new Error('Invalid ID');
        for(let attempt=0;attempt<15;attempt++){
          const data=await api('https://api.globalping.io/v1/measurements/'+encodeURIComponent(created.id));
          if(!dialog.open||signal.aborted)return;results.replaceChildren();
          const samples=(Array.isArray(data.results)?data.results:[]).slice(0,3);
          for(const item of samples){
            const row=el('section','ip-global-result'),probe=item.probe||{},result=item.result||{},stats=result.stats||{};
            const sampleState=['finished','failed','offline','in-progress'].includes(result.status)?result.status:'in-progress';row.dataset.state=sampleState;
            const label=sampleState==='offline'?'globalProbeOffline':sampleState==='failed'?'globalProbeFailed':sampleState==='in-progress'?'netRunning':request.type==='ping'&&stats.rcv===0?'netIcmpShort':'netComplete';
            const metrics=[t(label)];
            if(request.type==='ping'&&typeof stats.loss==='number'&&Number.isFinite(stats.loss))metrics.push(t('netLoss')+': '+stats.loss+'%');
            if(typeof stats.avg==='number'&&Number.isFinite(stats.avg))metrics.push(t('netAverageShort')+': '+Math.round(stats.avg*100)/100+' ms');
            row.append(el('strong','',[probe.country,probe.city,probe.network].filter(Boolean).join(' · ').slice(0,200)),el('p','ip-tool-status',metrics.join(' · ')));
            if(result.rawOutput){const details=el('details','ip-global-details');details.append(el('summary','',t('details')),el('pre','',String(result.rawOutput).slice(0,10000)));row.append(details);}
            results.append(row);
          }
          if(data.status==='finished'){status.textContent=t(!samples.length?'globalNoResults':samples.length<request.limit||samples.some(item=>item.result?.status!=='finished')?'netPartial':'netComplete');return;}
          await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},2000);const abort=()=>{clearTimeout(timeout);reject(new DOMException('Aborted','AbortError'));};controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();});
        }
        status.textContent=t('netPartial');
      }catch(error){if(dialog.open&&!signal.aborted)status.textContent=t(error.status===422?'globalUnavailable':error.status===429?'globalRateLimited':results.childElementCount?'netPartial':'toolServiceError');}
      finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.abort();if(dialog.open)start.disabled=target.disabled=region.disabled=method.disabled=false;}
    };
  }

  function openUrl(spec){
    if(spec.url){const url=new URL(spec.url);if(url.protocol!=='https:'||url.port||!allowedHosts.has(url.hostname)||url.username||url.password)throw new Error('Invalid tool URL');}
    close();
    const opener=document.activeElement,dialog=el('dialog','ip-tool-dialog'),header=el('header','ip-tool-header');
    dialog.dataset.kind=spec.kind||'frame';
    const title=el('h2','',spec.title||t(spec.key));title.id='ip-tool-title';dialog.setAttribute('aria-labelledby',title.id);
    const labels=el('div','ip-tool-heading'),provider=el('p','ip-tool-provider',spec.provider||'Ping0');labels.append(title,provider);
    const actions=el('div','ip-tool-actions'),dismiss=el('button','button subtle',t('toolClose'));dismiss.type='button';dismiss.onclick=()=>{controller.abort();dialog.close();};
    const expand=el('button','button subtle ip-tool-fullscreen');expand.type='button';
    header.append(labels,actions);actions.append(expand,dismiss);
    const body=el('div','ip-tool-body'),surface=el('div','ip-tool-surface'),controller=new AbortController();surface.append(header,body);dialog.append(surface);
    const origin=cacheOrigin(spec),cacheOrigins=new Set(origin?[origin]:[]),cacheReady=waitToolCache(origin);
    // Abort synchronously on every close path: no detached frame can refill caches.
    controller.signal.addEventListener('abort',()=>{dialog.querySelectorAll('iframe').forEach(frame=>frame.remove());cacheOrigins.forEach(clearToolCache);},{once:true});
    // Native Escape cancellation precedes the asynchronously dispatched close event.
    dialog.addEventListener('cancel',()=>controller.abort());
    const expandedState=()=>{
      const full=dialog.dataset.expanded==='true';
      expand.title=t(full?'toolRestore':'toolFullscreen');expand.setAttribute('aria-label',expand.title);expand.setAttribute('aria-pressed',String(full));
      const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
      for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
      path.setAttribute('d',full?'M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5':'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5');svg.append(path);expand.replaceChildren(svg);
    };
    const viewport=()=>{const zoom=Number(getComputedStyle(document.body).zoom)||1;dialog.style.setProperty('--tool-width',innerWidth/zoom+'px');dialog.style.setProperty('--tool-height',innerHeight/zoom+'px');};
    expand.onclick=()=>{
      if(!dialog.open||controller.signal.aborted)return;
      if(dialog.dataset.expanded==='true')delete dialog.dataset.expanded;
      else dialog.dataset.expanded='true';
      viewport();expandedState();
    };
    addEventListener('resize',viewport);viewport();expandedState();
    if(spec.kind==='sites')renderSites(body,dialog,controller.signal);
    else if(spec.kind==='speed')cacheReady.then(()=>{if(dialog.open&&!controller.signal.aborted)ToolSpeed.render(body,dialog,controller.signal);});
    else if(spec.kind==='ping')cacheReady.then(()=>{if(dialog.open&&!controller.signal.aborted)renderGlobalPing(body,dialog,controller.signal,spec);});
    else{
      const loading=el('p','ip-tool-status',t('toolLoading')),frame=el('iframe','ip-tool-frame');
      frame.title=title.textContent+' · '+provider.textContent;frame.name='v2route-tool-'+new URL(spec.url).hostname;
      frame.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin allow-downloads');
      frame.referrerPolicy='no-referrer';frame.dataset.toolUrl=spec.url;
      const site=new URL(spec.url).hostname,frameOrigin=new URL(spec.url).origin;
      const needsAccess=site==='ping0.cc'&&!!chrome.scripting?.registerContentScripts;
      let accessReady=!needsAccess,requestedURL=spec.url,navigation=0;
      const navigate=async url=>{
        if(!url)return;requestedURL=url;const request=++navigation;if(!accessReady)return;
        const result=await cacheReady;
        if(!dialog.open||controller.signal.aborted||request!==navigation)return;
        if(result.status==='failed'||result.status==='unsupported'){
          cacheNote.hidden=false;cacheNote.textContent=t(result.status==='unsupported'?'toolCacheUnsupported':'toolCacheFailed');
        }
        loading.hidden=false;loading.textContent=t('toolLoading');frame.src=url;
      };
      const cacheNote=el('p','ip-tool-status ip-tool-cache-note');cacheNote.hidden=true;body.append(cacheNote);
      const reload=el('button','button subtle',t('toolReload'));reload.type='button';
      reload.onclick=()=>navigate(frame.dataset.toolUrl);actions.prepend(reload);
      if(spec.id==='fast'){
        const fallback=el('button','button subtle',t('toolFallback'));fallback.type='button';
        fallback.onclick=()=>{
          frame.remove();body.replaceChildren();body.classList.remove('ip-tool-frame-body');reload.remove();fallback.remove();
          title.textContent=t('toolSpeed');provider.textContent='Cloudflare';dialog.dataset.kind='speed';cacheOrigins.add('https://speed.cloudflare.com');waitToolCache('https://speed.cloudflare.com').then(()=>{if(dialog.open&&!controller.signal.aborted)ToolSpeed.render(body,dialog,controller.signal);});
        };
        actions.insertBefore(fallback,expand);
      }
      frame.addEventListener('load',()=>{loading.hidden=true;});
      frame.addEventListener('error',()=>{if(dialog.open){loading.hidden=false;loading.textContent=t('toolFrameError');}});
      body.classList.add('ip-tool-frame-body');body.append(loading,frame);
      let recoveryTimer=0,recoveryUsed=false,reportReady=false;
      const handshake=event=>{
        if(event.source!==frame.contentWindow||event.origin!==frameOrigin)return;
        if(event.data?.type==='v2route-tool-ready')frame.contentWindow.postMessage({type:'v2route-tool-adapt'},frameOrigin);
        if(event.data?.type==='v2route-tool-report-ready'){reportReady=true;clearTimeout(recoveryTimer);loading.hidden=true;}
        if(event.data?.type==='v2route-tool-session-written'&&!recoveryUsed&&site==='ping0.cc'){
          recoveryUsed=true;recoveryTimer=setTimeout(()=>{if(dialog.open&&!reportReady&&!controller.signal.aborted){navigate(spec.url);}},1500);
        }
      };
      dialog.addEventListener('close',()=>clearTimeout(recoveryTimer),{once:true});
      addEventListener('message',handshake);dialog.addEventListener('close',()=>removeEventListener('message',handshake),{once:true});
      if(needsAccess){
        const origin=frameOrigin+'/*',request={permissions:['scripting'],origins:[origin]};
        if(chrome.runtime.getManifest().browser_specific_settings?.gecko&&site==='ping0.cc')request.data_collection=['locationInfo'];
        const access=el('button','button subtle',t('toolAccess'));access.type='button';access.hidden=true;actions.insertBefore(access,expand);
        let records=[];
        const load=()=>{
          if(!dialog.open||controller.signal.aborted)return;
          access.disabled=true;
          chrome.permissions.request(request,async granted=>{
            if(!dialog.open||controller.signal.aborted)return;
            if(!granted||chrome.runtime.lastError){access.hidden=false;access.disabled=false;loading.textContent=t('toolPermission');accessReady=true;navigate(requestedURL);return;}
            try{
              const id='v2route-tool-'+crypto.randomUUID();
              const list=[{id,js:['v2route-ui/tool-frame.js'],matches:[origin],allFrames:true,runAt:'document_start',persistAcrossSessions:false}];
              if(site==='ping0.cc')list.push({id:id+'-session',js:['v2route-ui/tool-cookie-session.js'],matches:[origin],allFrames:true,runAt:'document_start',persistAcrossSessions:false,world:'MAIN'});
              await chrome.scripting.unregisterContentScripts({ids:list.map(item=>item.id)}).catch(()=>{});
              await chrome.scripting.registerContentScripts(list);records=list.map(item=>item.id);if(!dialog.open){await chrome.scripting.unregisterContentScripts({ids:records});return;}
            }catch{access.hidden=false;access.disabled=false;}
            if(dialog.open&&!controller.signal.aborted){accessReady=true;navigate(requestedURL);}
          });
        };
        access.onclick=load;dialog.addEventListener('close',()=>{if(records.length)chrome.scripting.unregisterContentScripts({ids:records}).catch(()=>{});},{once:true});
        queueMicrotask(load);
      }else queueMicrotask(()=>navigate(spec.url));
    }
    dialog.addEventListener('close',()=>{
      removeEventListener('resize',viewport);delete dialog.dataset.expanded;
      controller.abort();dialog.querySelector('iframe')?.remove();dialog.remove();
      if(activeDialog===dialog){activeDialog=null;activeController=null;}
      if(!activeDialog&&opener?.isConnected)opener.focus();
    },{once:true});
    document.body.append(dialog);activeDialog=dialog;activeController=controller;dialog.showModal();dismiss.focus();
  }

  addEventListener('pagehide',close);
  addEventListener('hashchange',close);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
  root.V2RTools=Object.freeze({TOOLS:tools,open:(id,options={})=>{const tool=tools.find(item=>item.id===id);if(tool)openUrl({...tool,...options});},openUrl,close});
})(globalThis);
