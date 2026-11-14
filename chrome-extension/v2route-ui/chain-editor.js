/* Explicit entry-to-exit path editor. Draft-only until the existing Save action. */
(function(root){
  'use strict';
  function mount({host,modeHost,previewHost=host,getLocalPort=()=>null,landing,legacy,initial,draft,getCatalog,getRoute,getLegacyChain,getLegacyPredecessor,setLegacyPredecessor,capable,onChange,refreshCatalog,onOrder,rpc,hiddenValues=[]}){
    const t=k=>I18n.t(k),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
    let custom=Array.isArray(initial),view=draft?.view||(custom?'custom':getLegacyPredecessor()==='none'?'simple':'predecessor'),seeded=draft?.seeded??custom,predecessor=draft?.predecessor??getLegacyPredecessor(),items=(draft?.items||initial||[]).map(value=>({id:crypto.randomUUID(),value})),pickers=[],generation=0,testing=false,stopping=false,destroyed=false;
    const shell=el('section','chain-editor'),bar=el('div','chain-toolbar'),title=el('h3','',t('chainTitle')),base=el('button','button subtle chain-mode-base',t('chainBase')),pre=el('button','button subtle chain-mode-pre',t('predecessor')),multi=el('button','button subtle chain-mode-multi',t('chainTitle')),add=el('button','button subtle',t('chainAdd')),test=el('button','button subtle',t('chainTest')),stop=el('button','button subtle',t('netStop')),status=el('p','chain-test-status'),list=el('div','chain-hops');
    base.type=pre.type=multi.type=add.type=test.type=stop.type='button';stop.hidden=true;status.setAttribute('role','status');
    add.classList.add('chain-add');test.classList.add('chain-test');stop.classList.add('chain-stop');
    const modes=el('div','chain-mode-actions'),tools=el('div','chain-tools');modes.setAttribute('aria-label',t('chainMode'));modes.append(base,pre,multi);tools.append(add);modeHost.append(modes);bar.append(title,tools);shell.append(bar,list,legacy.element);host.insertBefore(shell,landing);
    const preview=el('section','editor-panel proxy-path-preview'),previewHeader=el('header','editor-panel-header'),previewList=el('ol','proxy-path-list'),previewFooter=el('footer','proxy-path-footer'),previewActions=el('div','proxy-path-actions'),previewResults=new Map(),previewByIndex=new Map();
    previewHeader.append(el('h3','',t('chain')));previewActions.append(test,stop);previewFooter.append(previewActions,status);preview.append(previewHeader,previewList,previewFooter);previewHost.append(preview);
    const exitTitle=landing.querySelector('.editor-panel-header'),exitHeading=landing.querySelector('.editor-panel-title h3'),badge=el('span','chain-exit-role',t('chainExitBadge')),exitStatus=el('span','chain-hop-state');const pin=document.createElementNS('http://www.w3.org/2000/svg','svg');pin.setAttribute('viewBox','0 0 24 24');pin.setAttribute('aria-hidden','true');pin.setAttribute('fill','none');pin.setAttribute('stroke','currentColor');pin.setAttribute('stroke-width','1.8');pin.setAttribute('stroke-linecap','round');pin.setAttribute('stroke-linejoin','round');
    const pinPath=document.createElementNS(pin.namespaceURI,'path');pinPath.setAttribute('d','M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z');pin.append(pinPath);badge.prepend(pin);exitTitle?.append(badge);landing.append(exitStatus);landing.classList.add('chain-exit-card','proxy-row');
    function layerIcon(entry){
      const icon=el('span','panel-icon chain-layer-icon'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');
      for(const [key,value]of Object.entries({viewBox:'0 0 24 24',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);
      const paths=entry?['M10 3h10v18H10','M3 12h12','m11 8 4 4-4 4']:['M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0M22 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0','M6 12h12','m14 8 4 4-4 4'];
      for(const d of paths){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}icon.append(svg);return icon;
    }
    function localIcon(){
      const icon=el('span','panel-icon proxy-local-icon'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');
      for(const [key,value]of Object.entries({viewBox:'0 0 24 24',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM12 17v4M8 21h8');svg.append(path);icon.append(svg);return icon;
    }
    const names=()=>new Map(getCatalog().routes.map(r=>[r.value,r]));
    const choices=()=>custom?items.map(x=>x.value):getLegacyChain();
    const valid=()=>capable()&&getRoute()!=='follow'&&Array.isArray(choices())&&choices().every(value=>/^node:[A-Za-z0-9_-]{1,128}$/.test(value));
    function clearStates(){
      previewResults.clear();landing.removeAttribute('data-chain-state');exitStatus.textContent='';legacy.element.removeAttribute('data-chain-state');
      for(const card of list.children){card.removeAttribute('data-chain-state');const state=card.querySelector('.chain-hop-state');if(state)state.textContent=t('chainUntested');}
      for(const row of previewByIndex.values()){row.dataset.chainState='unknown';row.querySelector('.proxy-path-state').textContent=custom?t('chainUntested'):'';}
    }
    function drawPreview(){
      previewList.replaceChildren();previewByIndex.clear();preview.dataset.mode=view;previewActions.hidden=!custom;
      const available=names(),path=choices(),route=getRoute(),exitRole=t(view==='custom'?'chainEgress':view==='predecessor'?'chainExit':'chainBase');
      function append(kind,value,role,label,index){
        const row=el('li','proxy-path-item'),copy=el('div','proxy-path-copy'),state=el('span','proxy-path-state');row.dataset.pathKind=kind;row.dataset.routeValue=value;
        const icon=kind==='local'?localIcon():kind==='hop'?layerIcon(index===0):landing.querySelector('.panel-icon')?.cloneNode(true)||el('span','panel-icon');icon.classList.add('proxy-path-icon');icon.setAttribute('aria-hidden','true');
        const nodeName=el('span','proxy-path-name'),node=available.get(value);
        if((kind==='hop'||kind==='exit')&&value.startsWith('node:')&&node){const flag=el('img','proxy-path-flag');flag.src=V2R.routeIcon(node);flag.alt='';nodeName.append(flag);}
        nodeName.append(el('span','proxy-path-node-label',label));copy.append(el('span','proxy-path-role',role),nodeName);row.append(icon,copy,state);previewList.append(row);
        if(Number.isInteger(index)){
          row.dataset.probeIndex=String(index);row.dataset.chainState='unknown';state.textContent=custom?t('chainUntested'):'';previewByIndex.set(index,row);
          if(value&&!available.has(value)){row.dataset.chainState='error';state.textContent=t('chainMissing');}
          const result=previewResults.get(index);if(result){row.dataset.chainState=result.state;state.textContent=result.text;}
        }
        return row;
      }
      const port=Number(getLocalPort());append('local','',t('localPort'),Number.isInteger(port)&&port>0&&port<=65535?String(port):'—');
      if(Array.isArray(path))path.forEach((value,index)=>append('hop',value,t(index===0?'chainEntry':'chainTransit')+(index<2?'':' '+index),available.has(value)?V2R.routeLabel(available.get(value)):t(value?'routeMissing':'chainChooseNode'),index));
      if(route==='follow'){
        previewList.append(el('li','proxy-path-unresolved',t('followChainHelp')));append('follow',route,exitRole,t('follow'));
      }else if(!Array.isArray(path)){
        previewList.append(el('li','proxy-path-unresolved',t('chainUnresolved')));
        if(available.has(route))append('exit',route,exitRole,V2R.routeLabel(available.get(route)));
      }else append('exit',route,exitRole,available.has(route)?V2R.routeLabel(available.get(route)):t('routeMissing'),path.length);
    }
    function invalidate(){generation++;stopping=true;clearStates();status.textContent='';if(!testing)stopping=false;}
    function publish(){invalidate();onChange(custom?items.map(x=>x.value):undefined);}
    function catalog(){return {...getCatalog(),routes:getCatalog().routes.filter(r=>r.value.startsWith('node:')).map(r=>({...r,supported:r.chain_supported??r.override_supported??r.supported,reason:r.chain_supported?'':r.reason}))};}
    function paint(index,state,text){
      previewResults.set(index,{state,text});const row=previewByIndex.get(index);if(row){row.dataset.chainState=state;row.querySelector('.proxy-path-state').textContent=text;}
      const target=index===choices()?.length?landing:custom?list.children[index]:legacy.element;
      if(target){target.dataset.chainState=state;const label=target===landing?exitStatus:target.querySelector('.chain-hop-state');if(label)label.textContent=text;}
    }
    function draw(){
      pickers.forEach(p=>p.destroy());pickers=[];list.replaceChildren();legacy.element.hidden=view!=='predecessor';list.hidden=!custom;tools.hidden=!custom;title.hidden=!custom;bar.hidden=!custom;shell.dataset.mode=view;landing.dataset.routeView=view;badge.hidden=view==='simple';exitStatus.hidden=!custom;exitHeading.textContent=t(view==='custom'?'chainEgress':view==='predecessor'?'chainExit':'chainBase');
      base.setAttribute('aria-pressed',String(view==='simple'));pre.setAttribute('aria-pressed',String(view==='predecessor'));multi.setAttribute('aria-pressed',String(custom));
      add.disabled=!capable()||testing;test.disabled=!valid()||testing;base.disabled=testing;pre.disabled=testing;multi.disabled=!capable()||testing;
      if(!capable())status.textContent=t('chainUpgrade');
      const available=names();
      if(custom){
        items.forEach((item,index)=>{
          const card=el('section','editor-panel chain-hop proxy-row'),head=el('div','editor-panel-header chain-hop-header'),icon=layerIcon(index===0),role=el('h3','',t(index===0?'chainEntry':'chainTransit')+(index<2?'':' '+index)),state=el('span','chain-hop-state'),remove=el('button','chain-remove','×'),body=el('div','editor-panel-body'),pickerHost=el('div');
          remove.type='button';remove.title=t('remove');remove.setAttribute('aria-label',t('remove')+' '+(index+1));head.append(icon,role);body.append(pickerHost);card.append(head,body,state,remove);list.append(card);
          if(item.value&&!available.has(item.value)){card.dataset.chainState='error';state.textContent=t('chainMissing');}
          else state.textContent=t('chainUntested');
          remove.onclick=()=>{items=items.filter(x=>x.id!==item.id);publish();draw();};
          const picker=new RoutePicker(pickerHost,{catalog:catalog(),hiddenValues,value:item.value||'unselected',placeholder:t('chainChooseNode'),onChange:r=>{item.value=r.value;publish();draw();},onRefresh:async()=>{await refreshCatalog();return{catalog:catalog()};},onOrder:async(order,revision)=>{await onOrder(order,revision);return{catalog:catalog()};},onError:e=>{status.textContent=e.message;}});pickers.push(picker);
        });
      }
      if(custom&&!exitStatus.textContent)exitStatus.textContent=t('chainUntested');
      if(custom&&getRoute()==='follow'){status.textContent=t('chainSelectExit');exitStatus.textContent=t('chainSelectExitShort');}
      if(!available.has(getRoute())&&getRoute()!=='follow'){landing.dataset.chainState='error';exitStatus.textContent=t('chainMissing');}
      if(!custom&&getRoute()!=='follow'&&!Array.isArray(choices())){legacy.element.dataset.chainState='error';}
      else if(!custom&&choices()?.some(value=>!available.has(value))){legacy.element.dataset.chainState='error';}
      shell.hidden=view==='simple';drawPreview();
    }
    function useCustom(){
      if(!capable())return;
      if(!custom){if(view==='predecessor')predecessor=getLegacyPredecessor();if(!seeded){items=(choices()||[]).map(value=>({id:crypto.randomUUID(),value}));while(items.length<2)items.push({id:crypto.randomUUID(),value:''});seeded=true;}custom=true;}view='custom';
    }
    function useSimple(){if(view==='predecessor')predecessor=getLegacyPredecessor();custom=false;view='simple';setLegacyPredecessor('none');}
    base.onclick=()=>{if(testing||view==='simple')return;useSimple();publish();draw();};
    pre.onclick=()=>{if(testing)return;if(view==='predecessor')useSimple();else{custom=false;view='predecessor';setLegacyPredecessor(predecessor);}publish();draw();};
    multi.onclick=()=>{if(testing)return;if(custom)useSimple();else useCustom();publish();draw();};
    add.onclick=()=>{useCustom();if(!custom)return;items.push({id:crypto.randomUUID(),value:''});publish();draw();list.lastElementChild?.querySelector('button.route-trigger')?.focus();};
    async function diagnose(){
      if(testing||!valid())return;
      testing=true;stopping=false;const token=++generation,path=choices().slice(),exit=getRoute();let pendingIndex=-1;clearStates();draw();stop.hidden=false;stop.disabled=false;
      try{
        for(let index=0;index<=path.length;index++){
          if(stopping||destroyed||token!==generation)return;
          pendingIndex=index;paint(index,'checking',t('ipChecking'));status.textContent=(index+1)+' / '+(path.length+1)+' · '+t('chainTest');
          let result;
          try{result=await rpc('v2routeChainProbe',[{route:exit,chain:path,index,...(custom?{}:{predecessor:getLegacyPredecessor()})}]);}catch{result={ok:false,code:'PATH_FAILED'};}
          if(stopping||destroyed||token!==generation)return;
          if(result.code==='BUSY'){paint(index,'unknown',t('chainBusy'));status.textContent=t('chainBusy');return;}
          paint(index,result.ok?'ok':'error',result.ok?t('chainOK')+' · '+result.durationMs+' ms':t('chainFailed'));
          if(!result.ok){for(let following=index+1;following<=path.length;following++)paint(following,'blocked',t('chainBlocked'));status.textContent=t('chainFailureHelp');return;}
        }
        status.textContent=t('chainAllOK');
      }finally{testing=false;if(!destroyed){stop.hidden=true;base.disabled=false;pre.disabled=false;multi.disabled=!capable();add.disabled=!capable();test.disabled=!valid();if(stopping&&token===generation){if(pendingIndex>=0)paint(pendingIndex,'unknown',t('netStopped'));status.textContent=t('netStopped');}}stopping=false;}
    }
    test.onclick=diagnose;stop.onclick=()=>{stopping=true;stop.disabled=true;status.textContent=t('chainStopping');};
    const hidden=()=>{if(document.hidden)stopping=true;};document.addEventListener('visibilitychange',hidden);
    draw();
    return{capture(){return{view,seeded,predecessor:view==='predecessor'?getLegacyPredecessor():predecessor,items:items.map(x=>x.value)};},refresh(){if(destroyed)return;invalidate();draw();},diagnose,destroy(){destroyed=true;stopping=true;generation++;pickers.forEach(p=>p.destroy());document.removeEventListener('visibilitychange',hidden);modes.remove();preview.remove();previewByIndex.clear();previewResults.clear();badge.remove();exitStatus.remove();}};
  }
  root.V2RChainEditor=Object.freeze({mount});
})(globalThis);
