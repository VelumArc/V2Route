(async function(){
  'use strict';
  const t=k=>I18n.t(k),$=id=>document.getElementById(id),prefs=await V2R.prefsGet();I18n.set(prefs.language);document.documentElement.dataset.theme=prefs.theme||'light';
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  // Overlay scrollbars may be hidden by the OS. Supplement them without
  // intercepting native scrolling, pointer dragging or keyboard interaction.
  function updateScrollHint() {
    const list=$('popup-scenarios'),host=$('popup-profiles');
    if(!list||!host)return;
    const gutter=Math.max(0,list.offsetWidth-list.clientWidth),range=list.scrollHeight-list.clientHeight;
    list.style.setProperty('--scenario-gutter',gutter+'px');
    host.dataset.overlayScroll=String(gutter===0&&range>1);
    if(gutter||range<=1)return;
    const size=Math.max(22,list.clientHeight*list.clientHeight/list.scrollHeight);
    host.style.setProperty('--scroll-hint-top',list.getBoundingClientRect().top-host.getBoundingClientRect().top+'px');
    host.style.setProperty('--scroll-hint-height',list.clientHeight+'px');
    host.style.setProperty('--scroll-hint-thumb',size+'px');
    host.style.setProperty('--scroll-hint-offset',(list.clientHeight-size)*Math.min(1,Math.max(0,list.scrollTop/range))+'px');
  }
  function fitLabels() {
    updateScrollHint();
    for (const label of document.querySelectorAll('#popup-current, .popup-profile .grow, .popup-tool>span')) {
      label.style.removeProperty('font-size');
      if (!label.clientWidth) continue;
      const range = document.createRange();
      range.selectNodeContents(label);
      const available = label.clientWidth - 0.5;
      if (range.getBoundingClientRect().width <= available) continue;
      let lower = 0.25;
      let upper = parseFloat(getComputedStyle(label).fontSize);
      for (let step = 0; step < 10; step++) {
        const candidate = (lower + upper) / 2;
        label.style.fontSize = candidate + 'px';
        if (range.getBoundingClientRect().width <= available) lower = candidate;
        else upper = candidate;
      }
      label.style.fontSize = Math.floor(lower * 100) / 100 + 'px';
    }
  }
  $('popup-intro').textContent=t('popupIntro');$('popup-settings').title=t('openSettings');$('popup-settings').setAttribute('aria-label',t('openSettings'));$('popup-version').textContent='v'+chrome.runtime.getManifest().version;
  $('popup-selected-label').textContent=t('popupSelected');$('popup-footer-label').textContent=t('popupFooter');
  $('popup-settings').querySelector('span').textContent=t('proxySettings');$('popup-settings').onclick=()=>{chrome.runtime.openOptionsPage();};
  $('popup-ip-tools').querySelector('span').textContent=t('ip-tools');$('popup-ip-tools').onclick=()=>{chrome.tabs.create({url:chrome.runtime.getURL('v2route-ui/options.html#ip-tools')},()=>{if(chrome.runtime.lastError)error(chrome.runtime.lastError.message);else window.close();});};
  function error(message){$('popup-status').hidden=false;$('popup-status').textContent=message;}
  let switching=false,activeName='',lastStatus=null,syncSelection=null;
  const connection=$('popup-connection'),help=$('popup-connection-help');
  function showHealth(status){
    lastStatus=status;connection.dataset.health=status.status;
    const label=t('health'+({ok:'Ok',error:'Error',checking:'Checking',unknown:'Unknown'}[status.status]||'Unknown'));
    const heading=t('healthLabel')+' · '+label;
    help.textContent=heading;connection.setAttribute('aria-label',heading+(activeName?' · '+activeName:''));$('popup-current').removeAttribute('title');
    $('popup-health-announcement').textContent=label;
  }
  const health=V2RHealth.create({inspect:()=>V2R.rpc('v2routeConnectionState',[!!chrome.extension?.inIncognitoContext]),probe:signal=>V2RIP.runCheck({family:'dual',signal,timeoutMs:8000}),onChange:showHealth});
  showHealth(health.value);
  const check=force=>{if(!switching){if(navigator.onLine===false)health.invalidate('OFFLINE','error');else health.check({force});}};
  connection.addEventListener('mouseenter',()=>check(false));connection.addEventListener('focus',()=>check(false));
  connection.addEventListener('click',()=>check(true));connection.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();check(true);}});
  const offline=()=>health.invalidate('OFFLINE','error'),online=()=>check(true);
  window.addEventListener('offline',offline);window.addEventListener('online',online);
  const settingsChanged=()=>{health.invalidate('CHANGED');if(!switching)check(true);};
  const proxyError=()=>health.invalidate('PROXY_ERROR','error');
  const storageChanged=(changes,area)=>{if(area==='local'&&changes.v2routeModel&&!switching){health.invalidate('CHANGED');syncSelection?.();}};
  chrome.proxy?.settings?.onChange?.addListener(settingsChanged);chrome.proxy?.onProxyError?.addListener(proxyError);chrome.proxy?.onError?.addListener(proxyError);chrome.storage?.onChanged?.addListener(storageChanged);
  window.addEventListener('pagehide',()=>{health.stop();chrome.proxy?.settings?.onChange?.removeListener(settingsChanged);chrome.proxy?.onProxyError?.removeListener(proxyError);chrome.proxy?.onError?.removeListener(proxyError);chrome.storage?.onChanged?.removeListener(storageChanged);window.removeEventListener('offline',offline);window.removeEventListener('online',online);},{once:true});
  function showIcon(host,p,metadata){
    host.replaceChildren();const icon=V2R.profileIcon(p,metadata);
    if(icon){const image=el('img','route-icon');image.src=icon;image.alt='';image.onerror=()=>{image.onerror=null;image.src='icons/route.svg';};host.append(image);}
    else host.append(el('span','profile-symbol',p.name==='direct'?'↗':p.name==='system'?'◉':p.profileType==='SwitchProfile'?'⇄':'◆'));
  }
  try{const {options,state}=await V2R.read(),all=[{name:'direct',profileType:'DirectProfile'},{name:'system',profileType:'SystemProfile'},...PopupOrder.sorted(V2R.profiles(options),prefs.popupProfileOrder)],host=$('popup-profiles'),icons=new Map();let active=state.isSystemProfile?'system':state.currentProfileName,countries={};
    function updateSelection(name){
      active=name;const current=all.find(p=>p.name===active);
      $('popup-current').textContent=(active==='direct'?t('direct'):active==='system'?t('system'):active)||t('noProfile');$('popup-current').title=$('popup-current').textContent;
      activeName=$('popup-current').textContent;if(lastStatus)showHealth(lastStatus);
      if(current)showIcon($('popup-current-icon'),current,countries[active]);else $('popup-current-icon').replaceChildren();
      for(const row of host.querySelectorAll('.popup-profile')){const selected=row.dataset.profile===active;row.classList.toggle('active',selected);row.setAttribute('aria-pressed',String(selected));row.querySelector('.check')?.remove();if(selected){const check=el('span','check','✓');check.setAttribute('aria-hidden','true');row.append(check);}}
      fitLabels();
    }
    $('popup-current').textContent=(active==='direct'?t('direct'):active==='system'?t('system'):active)||t('noProfile');
    $('popup-current').title=$('popup-current').textContent;
    activeName=$('popup-current').textContent;showHealth(health.value);
    const current=all.find(p=>p.name===active);if(current)showIcon($('popup-current-icon'),current);
    if(state.proxyNotControllable)error(t('externalControl'));else if(state.zeroRouteError)error(state.zeroRouteError);
    for(const p of all){const selected=p.name===active,row=el('button','popup-profile'+(selected?' active':''));row.type='button';row.dataset.profile=p.name;row.dataset.orderKey=PopupOrder.key(p);if(p.name!=='direct'&&p.name!=='system')row.setAttribute('aria-description',t('popupOrderHelp'));row.setAttribute('aria-pressed',String(selected));
      const icon=el('span','popup-icon-slot');icon.setAttribute('aria-hidden','true');showIcon(icon,p);icons.set(p.name,icon);row.append(icon);
      const text=p.name==='direct'?t('direct'):p.name==='system'?t('system'):p.name;row.append(el('span','grow',text));row.title=text;if(selected){const check=el('span','check','✓');check.setAttribute('aria-hidden','true');row.append(check);}
      row.onclick=async()=>{if(row.disabled)return;switching=true;health.invalidate('SWITCHING','checking');for(const b of host.querySelectorAll('button'))b.disabled=true;row.setAttribute('aria-busy','true');$('popup-status').hidden=true;let applied=false;try{await V2R.rpc('applyProfile',[p.name]);const latest=await V2R.read();updateSelection(latest.state.isSystemProfile?'system':latest.state.currentProfileName);if(latest.state.proxyNotControllable){error(t('externalControl'));health.invalidate('OVERRIDDEN','error');}else if(latest.state.zeroRouteError){error(latest.state.zeroRouteError);health.invalidate('APPLY_FAILED','error');}else applied=true;}catch(e){error(e.message);health.invalidate('APPLY_FAILED','error');}finally{switching=false;row.removeAttribute('aria-busy');for(const b of host.querySelectorAll('button'))b.disabled=false;if(applied)check(true);}};
      (p.name==='direct'||p.name==='system'?$('popup-builtins'):$('popup-scenarios')).append(row);
    }
    const orderAnnouncement=el('span','health-sr-only');orderAnnouncement.setAttribute('role','status');orderAnnouncement.setAttribute('aria-live','polite');document.body.append(orderAnnouncement);
    PopupOrder.attach($('popup-scenarios'),{canStart:()=>!switching,save:async order=>{
      const latest=await V2R.prefsGet();await V2R.prefsSet({...latest,popupProfileOrder:order});prefs.popupProfileOrder=order;
    },onError:errorValue=>error(errorValue.message),onSaved:()=>{orderAnnouncement.textContent=t('popupOrderSaved');}});
    fitLabels();
    const textObserver = new ResizeObserver(fitLabels);
    textObserver.observe($('popup-scenarios'));
    $('popup-scenarios').addEventListener('scroll',updateScrollHint,{passive:true});
    for (const label of document.querySelectorAll('#popup-current, .popup-profile .grow, .popup-tool>span')) textObserver.observe(label);
    document.fonts.ready.then(fitLabels);
    window.addEventListener('pagehide', () => {textObserver.disconnect();$('popup-scenarios').removeEventListener('scroll',updateScrollHint);}, {once:true});
    const selectedScenario=$('popup-scenarios').querySelector('[aria-pressed=true]');
    if(selectedScenario)selectedScenario.scrollIntoView({block:'nearest',inline:'nearest'});
    syncSelection=async()=>{try{const latest=await V2R.read();if(switching)return;all.splice(2,all.length-2,...V2R.profiles(latest.options));updateSelection(latest.state.isSystemProfile?'system':latest.state.currentProfileName);check(true);}catch(_){health.invalidate('BACKGROUND','error');}};
    if(state.proxyNotControllable)health.invalidate('OVERRIDDEN','error');else if(state.zeroRouteError)health.invalidate('APPLY_FAILED','error');else check(true);
    // Cached display metadata only: never start the companion, scan nodes, or
    // hold up profile switching just to render a flag.
    if(all.some(p=>p._zeroRouteChoice?.startsWith('node:'))){
      V2R.rpc('v2routeCachedProfileCountries').then(result=>{countries=result||{};
        for(const p of all){const metadata=countries?.[p.name];if(!metadata||metadata.choice!==p._zeroRouteChoice)continue;showIcon(icons.get(p.name),p,metadata);if(p.name===active)showIcon($('popup-current-icon'),p,metadata);}
        fitLabels();
      }).catch(()=>{});
    }
  }catch(e){error(e.message);health.invalidate('BACKGROUND','error');}
})();
