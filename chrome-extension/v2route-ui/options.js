/* Local configuration UI. Node credentials remain in the companion. */
(function () {
  'use strict';
  const {rpc,read,clone,profiles,routeIcon,routeLabel}=V2R, t=k=>I18n.t(k), $=id=>document.getElementById(id);
  let data={options:{},state:{}}, native=null, nativeError='', prefs={}, page='profiles', selected=null, picker=null, modalPicker=null, busy=false, catalogAttempted=false,activeEditor=null,creating=null,activeLibrary=null;
  let preferencePending=false,preferenceQueue=Promise.resolve();
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(text,action,cls='button')=>{const b=el('button',cls,text);b.type='button';b.onclick=action;return b;};
  function field(label,control,help){const wrap=el(/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)?'label':'div','field');wrap.append(el('span','field-label',label),control);if(help)wrap.append(el('small','muted',help));return wrap;}
  function input(value='',type='text'){const n=el('input');n.type=type;n.value=value;n.autocomplete='off';return n;}
  function select(items,value){const n=el('select');for(const [v,label]of items){const o=el('option','',label);o.value=v;n.append(o);}n.value=value;return n;}
  function area(value='',rows=4){const n=el('textarea');n.value=value;n.rows=rows;n.spellcheck=false;return n;}
  function card(title,subtitle){const n=el('section','card');if(title)n.append(el('h2','',title));if(subtitle)n.append(el('p','muted',subtitle));return n;}
  function uiIcon(kind){
    const paths={copy:['M8 8h12v13H8V8Z','M16 8V3H3v13h5'],program:['M3 4h18v16H3V4Z','M3 9h18M7 6.5h.2M10 6.5h.2M8 13l-2 2 2 2M12 17h5'],route:['M6 5h8a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h9','M8 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0','M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],nodes:['m12 3 10 5-10 5L2 8l10-5Z','m3 12 9 5 9-5M3 16l9 5 9-5'],settings:['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z','m9.5 3 .5-1h4l.5 3 2 .9 2.8-1 2 3.4-2.2 2.1v2.3l2.2 2.1-2 3.4-2.8-1-2 .9-.5 3h-4l-.5-3-2-.9-2.8 1-2-3.4L4.4 13v-2.3L2.2 8.6l2-3.4 2.8 1 2-.9.5-2.3Z'],info:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z','M12 11v6M12 7v.2'],core:['m12 2 9 5v10l-9 5-9-5V7l9-5Z','m3 7 9 5 9-5M12 12v10'],backup:['M12 16V3m-4 4 4-4 4 4','M4 12v8h16v-8'],refresh:['M20 7v5h-5','M4 17v-5h5','M6 7a7 7 0 0 1 11-2l3 7M4 12l3 7a7 7 0 0 0 11-2'],add:['M12 5v14M5 12h14'],create:['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','M12 8v8M8 12h8'],hide:['m3 3 18 18','M10 10a3 3 0 0 0 4 4','M9 5a11 11 0 0 1 13 7 14 14 0 0 1-4 5M6 6a14 14 0 0 0-4 6 11 11 0 0 0 12 7'],show:['M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z','M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],folder:['M3 6h6l2 2h10v12H3V6Z'],save:['M5 3h12l4 4v14H3V3h2Z','M7 3v6h10V3M7 21v-8h10v8'],profiles:['M3 3h7v7H3V3ZM14 3h7v7h-7V3ZM3 14h7v7H3v-7ZM14 14h7v7h-7v-7Z'],'ip-tools':['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z','M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z']};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('ui-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');for(const d of paths[kind]||paths.info){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}return svg;
  }
  function panelHeading(title,kind,subtitle){const head=el('div','editor-panel-header'),name=el('div','editor-panel-title'),icon=el('span','panel-icon');icon.append(uiIcon(kind));name.append(icon,el('h3','',title));head.append(name);if(subtitle)head.append(el('p','panel-intro',subtitle));return head;}
  function iconButton(label,action,kind,cls='button subtle'){const b=button(label,action,cls);b.prepend(uiIcon(kind));return b;}
  function pathField(label,control,kind){
    let pending=false;
    const row=el('div','path-input-row'),feedback=el('small','path-copy-feedback'),copy=iconButton('',async()=>{
      if(copy.disabled||pending)return;const copiedValue=control.value;pending=true;copy.disabled=true;feedback.hidden=true;
      try{await navigator.clipboard.writeText(copiedValue);if(!row.isConnected)return;feedback.textContent=t('ipCopied');feedback.classList.remove('error');}
      catch(_){if(!row.isConnected)return;feedback.textContent=t('ipCopyFailed');feedback.classList.add('error');}
      finally{pending=false;if(row.isConnected){copy.disabled=!control.value;feedback.hidden=control.value!==copiedValue;}}
    },'copy','path-copy-button');
    control.setAttribute('aria-label',label);copy.setAttribute('aria-label',t('copyPath')+': '+label);copy.title=t('pathCopyHint');copy.disabled=!control.value;feedback.hidden=true;feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');row.append(uiIcon(kind),control,copy);
    control.addEventListener('input',()=>{copy.disabled=pending||!control.value;feedback.hidden=true;});const wrap=field(label,row);wrap.classList.add('path-field');wrap.append(feedback);return wrap;
  }
  let reportTimer=null;
  function report(message,kind='success'){
    clearTimeout(reportTimer);reportTimer=null;
    const status=$('status');status.hidden=!message;status.textContent=message;status.className='notice '+kind;
    if(message&&kind==='success')reportTimer=setTimeout(()=>{status.hidden=true;reportTimer=null;},1000);
  }
  async function perform(action,onError){if(busy)return;busy=true;document.body.classList.add('busy');try{await action();}catch(error){report(error.message,'error');onError?.(error);}finally{busy=false;document.body.classList.remove('busy');}}
  function current(){return data.state.isSystemProfile?'system':data.state.currentProfileName;}
  function profileType(p){return p._zeroRouteSlot&&!p._v2routeManual?t('managed'):({FixedProfile:t('manual'),SwitchProfile:t('auto'),PacProfile:t('pac'),DirectProfile:t('direct'),SystemProfile:t('system'),VirtualProfile:t('virtual')})[p.profileType]||p.profileType;}
  function iconFor(p){const src=V2R.profileIcon(p);if(src){const image=el('img','route-icon');image.src=src;image.alt='';return image;}const n=el('span','profile-symbol',p.profileType==='SwitchProfile'?'⇄':p.profileType==='PacProfile'?'{}':'↗');n.style.setProperty('--profile-color',/^#[a-f\d]{3,6}$/i.test(p.color||'')?p.color:'#368cbd');return n;}
  async function loadCatalog(name){catalogAttempted=true;try{const result=await rpc('zeroRouteGetState',name?[name]:[]);if(!result?.catalog?.routes||!result.catalog.settings)throw new Error(t('nativeMissing'));native=result;nativeError='';return result;}catch(error){nativeError=error.message;native=null;return null;}}
  async function reload(){if(page==='ip-tools'){render();return;}await loadCatalog();data=await read();render();}
  async function rescanLocal(){const result=await rpc('v2routeRescan');native=result;data=await read();render();const discovery=result.catalog?.discovery||result.discovery;if(discovery?.ok===false){const paths=(discovery.candidates||[]).map(c=>c.path).filter(Boolean);report([discovery.error||t('nativeMissing'),...paths].join(' · '),'error');}else report(t('rescanDone'));}
  function applyTheme(){I18n.set(prefs.language);document.documentElement.dataset.theme=prefs.theme||'light';document.querySelectorAll('[data-i18n]').forEach(n=>n.textContent=t(n.dataset.i18n));renderPreferences();}
  function renderPreferences(){
    const host=$('header-preferences');if(!host)return;
    // Keep the same buttons mounted so keyboard focus survives translation.
    if(!$('quick-language')){
      host.replaceChildren();
      for(const key of ['language','theme']){
        const control=button('',()=>togglePreference(key),'preference-toggle');
        control.id='quick-'+key;host.append(control);
      }
    }
    const chinese=I18n.language==='zh',dark=prefs.theme==='dark';
    const language=$('quick-language'),theme=$('quick-theme');
    const glyph=el('span','preference-language-glyph',chinese?'ZH':'EN');
    glyph.setAttribute('aria-hidden','true');language.replaceChildren(glyph);
    language.dataset.state=chinese?'zh':'en';
    language.title=t(chinese?'switchToEnglish':'switchToChinese');
    language.setAttribute('aria-label',t('language')+': '+(chinese?'简体中文':'English')+'. '+language.title);
    theme.replaceChildren(appearanceIcon(dark));theme.dataset.state=dark?'dark':'light';
    theme.title=t(dark?'switchToLight':'switchToDark');
    theme.setAttribute('aria-label',t('theme')+': '+t(dark?'dark':'light')+'. '+theme.title);
    for(const control of [language,theme])control.setAttribute('aria-disabled',String(preferencePending));
    host.setAttribute('aria-busy',String(preferencePending));
  }
  function appearanceIcon(dark){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
    svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');
    svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    const paths=dark?['M20.4 14.1A8.5 8.5 0 0 1 9.9 3.6a8.5 8.5 0 1 0 10.5 10.5Z','M17 3.5v3M15.5 5h3']:['M16.3 12a4.3 4.3 0 1 1-8.6 0 4.3 4.3 0 0 1 8.6 0Z','M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42'];
    for(const d of paths){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}
    return svg;
  }
  async function togglePreference(key){
    if(preferencePending||busy)return;
    const value=key==='language'?(I18n.language==='zh'?'en':'zh'):(prefs.theme==='dark'?'light':'dark');
    preferencePending=true;renderPreferences();
    try{
      await savePreferences(()=>({[key]:value}));
      const draft=key==='language'?activeEditor?.capture():null;
      if(key==='language'){render(page==='nodes');if(draft)activeEditor?.restore(draft);}
      else applyTheme();
    }catch(error){report(error.message,'error');}
    finally{preferencePending=false;renderPreferences();}
  }
  function savePreferences(patch){
    const work=preferenceQueue.then(async()=>{const next={...prefs,...patch(prefs)};await V2R.prefsSet(next);prefs=next;return next;});
    preferenceQueue=work.catch(()=>{});return work;
  }
  function explicitPreferences(value){
    // Legacy automatic choices resolve once; the next click stores explicit states.
    const language=['en','zh'].includes(value.language)?value.language:(/^zh/i.test(navigator.language)?'zh':'en');
    const theme=value.theme==='dark'||(value.theme==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
    return {...value,language,theme};
  }
  function render(keepLibrary=false){const retained=keepLibrary&&page==='nodes'&&activeLibrary;if(!retained){activeLibrary?.destroy();activeLibrary=null;}V2RIPPanel.stop(page!=='ip-tools');picker?.destroy();picker=null;activeEditor?.destroy?.();activeEditor=null;applyTheme();renderNav();document.body.dataset.page=page;$('page-title').textContent=t(page);const pageIcon=el('span','page-title-icon');pageIcon.append(uiIcon(page));$('page-title').prepend(pageIcon);$('page-intro').textContent=t(page==='profiles'?'profileIntro':page==='nodes'?'nodesIntro':page==='ip-tools'?'ipIntro':'settingsIntro');$('page-intro').title=$('page-intro').textContent;$('header-actions').replaceChildren();
    const banner=$('native-banner');banner.hidden=!!native||page==='ip-tools';if(!native&&page!=='ip-tools'){banner.className='native-banner';banner.replaceChildren(el('strong','',t('nativeMissing')),el('p','',t('nativeHelp')),el('small','',nativeError),button(t('retry'),()=>perform(reload),'button subtle'));}
    if(retained){activeLibrary.translate();return;}
    $('content').replaceChildren();if(page==='profiles')renderProfiles();else if(page==='nodes')renderNodes();else if(page==='ip-tools')V2RIPPanel.render($('content'));else renderSettings();
    if(data.state.proxyNotControllable)report(t('externalControl'),'error');
  }
  function renderNav(){const nav=$('navigation');nav.replaceChildren();for(const id of ['profiles','nodes','ip-tools','settings']){const b=button('',()=>{if(busy)return;location.hash=id;},'nav-item'+(page===id?' active':''));const icon=el('span','nav-symbol');icon.append(uiIcon(id));icon.setAttribute('aria-hidden','true');const content=el('span','nav-content');content.append(icon,el('span','nav-label',t(id)));b.append(content);b.setAttribute('aria-current',page===id?'page':'false');nav.append(b);}}
  function renderProfiles(){
    $('header-actions').append(button('+ '+t('newProfile'),()=>showCreate(),'button primary'));
    const layout=el('div','profiles-layout'),list=el('section','profile-list'),editor=el('div','profile-editor');layout.append(list,editor);$('content').append(layout);
    const search=input();search.type='search';search.placeholder=t('searchProfiles');search.setAttribute('aria-label',t('searchProfiles'));list.append(search);const rows=el('div','profile-items');list.append(rows);
    const all=profiles(data.options);if(!selected||!all.some(p=>p.name===selected))selected=all[0]?.name||null;
    function draw(){rows.replaceChildren();for(const p of all.filter(p=>p.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))){const b=button('',()=>{if(busy)return;creating=null;selected=p.name;draw();drawEditor(editor,p);},'profile-item'+(p.name===selected?' selected':''));b.append(iconFor(p));const text=el('span','grow');text.append(el('strong','',p.name),el('small','muted',profileType(p)));b.append(text);if(current()===p.name)b.append(el('span','active-label',t('active')));rows.append(b);}}
    search.oninput=draw;draw();if(creating){const pending=creating.snapshot;drawEditor(editor,creating.profile,true);if(pending)activeEditor?.restore(pending);}else if(selected)drawEditor(editor,all.find(p=>p.name===selected));else{const empty=card(t('noSelection'));empty.append(button('+ '+t('newProfile'),()=>showCreate(),'button primary'));editor.append(empty);}
  }
  async function activate(name){await perform(async()=>{report(t('switching'),'');await rpc('applyProfile',[name]);data=await read();render();report(t('applied'));});}
  function predecessorControl(host,initial,onChange,context={}){
    let value=initial||'inherit',nodeValue=value.startsWith('node:')?value:'',prePicker=null;
    // The header mode buttons own visibility; predecessor fields stay expanded.
    function refresh(){panel.hidden=false;}
    const section=el('section','editor-panel predecessor-section proxy-row'),head=panelHeading(t('predecessor'),'route');head.title=t('preIntro');
    const panel=el('div','predecessor-panel');const mode=select([['inherit',t('preInherit')],['none',t('preNone')],['node',t('preSpecific')]],value.startsWith('node:')?'node':value),nodeHost=el('div'),nodeField=field(t('preNode'),nodeHost),help=el('p','panel-info',t('preHelp'));help.prepend(uiIcon('info'));nodeField.classList.add('predecessor-node-field');const modeField=el('div','field predecessor-mode-field');mode.setAttribute('aria-label',t('preMode'));modeField.append(mode);panel.append(modeField,nodeField,help);section.append(head,panel);host.append(section);
    function preCatalog(){return {...native.catalog,routes:native.catalog.routes.filter(r=>r.value!=='follow'&&r.value!=='manual')};}
    function update(){prePicker?.destroy();prePicker=null;nodeField.hidden=mode.value!=='node';if(mode.value==='node'&&native){prePicker=new RoutePicker(nodeHost,{catalog:preCatalog(),hiddenValues:prefs.hiddenRouteValues,value:nodeValue||'unselected',onChange:r=>{nodeValue=r.value;value=nodeValue;onChange(value);},onRefresh:async()=>{native=await rpc('zeroRouteGetState');context.onCatalogChange?.();return{catalog:preCatalog()};},onOrder:async(order,revision)=>{native=await rpc('zeroRouteReorder',[{revision,groups:order}]);context.onCatalogChange?.();return{catalog:preCatalog()};},onError:e=>report(e.message,'error')});}}
    mode.onchange=()=>{value=mode.value==='node'?nodeValue:mode.value;update();onChange(value);};update();refresh();
    return{element:section,value:()=>value,refresh,destroy:()=>prePicker?.destroy(),set:next=>{value=next||'inherit';nodeValue=value.startsWith('node:')?value:'';mode.value=nodeValue?'node':value;update();refresh();}};
  }
  function drawEditor(container,p,isNew=false){
    picker?.destroy();picker=null;activeEditor?.destroy?.();activeEditor=null;container.replaceChildren();
    const initialType=isNew?'node':p.profileType==='SwitchProfile'?'auto':p.profileType==='PacProfile'?'pac':p._zeroRouteSlot&&!p._v2routeManual?'node':'manual';
    const manual=p._v2routeManual;
    let type=initialType,saving=false,preControl=null,chainControl=null,chainDraft=null,baseline='',saveButton=null,controls={},drafts={
      node:{route:p._zeroRouteChoice||'follow',predecessor:p._zeroRoutePredecessor||(isNew?'none':'inherit'),chain:p._zeroRouteChain===undefined?undefined:clone(p._zeroRouteChain),bypass:(p.bypassList||[]).map(x=>typeof x==='string'?x:x.pattern||'').join('\n')},
      manual:{scheme:manual?.scheme||(p._zeroRouteSlot?'socks5':p.fallbackProxy?.scheme||'socks5'),host:manual?.host||(p._zeroRouteSlot?'127.0.0.1':p.fallbackProxy?.host||'127.0.0.1'),port:String(manual?.port||(p._zeroRouteSlot?'10808':p.fallbackProxy?.port||'10808')),username:manual?.username||'',password:manual?.password||'',bypass:(p.bypassList||[]).map(x=>typeof x==='string'?x:x.pattern||'').join('\n')},
      auto:{defaultProfile:p.defaultProfileName||'direct',rules:(p.rules||[]).map(r=>({pattern:r.condition?.pattern||'',type:r.condition?.conditionType||'HostWildcardCondition',target:r.profileName}))},
      pac:{pacScript:p.pacScript||'function FindProxyForURL(url, host) { return "DIRECT"; }'}
    };
    const heading=el('div','editor-heading'),title=el('div','profile-heading-name'),name=input(p.name),typeSelect=select([['node',t('managed')],['manual',t('manual')],['auto',t('auto')],['pac',t('pac')]],type);
    const nameTitle=el('h2'),nameLabel=el('label','profile-name-label',t('name')),renameButton=button(t('rename'),()=>beginNameEdit(),'rename-link');let editingName=isNew,nameBeforeEdit=name.value;
    name.className='profile-name-input';name.id='profile-name-input';nameLabel.htmlFor=name.id;name.setAttribute('aria-label',t('name'));name.placeholder=t('name');name.maxLength=128;name.spellcheck=false;
    function drawName(){heading.classList.toggle('editing-name',editingName);name.hidden=!editingName;nameTitle.hidden=editingName;nameTitle.textContent=name.value.trim()||t('name');nameTitle.title=name.value.trim();renameButton.hidden=isNew;renameButton.setAttribute('aria-pressed',String(editingName));}
    function beginNameEdit(){if(!editingName)nameBeforeEdit=name.value;editingName=true;drawName();name.focus();name.select();}
    function finishNameEdit(){editingName=isNew;drawName();}
    name.addEventListener('blur',finishNameEdit);
    name.addEventListener('keydown',event=>{
      if(event.isComposing||event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();name.value=nameBeforeEdit;finishNameEdit();sync();if(!isNew)renameButton.focus();}
      else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(saveButton&&!saveButton.disabled)saveButton.click();else{finishNameEdit();if(!isNew)renameButton.focus();}}
    });
    const nameRow=el('div','profile-name-row'),nameCaption=el('div','profile-name-caption');nameCaption.append(nameLabel);
    nameRow.append(nameTitle,name,renameButton);title.append(nameCaption,nameRow);drawName();
    function localPort(){
      const proxy=p.fallbackProxy,port=Number(proxy?.port);
      return !isNew&&p._zeroRouteSlot&&['127.0.0.1','localhost','::1'].includes(proxy?.host)&&Number.isInteger(port)&&port>0&&port<=65535?port:null;
    }
    const typeField=field(t('type'),typeSelect);typeField.classList.add('heading-mode');heading.append(title,typeField,isNew?button(t('cancel'),()=>{creating=null;render();},'button subtle'):button(current()===p.name?t('active'):t('apply'),()=>activate(p.name),'button '+(current()===p.name?'subtle':'primary')));container.append(heading);
    V2RProfileTypeSelect.mount(typeSelect,{label:t('type')});
    const modeHost=el('div','profile-chain-actions');
    const panel=card(),body=el('div','editor-fields'),actions=el('div','editor-actions'),saveError=el('p','inline-error profile-save-error');saveError.setAttribute('role','alert');saveError.hidden=true;panel.append(body,saveError,actions);container.append(panel);
    function capture(){if(chainControl)chainDraft=chainControl.capture();const d=drafts[type];for(const [key,control]of Object.entries(controls))if(control&&typeof control.value==='string')d[key]=control.value;return d;}
    function snapshot(){const d=clone(capture());if(d.bypass!==undefined)d.bypass=d.bypass.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(d.host)d.host=d.host.trim();if(d.rules)d.rules=d.rules.map(r=>({...r,pattern:r.pattern.trim()}));return JSON.stringify({type,name:name.value.trim(),draft:d},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value);}
    function draftState(){capture();return{profile:p.name,name:name.value,editingName,nameBeforeEdit,type,drafts:clone(drafts),chainDraft:clone(chainDraft),advancedOpen:!!body.querySelector('details')?.open};}
    function sync(){if(!saveButton)return;const dirty=snapshot()!==baseline;if(isNew&&creating)creating.snapshot=draftState();saveButton.disabled=saving||(!isNew&&!dirty)||(type==='node'&&Array.isArray(drafts.node.chain)&&(drafts.node.route==='follow'||drafts.node.chain.some(value=>!/^node:[A-Za-z0-9_-]{1,128}$/.test(value))));saveButton.textContent=t(saving?'saving':isNew?'create':dirty?'save':'saved');saveButton.setAttribute('aria-busy',String(saving));if(dirty&&$('status').textContent===t('saved'))report('');}
    function drawFields(){modeHost.hidden=type!=='node'||!native;const deletion=actions.querySelector('.danger-text');if(deletion)actions[type==='node'?'prepend':'append'](deletion);
      picker?.destroy();picker=null;chainControl?.destroy();chainControl=null;preControl?.destroy();preControl=null;body.replaceChildren();controls={};const d=drafts[type];let fieldsHost=body;
      if(type==='node'){
        const workspace=el('div','proxy-workspace'),toolbar=el('div','proxy-workspace-toolbar'),configuration=el('div','proxy-config-column'),preview=el('aside','proxy-path-column'),workspaceHeading=el('div','proxy-workspace-heading');workspaceHeading.append(el('h3','',t('proxyConfiguration')),el('p','',t('proxyConfigurationHelp')));toolbar.append(workspaceHeading,modeHost);workspace.append(toolbar,configuration,preview);body.append(workspace);fieldsHost=configuration;preview.hidden=!native;workspace.classList.toggle('without-companion',!native);
        const routeField=el('section','editor-panel route-choice-field proxy-row'),line=el('div','route-choice-line editor-panel-body'),routeHost=el('div','proxy-row-selector');routeField.append(panelHeading(t('chainBase'),'route'),line);line.append(routeHost);configuration.append(routeField);
        const metadata=el('p','route-source'),chain=el('p','chain'),routeMeta=el('div','route-selection-meta');routeMeta.append(metadata,chain);line.append(routeMeta);
        function targetCatalog(){return{...native.catalog,routes:native.catalog.routes.map(r=>(d.chain!==undefined?r.chain_supported:(r.override_supported&&d.predecessor&&d.predecessor!=='inherit'))?{...r,supported:true,reason:''}:r)};}
        function describe(){const route=native?.catalog.routes.find(r=>r.value===d.route);metadata.textContent=route?t('source')+': '+t(route.source==='local'?'imported':'v2rayn'):'';if(Array.isArray(d.chain)){const names=[...d.chain,d.route].map(value=>{const item=native?.catalog.routes.find(r=>r.value===value);return item?routeLabel(item):t(value?'routeMissing':'chainChooseNode');});chain.textContent=t('chain')+': '+names.join(' → ');return;}if(route?.value==='follow'){chain.textContent=d.predecessor?.startsWith('node:')?t('preFollowInvalid'):t('followChainHelp');return;}if(route?.supported===false&&d.predecessor==='inherit'){chain.textContent=route.reason||t('preNeedsFix');return;}let names=route?.chain?.length?route.chain.slice():route?[routeLabel(route)]:[];if(d.predecessor==='none')names=route?[routeLabel(route)]:[];else if(d.predecessor?.startsWith('node:')){const before=native?.catalog.routes.find(r=>r.value===d.predecessor);names=[...(before?.chain?.length?before.chain:before?[routeLabel(before)]:[t('routeMissing')]),...(route?[routeLabel(route)]:[])];}chain.textContent=names.length?t('chain')+': '+names.join(' → '):'';}
        function catalogChanged(){if(!routeField.isConnected)return;chainControl?.refresh();picker?.update(targetCatalog(),d.route);describe();}
        function legacyChain(){
          const route=native.catalog.routes.find(r=>r.value===d.route);
          if(!route||d.route==='follow')return null;
          const override=route.supported!==false||route.override_supported===true;
          if(d.predecessor==='none')return override?[]:null;
          const specific=d.predecessor?.startsWith('node:'),before=specific?native.catalog.routes.find(r=>r.value===d.predecessor):route;
          if(!before||before.supported===false||!Array.isArray(before.chain_values)||!before.chain_values.length)return null;
          const path=specific?[...before.chain_values,d.route]:before.chain_values.slice();
          // Match the legacy builder's cycle/depth rules; explicit chains remain unrestricted.
          if((specific&&!override)||path.at(-1)!==d.route||path.length>6||new Set(path).size!==path.length)return null;
          return path.slice(0,-1);
        }
        if(native){picker=new RoutePicker(routeHost,{allowPredecessorOverride:true,catalog:targetCatalog(),hiddenValues:prefs.hiddenRouteValues,value:d.route,onChange:r=>{d.route=r.value;preControl?.refresh();chainControl?.refresh();describe();sync();},onRefresh:async()=>{native=await rpc('zeroRouteGetState',[p.name]);catalogChanged();return{...native,catalog:targetCatalog()};},onOrder:async(order,revision)=>{native=await rpc('zeroRouteReorder',[{revision,groups:order}]);catalogChanged();return{...native,catalog:targetCatalog()};},onError:e=>report(e.message,'error')});preControl=predecessorControl(configuration,d.predecessor,v=>{d.predecessor=v;chainControl?.refresh();picker?.update(targetCatalog(),d.route);describe();sync();},{onCatalogChange:catalogChanged});
          chainControl=V2RChainEditor.mount({host:configuration,modeHost,previewHost:preview,getLocalPort:localPort,landing:routeField,legacy:preControl,initial:d.chain,draft:chainDraft,getCatalog:()=>native.catalog,getRoute:()=>d.route,
            getLegacyChain:legacyChain,getLegacyPredecessor:()=>d.predecessor,setLegacyPredecessor:value=>{d.predecessor=value;preControl.set(value);},
            capable:()=>!!native.capabilities?.explicitChains,hiddenValues:prefs.hiddenRouteValues,
            onChange:value=>{d.chain=value;picker?.update(targetCatalog(),d.route);describe();sync();},
            refreshCatalog:async()=>{native=await rpc('zeroRouteGetState',[p.name]);catalogChanged();return native.catalog;},
            onOrder:async(order,revision)=>{native=await rpc('zeroRouteReorder',[{revision,groups:order}]);catalogChanged();return native.catalog;},rpc});
        }
        else routeHost.append(el('p','notice error',t('noNativeRoute')));describe();
      }else if(type==='manual'){
        controls.scheme=select([['socks5','SOCKS5'],['http','HTTP'],['https','HTTPS'],['socks4','SOCKS4']],d.scheme);controls.host=input(d.host);controls.port=input(d.port,'number');controls.port.min=1;controls.port.max=65535;const grid=el('div','proxy-grid'),dnsHelp=el('p','muted',t('proxyDns'));dnsHelp.hidden=d.scheme!=='socks5';controls.scheme.addEventListener('change',()=>{dnsHelp.hidden=controls.scheme.value!=='socks5';});grid.append(field(t('scheme'),controls.scheme),field(t('address'),controls.host),field(t('port'),controls.port));body.append(grid,dnsHelp);
        controls.username=input(d.username);controls.password=input(d.password,'password');controls.username.autocomplete='off';controls.password.autocomplete='new-password';const auth=el('div','proxy-auth-grid');auth.append(field(t('proxyUsername'),controls.username),field(t('proxyPassword'),controls.password));body.append(auth,el('p','muted',t('proxyAuthHelp')));
      }else if(type==='auto'){
        controls.defaultProfile=select(profileChoices(p.name),d.defaultProfile);body.append(field(t('defaultRoute'),controls.defaultProfile),el('p','muted',t('ruleHelp')),el('p','muted auto-system-help',t('autoSystemHelp')));const list=el('div','rules-list');
        function drawRules(){list.replaceChildren();d.rules.forEach((r,i)=>{const row=el('div','rule-row'),pattern=input(r.pattern),target=select(profileChoices(p.name),r.target);pattern.placeholder='*.example.com';pattern.setAttribute('aria-label',t('pattern'));target.setAttribute('aria-label',t('target'));pattern.oninput=()=>r.pattern=pattern.value;target.onchange=()=>r.target=target.value;const remove=button('×',()=>{d.rules.splice(i,1);drawRules();sync();},'icon-button');remove.setAttribute('aria-label',t('remove'));row.append(pattern,target,remove);list.append(row);});}
        drawRules();body.append(list,button('+ '+t('addRule'),()=>{d.rules.push({pattern:'',type:'HostWildcardCondition',target:'direct'});drawRules();sync();},'button subtle'));
      }else{controls.pacScript=area(d.pacScript,10);controls.pacScript.className='code-input';body.append(field(t('pacScript'),controls.pacScript,t('pacHelp')));}
      if(type==='node'||type==='manual'){const advanced=el('details','advanced editor-panel'),summary=el('summary','editor-panel-header',t('advanced')),inside=el('div','advanced-body');advanced.append(summary,inside);controls.bypass=area(d.bypass);controls.bypass.placeholder="example.com\n*.example.org\n192.168.*";controls.bypass.spellcheck=false;inside.append(field(t('bypass'),controls.bypass,t('bypassHelp')));fieldsHost.append(advanced);}
    }
    typeSelect.onchange=()=>{capture();type=typeSelect.value;drawFields();sync();};drawFields();
    saveButton=button(t('saved'),async()=>{
      if(saveButton.disabled||busy)return;saving=true;saveError.hidden=true;saveError.textContent='';sync();heading.inert=true;body.inert=true;
      await perform(async()=>{
        const wanted=name.value.trim();if(!wanted)throw new Error(t('fieldRequired'));const all=await rpc('getAll'),latest=isNew?p:all['+'+p.name];if(!isNew&&(!latest||latest.revision!==p.revision))throw new Error(t('updatedElsewhere'));if((isNew||wanted!==p.name)&&all['+'+wanted])throw new Error(t('profileExists'));
        const d=capture(),next={name:isNew?wanted:p.name,color:latest.color,profileType:type==='auto'?'SwitchProfile':type==='pac'?'PacProfile':'FixedProfile',revision:latest.revision};let routing;
        if(type==='node'||type==='manual'){next.proxyDNS=true;next.bypassList=d.bypass.split(/\r?\n/).map(v=>v.trim()).filter(Boolean).map(pattern=>({conditionType:'BypassCondition',pattern}));if(type==='node'){if(!native)throw new Error(t('noNativeRoute'));if(!d.predecessor)throw new Error(t('preSelectRequired'));routing={route:d.route,predecessor:d.chain===undefined?d.predecessor:'none',...(d.chain===undefined?{}:{chain:d.chain})};}else{const port=Number(d.port);if(!Number.isInteger(port)||port<1||port>65535)throw new Error(t('invalidPort'));if(d.scheme==='socks4'&&(d.username||d.password))throw new Error(t('proxyAuthSocks4'));next.fallbackProxy={scheme:d.scheme,host:d.host.trim(),port};routing={route:'manual',auth:{username:d.username,password:d.password}};}}
        else if(type==='auto'){if(d.rules.some(r=>!r.pattern.trim()||!r.target))throw new Error(t('rulesError'));next.defaultProfileName=d.defaultProfile;next.rules=d.rules.map(r=>({condition:{conditionType:r.type,pattern:r.pattern.trim()},profileName:r.target}));}
        else{next.pacUrl='';next.pacScript=d.pacScript;}
        const saved=await rpc('v2routeSaveProfile',[next,isNew?null:next.revision,routing||null,wanted]);if(saved?.revision)p.revision=saved.revision;if(saved?.name)p.name=saved.name;
        selected=isNew?wanted:p.name;if(isNew)creating=null;await reload();report(t('saved'));
      },error=>{saveError.textContent=error.message;saveError.hidden=false;saveError.scrollIntoView({block:'nearest'});});saving=false;heading.inert=false;body.inert=false;if(panel.isConnected)sync();
    },'button primary');actions.append(saveButton);if(!isNew)actions[type==='node'?'prepend':'append'](button(t('delete'),()=>{
      const active=current()===p.name;
      confirm(t('deleteProfile'),t(active?'deleteActiveHelp':'deleteProfileHelp'),async()=>{
        await rpc('v2routeDeleteProfile',[p.name,p.revision,active?{switchTo:'system'}:null]);
        selected=null;await reload();
      },active?t('deleteActive'):t('delete'));
    },'button danger-text'));
    baseline=snapshot();for(const region of [heading,body]){region.addEventListener('input',sync);region.addEventListener('change',sync);}sync();
    activeEditor={capture:draftState,restore:s=>{if(s.profile!==p.name)return;drafts=clone(s.drafts);chainDraft=clone(s.chainDraft||null);name.value=s.name;editingName=isNew||!!s.editingName;nameBeforeEdit=s.nameBeforeEdit??s.name;drawName();type=s.type;typeSelect.value=type;drawFields();const advanced=body.querySelector('details');if(advanced)advanced.open=s.advancedOpen;sync();},destroy:()=>{chainControl?.destroy();preControl?.destroy();}};
  }
  function profileChoices(exclude){return [['direct',t('direct')],['system',t('system')],...profiles(data.options).filter(p=>p.name!==exclude&&['FixedProfile','SwitchProfile'].includes(p.profileType)).map(p=>[p.name,p.name])];}
  function showCreate(route='follow'){
    if(busy)return;
    creating={profile:{name:'',profileType:'FixedProfile',color:'#269eab',_zeroRouteChoice:route},snapshot:null};page='profiles';if(location.hash!=='#profiles')history.pushState(null,'','#profiles');render();document.querySelector('.profile-name-input')?.focus();
  }
  function renderNodes(){
    activeLibrary=V2RNodeLibrary.mount($('content'),{catalog:native?.catalog,actions:$('header-actions'),getPrefs:()=>prefs,savePrefs:savePreferences,onCreate:showCreate,onRescan:()=>perform(rescanLocal),onCatalog:catalog=>{if(native)native={...native,catalog};}});
  }
  function renderSettings(){
    const grid=el('div','settings-grid'),mainColumn=el('div','settings-column settings-main'),secondaryColumn=el('div','settings-column settings-secondary');grid.append(mainColumn,secondaryColumn);$('content').append(grid);
    if(!native){const setup=card(t('setupTitle'),t('setupIntro'));setup.classList.add('setup-card');const steps=el('ol','setup-steps');for(const text of [t('setupStepOne'),t('setupStepTwo'),t('setupStepThree')])steps.append(el('li','',text));setup.append(steps);const links=el('div','setup-actions'),download=el('a','button subtle',t('downloadCompanion'));download.href='https://github.com/VelumArc/V2Route/blob/main/INSTALL.md';download.target='_blank';download.rel='noopener noreferrer';links.append(button(t('setupCheck'),()=>perform(reload),'button primary'),download);setup.append(links,el('p','muted',t('setupDownloadNote')));mainColumn.append(setup);}
    const host=card(t('localComponent'),t('pathsHelp')),status=el('div','component-status');status.append(el('span','local-dot'+(native?'':' offline')),el('strong','',native?(native.status?.running?t('ready'):t('connectedIdle')):t('stopped')));host.classList.add('companion-settings');host.querySelector('h2').append(status);
    if(native){const discoveryActions=el('div','setup-actions');discoveryActions.append(button(t('chooseFolder'),async()=>{const selected=await V2RFolderPicker.open({path:rootPath.value.trim(),rpc});if(selected!==null)rootPath.value=selected;},'button subtle'),button(t('rescanLocal'),()=>perform(rescanLocal),'button subtle'));host.append(discoveryActions);}
    const pathSettings=native?.hostSettings||native?.catalog?.hostSettings||{},rootPath=input(pathSettings.v2raynRoot||''),corePath=input(pathSettings.corePath||'');rootPath.placeholder=corePath.placeholder=t('optionalPath');host.append(pathField(t('rootPath'),rootPath,'folder'),pathField(t('corePath'),corePath,'program'),button(t('savePaths'),()=>perform(async()=>{await rpc('v2routeHostSettings',[{v2raynRoot:rootPath.value.trim(),corePath:corePath.value.trim()}]);await reload();report(t('saved'));}),'button primary'));mainColumn.append(host);
    if(globalThis.V2RCorePanel)secondaryColumn.append(V2RCorePanel.create());
    const backups=card(t('backup'),t('backupHelp'));const backupActions=el('div','backup-actions'),file=input('','file');file.accept='application/json,.json';file.hidden=true;file.onchange=()=>perform(async()=>{const selected=file.files[0];if(!selected)return;if(selected.size>5*1024*1024)throw new Error(t('backupTooLarge'));await rpc('v2routeImportProfiles',[JSON.parse(await selected.text())]);file.value='';await reload();report(t('saved'));});backupActions.append(button(t('export'),()=>perform(async()=>{const payload=await rpc('v2routeExport');const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='V2Route-profiles-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);report(t('backupDone'));}),'button subtle'),button(t('import'),()=>file.click(),'button subtle'));backups.append(backupActions,file);mainColumn.append(backups);
    const about=card(t('about'),t('aboutText'));about.append(el('p','version',t('version')+' '+chrome.runtime.getManifest().version),el('p','muted',t('privacyText')));const privacy=el('a','text-link',t('privacyDetails'));privacy.href='notices.html#privacy';privacy.target='_blank';const notices=el('a','text-link',t('licenses'));notices.href='notices.html';notices.target='_blank';const aboutLinks=el('div','about-links');aboutLinks.append(privacy,notices);about.append(aboutLinks);secondaryColumn.append(about);
    for(const b of host.querySelectorAll('.button')){const kind=b.textContent===t('chooseFolder')?'folder':b.textContent===t('rescanLocal')?'refresh':'save';b.prepend(uiIcon(kind));}
    for(const b of backups.querySelectorAll('.button')){const icon=uiIcon('backup');if(b.textContent===t('import'))icon.classList.add('import-icon');b.prepend(icon);}
    const coreCheck=secondaryColumn.querySelector('.core-panel .setup-actions .button');if(coreCheck)coreCheck.prepend(uiIcon('refresh'));
  }
  function showModal(content){modalPicker?.destroy();modalPicker=null;$('modal-content').replaceChildren(content);const title=content.querySelector('h2');if(title){title.id='v2route-dialog-title';$('modal').setAttribute('aria-labelledby',title.id);}if(!$('modal').open)$('modal').showModal();}
  $('modal').addEventListener('close',()=>{modalPicker?.destroy();modalPicker=null;});
  function confirm(title,text,action,actionLabel=t('delete')){const content=el('div','modal-body');content.append(el('h2','',title),el('p','muted',text));const err=el('p','inline-error');err.setAttribute('role','alert');content.append(err);const actions=el('div','modal-actions'),ok=button(actionLabel,async()=>{if(ok.disabled)return;ok.disabled=true;try{await action();$('modal').close();report(t('saved'));}catch(error){err.textContent=error.message;}finally{ok.disabled=false;}},'button danger');actions.append(button(t('cancel'),()=>$('modal').close(),'button subtle'),ok);content.append(actions);showModal(content);}
  window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);page=['profiles','nodes','ip-tools','settings'].includes(next)?next:'profiles';report('');if(page!=='ip-tools'&&!catalogAttempted){V2RIPPanel.stop(true);perform(reload);}else render();});
  window.addEventListener('unhandledrejection',event=>{report(event.reason?.message||String(event.reason),'error');});
  async function init(){prefs=explicitPreferences(await V2R.prefsGet());applyTheme();const hash=location.hash.slice(1);page=['profiles','nodes','ip-tools','settings'].includes(hash)?hash:'profiles';report(t('loading'),'');await reload();report('');}
  init().catch(error=>{render();report(error.message,'error');});
})();
