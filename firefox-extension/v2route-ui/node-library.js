/* Node library: local catalog, explicit subscriptions and isolated measurements. */
(function (root) {
  'use strict';
  const t=key=>I18n.t(key), el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(text,fn,cls='button')=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
  const input=(value='',type='text')=>{const n=el('input');n.type=type;n.value=value;n.autocomplete='off';return n;};
  const select=(items,value)=>{const n=el('select');for(const [v,label] of items){const o=el('option','',label);o.value=v;n.append(o);}n.value=value;return n;};
  const field=(label,n)=>{const wrap=el('label','nl-field');wrap.append(el('span','field-label',label),n);return wrap;};
  const local=r=>r.source==='local'||r.source==='imported'||r.imported===true||String(r.value).startsWith('node:local');
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  const terminal=s=>['complete','completed','done','cancelled','canceled','stopped','error','failed'].includes(s);
  const stateKey=s=>({queued:'nlQueued',pending:'nlQueued',running:'nlRunning',starting:'nlRunning',stopping:'nlStopping',cancelling:'nlStopping',complete:'nlComplete',completed:'nlComplete',done:'nlComplete',ok:'nlComplete',success:'nlComplete',failed:'nlFailed',error:'nlFailed',cancelled:'nlStopped',canceled:'nlStopped',stopped:'nlStopped',partial:'nlPartial'})[s]||'nlUntested';
  const errorText=error=>{const code=typeof error==='string'?error:error?.code||error?.errorCode;return code&&/^[a-z\d_-]{1,64}$/i.test(code)?t('nlOperationFailed')+' ('+code+')':t('nlOperationFailed');};
  function mount(host,context) {
    let alive=true,lib={revision:0,groups:[],subscriptions:[]},catalog=context.catalog||{routes:[]},available=false,mutation=false,loadSerial=0;
    let currentGroup='all',grouping=context.getPrefs().nodeGrouping==='country'?'country':'source',source='all',query='',showHidden=false,sort='name',direction=1,tablePage=0;
    let chosen=new Set(),results=new Map(),mode='quick',traffic=10,concurrency=2,job=null,starting=false,stopping=false,generation=0,pollTimer=null,stateTimer=null,transport=null;
    let view={},dialog=null,dialogGeneration=0,noticeText='',noticeKind='';
    const workspace=el('div','node-workspace');host.append(workspace);
    const routes=()=> (catalog.routes||[]).filter(r=>String(r.value).startsWith('node:'));
    const hidden=r=>!local(r)&&(context.getPrefs().hiddenRouteValues||[]).includes(r.value);
    const eligible=r=>r.supported!==false&&!hidden(r);
    const running=()=>starting||stopping||!!job&&(!terminal(job.state)||job.hasMore);
    const activeName=()=>groupList().find(g=>g.id===currentGroup)?.name||t('nlAllNodes');
    function country(r){const code=String(r.country||'').toUpperCase();if(!/^[A-Z]{2}$/.test(code))return{id:'unknown',name:t('unknownCountry')};let name=code;try{name=new Intl.DisplayNames([I18n.language==='zh'?'zh-CN':'en'],{type:'region'}).of(code)||code;}catch(_){}return{id:code,name};}
    function groupId(r){return grouping==='country'?'country:'+country(r).id:'group:'+String(r.group_id||'ungrouped');}
    function groupList(){
      const groups=new Map();
      if(grouping==='source')for(const g of [...(catalog.groups||[]),...(lib.groups||[])])groups.set('group:'+g.id,{...g,id:'group:'+g.id,rawId:g.id,name:g.id==='local-imports'?t('imported'):g.name,count:0});
      for(const r of routes()){
        const id=groupId(r);if(!groups.has(id))groups.set(id,{id,rawId:r.group_id,name:grouping==='country'?country(r).name:r.group_id==='local-imports'?t('imported'):r.group||t('ungrouped'),source:local(r)?'local':'v2rayn',readonly:!local(r),count:0});
        if((showHidden||!hidden(r))&&(source==='all'||(source==='local')===local(r)))groups.get(id).count++;
      }
      const order=catalog.settings?.group_order||[];
      const list=[...groups.values()].filter(g=>source==='all'||grouping==='country'||(source==='local')===(g.source==='local'));
      list.sort((a,b)=>grouping==='country'?a.name.localeCompare(b.name,I18n.language):(order.indexOf(a.rawId)<0?10000:order.indexOf(a.rawId))-(order.indexOf(b.rawId)<0?10000:order.indexOf(b.rawId))||a.name.localeCompare(b.name,I18n.language));
      return [{id:'all',name:t('nlAllNodes'),count:list.reduce((sum,g)=>sum+g.count,0),readonly:true},...list];
    }
    function visibleRoutes(){
      const text=query.trim().toLocaleLowerCase();return routes().filter(r=>(showHidden||!hidden(r))&&(source==='all'||(source==='local')===local(r))&&(currentGroup==='all'||groupId(r)===currentGroup)&&(!text||(V2R.routeLabel(r)+' '+(r.group||'')+' '+country(r).name+' '+(r.protocol||'')).toLocaleLowerCase().includes(text)));
    }
    function sortedRows(){return visibleRoutes().slice().sort((a,b)=>{
      if(sort==='name')return direction*V2R.routeLabel(a).localeCompare(V2R.routeLabel(b),I18n.language)||a.value.localeCompare(b.value);
      const key={latency:'latencyMs',download:'downloadAverageMbps',upload:'uploadAverageMbps'}[sort],x=results.get(a.value)?.[key],y=results.get(b.value)?.[key];
      if(!finite(x)||!finite(y))return finite(x)?-1:finite(y)?1:a.value.localeCompare(b.value);
      return direction*(x-y)||a.value.localeCompare(b.value);
    });}
    function notice(text,kind='error'){noticeText=text;noticeKind=kind;if(view.notice){view.notice.textContent=text;view.notice.className='nl-notice '+kind;view.notice.hidden=!text;}}
    function ingest(state){
      if(!state||typeof state!=='object')throw new Error('invalid-state');
      lib={...lib,...state};if(state.catalog?.routes){catalog=state.catalog;context.onCatalog?.(catalog);}
      const known=new Set(routes().map(r=>r.value));chosen=new Set([...chosen].filter(id=>known.has(id)));for(const id of results.keys())if(!known.has(id))results.delete(id);
      available=true;
    }
    async function loadState(silent=false){
      const serial=++loadSerial;try{const state=await V2R.rpc('v2routeLibraryState');if(!alive||serial!==loadSerial)return;ingest(state);if(!silent)notice('');drawGroups();drawRows();drawSubscriptions();updateControls();}
      catch(_){if(alive&&serial===loadSerial&&!silent)notice(t('nlUpgrade'));}
      finally{if(alive&&serial===loadSerial){clearTimeout(stateTimer);stateTimer=setTimeout(()=>{if(!document.hidden&&!mutation)loadState(true);else scheduleState();},10000);}}
    }
    function scheduleState(){clearTimeout(stateTimer);if(alive)stateTimer=setTimeout(()=>loadState(true),10000);}
    async function mutate(method,value){
      if(mutation||!alive)return null;mutation=true;loadSerial++;clearTimeout(stateTimer);updateControls();
      try{const state=await V2R.rpc(method,[value]);if(!alive)return null;ingest(state);drawGroups();drawRows();drawSubscriptions();notice('');return state;}
      finally{mutation=false;if(alive){drawRows();drawSubscriptions();updateControls();scheduleState();}}
    }
    function panel(title,cls){const p=el('section','nl-panel '+cls),head=el('header','nl-panel-header');head.append(el('h2','',title));p.append(head);return p;}
    function build(){
      workspace.replaceChildren();context.actions.replaceChildren();
      const rescan=button(t('rescanLocal'),()=>{if(!running())context.onRescan();});rescan.dataset.nlMutation='';
      const importButton=button(t('importNodes'),()=>showImport(),'button primary');importButton.dataset.nlAvailable='';context.actions.append(rescan,importButton);
      const groups=panel(t('grouping'),'nl-groups'),middle=panel(t('nlNodeResults'),'nl-results'),center=panel(t('nlTestCenter'),'nl-center');workspace.append(groups,middle,center);
      const filters=el('div','nl-group-filters'),sourceControl=select([['all',t('allSources')],['v2rayn',t('v2rayn')],['local',t('imported')]],source),groupControl=select([['source',t('nlGroupBySource')],['country',t('groupByCountry')]],grouping);
      sourceControl.setAttribute('aria-label',t('source'));groupControl.setAttribute('aria-label',t('grouping'));
      sourceControl.onchange=()=>{source=sourceControl.value;tablePage=0;drawGroups();drawRows();updateControls();};groupControl.onchange=()=>{grouping=groupControl.value;currentGroup='all';drawGroups();drawRows();context.savePrefs(p=>({nodeGrouping:grouping})).catch(()=>notice(t('nlOperationFailed')));};filters.append(sourceControl,groupControl);groups.append(filters);
      const groupListHost=el('div','nl-group-list');groupListHost.setAttribute('role','tablist');groupListHost.setAttribute('aria-orientation','vertical');groupListHost.setAttribute('aria-label',t('grouping'));groups.append(groupListHost);
      const groupActions=el('div','nl-group-actions'),newGroup=button('+ '+t('nlNewGroup'),()=>editGroup());newGroup.dataset.nlAvailable='';groupActions.append(newGroup);groups.append(groupActions);
      const tools=el('div','nl-table-tools'),search=input(query,'search');search.placeholder=t('searchRoutes');search.setAttribute('aria-label',t('searchRoutes'));search.oninput=()=>{query=search.value;tablePage=0;drawRows();updateControls();};
      const hiddenLabel=el('label','nl-checkbox'),hiddenControl=input('','checkbox');hiddenControl.checked=showHidden;hiddenControl.onchange=()=>{showHidden=hiddenControl.checked;drawGroups();drawRows();updateControls();};hiddenLabel.append(hiddenControl,el('span','',t('showHidden')));tools.append(search,hiddenLabel);middle.append(tools);
      const noticeHost=el('p','nl-notice');noticeHost.setAttribute('role','status');middle.append(noticeHost);
      const tableWrap=el('div','nl-table-scroll');tableWrap.tabIndex=0;tableWrap.setAttribute('role','region');tableWrap.setAttribute('aria-label',t('nlNodeResults'));
      const table=el('table','nl-table'),head=el('thead'),heading=el('tr'),all=el('th'),allCheck=input('','checkbox');allCheck.setAttribute('aria-label',t('nlSelectVisible'));allCheck.onchange=()=>{for(const r of sortedRows().slice(tablePage*50,tablePage*50+50).filter(eligible))allCheck.checked?chosen.add(r.value):chosen.delete(r.value);drawRows();updateControls();};all.append(allCheck);heading.append(all);
      for(const [key,label]of [['name','nlNode'],['latency','speedLatency'],['download','speedDownload'],['upload','speedUpload']]){const th=el('th');th.scope='col';th.dataset.sort=key;const b=button(t(label),()=>{if(sort===key)direction=-direction;else{sort=key;direction=key==='name'||key==='latency'?1:-1;}drawRows();},'nl-sort');b.title=t('nlSort');th.append(b);heading.append(th);}
      for(const label of ['nlStatus','nlActions']){const th=el('th','',t(label));th.scope='col';heading.append(th);}head.append(heading);const body=el('tbody');table.append(head,body);tableWrap.append(table);middle.append(tableWrap);
      const footer=el('div','nl-table-footer'),count=el('span','muted'),clear=button(t('nlClearSelection'),()=>{chosen.clear();drawRows();updateControls();},'button subtle');const pages=el('div','nl-pages'),previous=button('‹',()=>{tablePage--;drawRows();},'button subtle'),next=button('›',()=>{tablePage++;drawRows();},'button subtle'),range=el('span','muted');previous.setAttribute('aria-label',t('nlPreviousPage'));next.setAttribute('aria-label',t('nlNextPage'));pages.append(previous,range,next);footer.append(count,pages,clear);middle.append(footer);
      const testForm=el('div','nl-test-form'),modeControl=select([['quick',t('nlQuick')],['full',t('nlFull')]],mode),trafficControl=select([10,25,50,100].map(n=>[String(n),n+' MiB']),String(traffic)),concurrencyControl=select([1,2,3].map(n=>[String(n),String(n)]),String(concurrency));
      modeControl.dataset.nlMode='';modeControl.onchange=()=>{mode=modeControl.value;updateControls();};trafficControl.onchange=()=>{traffic=Number(trafficControl.value);updateControls();};concurrencyControl.onchange=()=>concurrency=Number(concurrencyControl.value);
      const trafficField=field(t('nlTraffic'),trafficControl),concurrencyField=field(t('nlConcurrency'),concurrencyControl);testForm.append(field(t('nlTestMode'),modeControl),trafficField,concurrencyField);
      const budget=el('p','nl-budget muted'),chainHint=el('p','muted nl-chain-hint',t('nlChainPolicy'));testForm.append(budget,chainHint);
      const actions=el('div','nl-test-actions'),selectedButton=button(t('nlTestSelected'),()=>start([...chosen]),'button primary'),groupButton=button(t('nlTestVisible'),()=>start(visibleRoutes().filter(eligible).map(r=>r.value))),stop=button(t('nlStop'),stopTest,'button danger-text');selectedButton.dataset.nlStart='';groupButton.dataset.nlStart='';stop.dataset.nlStop='';actions.append(selectedButton,groupButton,stop);testForm.append(actions);center.append(testForm);
      const progress=el('progress','nl-progress');progress.max=1;progress.value=0;progress.setAttribute('aria-label',t('nlProgress'));const summary=el('p','nl-job-summary');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');center.append(progress,summary);
      const current=el('div','nl-current');center.append(current);
      const subscriptions=el('div','nl-subscriptions'),subscriptionHeading=el('div','nl-subscription-heading'),add=button('+',()=>showImport('subscription'),'button subtle');add.setAttribute('aria-label',t('nlAddSubscription'));add.dataset.nlAvailable='';subscriptionHeading.append(el('h3','',t('nlSubscriptions')),add);subscriptions.append(subscriptionHeading);const subscriptionsList=el('div','nl-subscription-list');subscriptions.append(subscriptionsList);center.append(subscriptions);
      view={groupListHost,groupActions,body,allCheck,count,clear,pages,previous,next,range,notice:noticeHost,modeControl,trafficField,trafficControl,concurrencyField,concurrencyControl,budget,selectedButton,groupButton,stop,progress,summary,current,subscriptionsList};
      notice(noticeText,noticeKind);drawGroups();drawRows();drawSubscriptions();updateControls();paintCurrent();
    }
    function drawGroups(){
      if(!alive)return;const list=groupList();if(!list.some(g=>g.id===currentGroup))currentGroup='all';view.groupListHost.replaceChildren();
      list.forEach((g,index)=>{const b=button('',()=>{currentGroup=g.id;tablePage=0;drawGroups();drawRows();updateControls();},'nl-group');b.dataset.groupId=g.id;b.id='nl-group-'+index;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(currentGroup===g.id));b.setAttribute('aria-controls','nl-results-body');b.tabIndex=currentGroup===g.id?0:-1;b.append(el('span','nl-group-name',g.name),el('span','badge',g.count));b.onkeydown=e=>{let at=index;if(e.key==='ArrowDown')at=(index+1)%list.length;else if(e.key==='ArrowUp')at=(index+list.length-1)%list.length;else if(e.key==='Home')at=0;else if(e.key==='End')at=list.length-1;else return;e.preventDefault();currentGroup=list[at].id;tablePage=0;drawGroups();drawRows();updateControls();view.groupListHost.children[at]?.focus();};view.groupListHost.append(b);});
      for(const old of view.groupActions.querySelectorAll('[data-group-edit]'))old.remove();
      const selected=list.find(g=>g.id===currentGroup);if(selected&&selected.source==='local'&&!selected.readonly&&selected.rawId!=='local-imports'){
        const rename=button(t('rename'),()=>editGroup(selected),'button subtle'),remove=button(t('remove'),()=>confirmAction(t('nlRemoveGroup'),t('nlRemoveGroupHelp'),()=>mutate('v2routeLibraryGroups',{action:'remove',id:selected.rawId,revision:lib.revision})),'button danger-text');for(const b of [rename,remove]){b.dataset.groupEdit='';b.dataset.nlAvailable='';view.groupActions.append(b);}
      }
    }
    function metricCell(row,key,average){
      const n=el('td','nl-number');if(!row)return n.appendChild(el('span','', '—')),n;
      const active=row.phase===key&&['running','starting'].includes(row.state),value=active?row[key+'Mbps']:row[average];n.textContent=finite(value)?value.toFixed(2)+(active?' Mbps/s':' Mbps'):'—';n.dataset.metric=key;n.dataset.phaseState=active?'running':finite(value)?'complete':'unknown';return n;
    }
    function drawRows(){
      if(!alive)return;const allItems=sortedRows();tablePage=Math.max(0,Math.min(tablePage,Math.ceil(allItems.length/50)-1));const items=allItems.slice(tablePage*50,tablePage*50+50);view.previous.disabled=tablePage===0;view.next.disabled=(tablePage+1)*50>=allItems.length;view.pages.hidden=allItems.length<=50;view.range.textContent=(tablePage+1)+' / '+Math.max(1,Math.ceil(allItems.length/50));view.body.replaceChildren();view.body.id='nl-results-body';
      workspace.querySelector('.nl-results').setAttribute('aria-label',activeName());
      for(const th of workspace.querySelectorAll('th[data-sort]'))th.setAttribute('aria-sort',th.dataset.sort===sort?(direction>0?'ascending':'descending'):'none');
      for(const r of items){
        const result=results.get(r.value),row=el('tr',hidden(r)?'nl-row hidden-node':'nl-row');row.dataset.route=r.value;row.dataset.state=result?.state||'untested';
        const checkCell=el('td'),check=input('','checkbox');check.checked=chosen.has(r.value);check.disabled=!eligible(r)||running();check.setAttribute('aria-label',t('nlSelectNode')+': '+V2R.routeLabel(r));check.onchange=()=>{check.checked?chosen.add(r.value):chosen.delete(r.value);updateControls();};checkCell.append(check);
        const name=el('td','nl-node'),nameLine=el('div','nl-node-name'),flag=el('img','nl-flag');flag.src=V2R.routeIcon(r);flag.alt='';nameLine.append(flag,el('strong','',V2R.routeLabel(r)));name.append(nameLine);
        const meta=[r.group_id==='local-imports'?t('imported'):r.group,r.protocol,hidden(r)?t('hiddenNode'):''].filter(Boolean);name.append(el('small','muted',meta.join(' · ')));
        if(r.supported===false)name.append(el('small','nl-unavailable',r.reason||t('unavailable')));
        if((result?.chainValues||r.chain_values||[]).length>1)name.append(el('small','nl-chain-note',t('nlViaGroup')));
        const latency=el('td','nl-number',finite(result?.latencyMs)?Math.round(result.latencyMs)+' ms':'—');latency.dataset.metric='latency';
        const status=el('td','nl-row-status',t(stateKey(result?.state)));status.dataset.status=result?.state||'untested';if(result?.errorCode)status.title=errorText(result.errorCode);
        const actions=el('td'),buttons=el('div','nl-row-actions'),test=button(t('nlTestNode'),()=>start([r.value]),'button subtle');test.disabled=running()||!eligible(r)||!root.V2RNodeMeasure;test.title=t(mode==='full'?'nlFull':'nlQuick');test.dataset.action='test';
        const create=button(t(r.supported===false&&r.override_supported?'preConfigure':'useNode'),()=>context.onCreate(r.value),'button subtle');create.disabled=(r.supported===false&&!r.override_supported)||hidden(r);create.dataset.action='create';buttons.append(test,create);
        if(local(r)){const remove=button(t('remove'),()=>confirmAction(t('removeNode'),t('removeNodeHelp'),async()=>{await V2R.rpc('v2routeRemoveNode',[r.id||r.value.replace(/^node:/,'')]);await loadState();}),'button danger-text');remove.disabled=running()||mutation;remove.dataset.action='remove';buttons.append(remove);}
        else{const toggle=button(t(hidden(r)?'restoreNode':'hideNode'),async()=>{toggle.disabled=true;try{await context.savePrefs(p=>{const values=new Set(p.hiddenRouteValues||[]);hidden(r)?values.delete(r.value):values.add(r.value);return{hiddenRouteValues:[...values]};});if(!alive)return;chosen.delete(r.value);drawGroups();drawRows();updateControls();}catch(_){notice(t('nlOperationFailed'));toggle.disabled=false;}},'button subtle');toggle.disabled=running();toggle.dataset.action='hide';toggle.title=t('hideNodeHelp');buttons.append(toggle);}
        actions.append(buttons);row.append(checkCell,name,latency,metricCell(result,'download','downloadAverageMbps'),metricCell(result,'upload','uploadAverageMbps'),status,actions);view.body.append(row);
      }
      if(!items.length){const row=el('tr'),cell=el('td','nl-empty',t(routes().length?'adjustNodeFilters':'noNodesHelp'));cell.colSpan=7;row.append(cell);view.body.append(row);}
      updateSelection();
    }
    function updateSelection(){const list=sortedRows().slice(tablePage*50,tablePage*50+50).filter(eligible),selected=list.filter(r=>chosen.has(r.value)).length;view.allCheck.checked=!!list.length&&selected===list.length;view.allCheck.indeterminate=selected>0&&selected<list.length;view.allCheck.disabled=!list.length||running();view.count.textContent=visibleRoutes().length+' '+t('nodeCount')+' · '+chosen.size+' '+t('nlSelected');view.clear.disabled=!chosen.size||running();}
    function budgetFor(ids){return mode==='full'?ids.length*traffic*2:0;}
    function updateControls(){
      if(!alive)return;const active=running(),selected=[...chosen].filter(id=>routes().some(r=>r.value===id&&eligible(r))),shown=visibleRoutes().filter(eligible).map(r=>r.value);
      for(const n of [...workspace.querySelectorAll('[data-nl-available]'),...context.actions.querySelectorAll('[data-nl-available]')])n.disabled=!available||mutation||active;
      for(const n of context.actions.querySelectorAll('[data-nl-mutation]'))n.disabled=active||mutation;
      for(const item of workspace.querySelectorAll('.nl-subscription'))for(const b of item.querySelectorAll('button'))b.disabled=active||mutation||item.dataset.state==='updating';
      view.modeControl.disabled=active;view.trafficControl.disabled=active;view.concurrencyControl.disabled=active;view.trafficField.hidden=mode!=='full';view.concurrencyField.hidden=mode!=='quick';
      view.budget.textContent=mode==='full'?t('nlBudget')+'\n'+t('nlTestSelected')+' ('+selected.length+'): '+budgetFor(selected)+' MiB\n'+t('nlTestVisible')+' ('+shown.length+'): '+budgetFor(shown)+' MiB\n'+t('nlTrafficBoth'):t('nlQuickHelp');view.budget.textContent+=' · '+t('nlBatchLimit');view.budget.classList.toggle('error',budgetFor(selected)>8192||budgetFor(shown)>8192||selected.length>1000||shown.length>1000);
      view.selectedButton.disabled=active||!selected.length||selected.length>1000||budgetFor(selected)>8192||!root.V2RNodeMeasure;view.groupButton.disabled=active||!shown.length||shown.length>1000||budgetFor(shown)>8192||!root.V2RNodeMeasure;
      view.groupButton.textContent=t('nlTestVisible')+' ('+shown.length+')';view.selectedButton.textContent=t('nlTestSelected')+' ('+selected.length+')';view.stop.hidden=!active;view.stop.disabled=stopping;view.stop.textContent=t(stopping?'nlStopping':'nlStop');
      const total=Number(job?.total)||0,completed=Number(job?.completed)||0;view.progress.hidden=!job;view.progress.max=Math.max(1,total);view.progress.value=Math.min(total,completed);
      view.summary.textContent=starting?t('nlStarting'):job?t(stateKey(job.state))+' · '+completed+'/'+total+' · '+(Number(job.succeeded)||0)+' '+t('nlSucceeded'):t('nlReady');updateSelection();
    }
    function paintCurrent(){
      const row=[...results.values()].find(r=>['running','starting'].includes(r.state))||job?.rows?.[job.rows.length-1];view.current.replaceChildren();if(!row)return;
      const route=routes().find(r=>r.value===row.route);view.current.append(el('strong','nl-current-name',route?V2R.routeLabel(route):t('nlNode')));
      const metrics=el('div','nl-live-metrics');for(const [key,title,avg]of [['latency','speedLatency',''],['download','speedDownload','downloadAverageMbps'],['upload','speedUpload','uploadAverageMbps']]){
        const card=el('div','nl-live-metric');card.dataset.metric=key;const active=row.phase===key&&['running','starting'].includes(row.state),value=key==='latency'?row.latencyMs:active?row[key+'Mbps']:row[avg];card.append(el('small','muted',t(title)),el('strong','',finite(value)?(key==='latency'?Math.round(value)+' ms':value.toFixed(2)+(active?' Mbps/s':' Mbps')):'—'));if(key!=='latency')card.append(el('small','muted',finite(value)?t(active?'speedRealtime':'speedAverage'):t('nlUntested')));metrics.append(card);
      }view.current.append(metrics);
    }
    function acceptSnapshot(snapshot,token){
      if(!alive||token!==generation||!snapshot||typeof snapshot!=='object')return false;
      if(job?.jobId&&snapshot.jobId!==job.jobId)return false;if(job?.seq!=null&&snapshot.seq<job.seq)return false;
      job={...job,...snapshot};for(const row of snapshot.rows||[])if(typeof row.route==='string')results.set(row.route,{...results.get(row.route),...row});
      if(terminal(job.state)){starting=false;stopping=false;if(!job.hasMore)clearTimeout(pollTimer);}
      drawRows();updateControls();paintCurrent();return true;
    }
    async function poll(token){
      if(!alive||token!==generation||!job||(terminal(job.state)&&!job.hasMore))return;
      try{const state=await transport.request('nodeMeasurePoll',{jobId:job.jobId,afterSeq:job.seq||0});if(acceptSnapshot(state,token)&&(!terminal(job.state)||job.hasMore)){clearTimeout(pollTimer);pollTimer=setTimeout(()=>poll(token),job.hasMore?0:500);}}
      catch(_){if(!alive||token!==generation)return;job={...job,state:'error',hasMore:false};stopping=false;starting=false;for(const [id,row]of results)if(!terminal(row.state))results.set(id,{...row,state:'error',downloadMbps:null,uploadMbps:null});notice(t('nlMeasureDisconnected'));transport?.close();transport=null;drawRows();updateControls();paintCurrent();}
    }
    async function start(ids){
      if(running()||!alive||!root.V2RNodeMeasure)return;const map=new Map(routes().map(r=>[r.value,r]));ids=[...new Set(ids)].filter(id=>map.has(id)&&eligible(map.get(id)));if(!ids.length||ids.length>1000||budgetFor(ids)>8192)return;
      const token=++generation;clearTimeout(pollTimer);starting=true;stopping=false;job=null;notice('');for(const id of ids)results.set(id,{route:id,state:'queued'});drawRows();updateControls();paintCurrent();
      try{transport?.close();transport=root.V2RNodeMeasure.create();const snapshot=await transport.request('nodeMeasureStart',{nodeIds:ids,mode,trafficMiB:traffic,concurrency:mode==='full'?1:concurrency});if(!alive||token!==generation)return;starting=false;if(!snapshot?.jobId)throw new Error('invalid-job');acceptSnapshot(snapshot,token);if(stopping)await cancelJob(token);else if(!terminal(job.state)||job.hasMore)poll(token);}
      catch(_){if(!alive||token!==generation)return;transport?.close();transport=null;starting=false;stopping=false;for(const id of ids)results.set(id,{route:id,state:'error'});job={state:'error',total:ids.length,completed:0,succeeded:0,rows:[]};notice(t('nlMeasureDisconnected'));drawRows();updateControls();}
    }
    async function cancelJob(token){
      try{const snapshot=await transport.request('nodeMeasureCancel',{jobId:job.jobId,afterSeq:job.seq||0});if(acceptSnapshot(snapshot,token)&&(!terminal(job.state)||job.hasMore))poll(token);}
      catch(_){if(alive&&token===generation){transport?.close();transport=null;for(const [id,row]of results)if(!terminal(row.state))results.set(id,{...row,state:'cancelled',downloadMbps:null,uploadMbps:null});job={...job,state:'cancelled',hasMore:false};stopping=false;notice(t('nlMeasureDisconnected'));drawRows();updateControls();paintCurrent();}}
    }
    function stopTest(){if(!running()||stopping)return;stopping=true;clearTimeout(pollTimer);updateControls();if(job?.jobId)cancelJob(generation);}
    function drawSubscriptions(){
      if(!alive)return;view.subscriptionsList.replaceChildren();if(!available){view.subscriptionsList.append(el('p','muted',t('nlUpgrade')));return;}
      if(!lib.subscriptions?.length)view.subscriptionsList.append(el('p','muted',t('nlNoSubscriptions')));
      for(const sub of lib.subscriptions||[]){
        const item=el('article','nl-subscription');item.dataset.subscriptionId=sub.id;item.dataset.state=sub.status||'idle';item.append(el('strong','',sub.name),el('small','muted',sub.hostname||''));
        const status=el('p','nl-sub-status',t({idle:'nlSubIdle',updating:'nlSubUpdating',ok:'nlSubOk',error:'nlSubError'}[sub.status]||'nlSubIdle'));status.dataset.state=sub.status||'idle';if(sub.error_code)status.title=errorText(sub.error_code);item.append(status);
        item.append(el('small','muted',sub.enabled?t('nlAutoEvery')+' '+sub.interval_minutes+' '+t('nlMinutes'):t('nlAutoOff')));
        item.append(el('small','muted',t({'proxy-first':'nlProxyFirst','proxy-only':'nlProxyOnly','direct-only':'nlDirectOnly'}[sub.policy]||'nlProxyFirst')));if(sub.last_transport)item.append(el('small','muted',t(sub.last_transport==='proxy'?'nlFetchedProxy':'nlFetchedDirect')));
        if(sub.last_success)item.append(el('small','muted',t('nlLastUpdate')+': '+new Date(sub.last_success).toLocaleString(I18n.language)));
        if(sub.enabled&&sub.next_due)item.append(el('small','muted',t('nlNextUpdate')+': '+new Date(sub.next_due).toLocaleString(I18n.language)));
        const actions=el('div','nl-sub-actions'),refresh=button(t('nlRefresh'),async()=>{refresh.disabled=true;try{const state=await mutate('v2routeSubscriptionRefresh',{id:sub.id});if(state?.refresh?.ok===false)notice(errorText(state.refresh.code));}catch(_){notice(t('nlOperationFailed'));}finally{if(alive)drawSubscriptions();}},'button subtle'),edit=button(t('nlEdit'),()=>showImport('subscription',sub),'button subtle'),remove=button(t('remove'),()=>confirmAction(t('nlRemoveSubscription'),t('nlKeepNodes'),()=>mutate('v2routeSubscriptionRemove',{id:sub.id,keep_nodes:true,revision:lib.revision})),'button danger-text');
        for(const b of [refresh,edit,remove]){b.disabled=mutation||running()||sub.status==='updating';actions.append(b);}item.append(actions);view.subscriptionsList.append(item);
      }
    }
    function openDialog(title){
      closeDialog();const token=++dialogGeneration,opener=document.activeElement,n=el('dialog','nl-dialog'),body=el('div','nl-dialog-body'),heading=el('h2','',title);heading.id='nl-dialog-title';n.setAttribute('aria-labelledby',heading.id);body.append(heading);n.append(body);document.body.append(n);dialog=n;
      n.addEventListener('close',()=>{n.remove();if(dialog===n){dialog=null;dialogGeneration++;}if(alive&&opener?.isConnected)opener.focus();},{once:true});n.showModal();return{n,body,token};
    }
    function closeDialog(){if(dialog){const old=dialog;dialog=null;dialogGeneration++;old.close();old.remove();}}
    function dialogActions(form,submitLabel,action){
      const error=el('p','inline-error');error.setAttribute('role','alert');const actions=el('div','nl-dialog-actions'),cancel=button(t('cancel'),()=>form.n.close(),'button subtle'),submit=button(submitLabel,async()=>{if(submit.disabled)return;error.textContent='';submit.disabled=true;try{await action();if(alive&&dialog===form.n)form.n.close();}catch(err){if(alive&&dialog===form.n)error.textContent=err?.uiMessage||errorText(err);}finally{if(alive&&dialog===form.n)submit.disabled=false;}},'button primary');actions.append(cancel,submit);form.body.append(error,actions);return submit;
    }
    function invalid(key){const error=new Error(key);error.uiMessage=t(key);throw error;}
    function editGroup(group){
      const form=openDialog(t(group?'nlRenameGroup':'nlNewGroup')),name=input(group?.name||'');name.maxLength=100;form.body.append(field(t('nlName'),name));dialogActions(form,t('save'),async()=>{if(!name.value.trim())invalid('nlNameRequired');await mutate('v2routeLibraryGroups',{action:group?'rename':'create',...(group?{id:group.rawId}:{}),name:name.value.trim(),revision:lib.revision});});name.focus();
    }
    function confirmAction(title,help,action){const form=openDialog(title);form.body.append(el('p','muted',help));dialogActions(form,t('nlConfirm'),action);}
    function showImport(tab='links',subscription=null){
      if(!available||running())return;const form=openDialog(t(subscription?'nlEditSubscription':'importTitle')),tabs=el('div','nl-import-tabs'),content=el('div'),linksPanel=el('div'),subPanel=el('div');
      const linksTab=button(t('nlPasteContent'),()=>changeTab('links')),subTab=button(t('nlSubscriptionURL'),()=>changeTab('subscription'));tabs.setAttribute('role','tablist');for(const b of [linksTab,subTab])b.setAttribute('role','tab');tabs.append(linksTab,subTab);if(!subscription)form.body.append(tabs);
      const text=el('textarea');text.rows=7;text.spellcheck=false;text.placeholder='vless://…\nhttps://user:password@proxy.example:443';text.setAttribute('aria-label',t('nlPasteContent'));linksPanel.append(el('p','muted',t('importHelp')),text);
      const examples=el('details','import-examples');examples.append(el('summary','',t('importExamples')),el('pre','code-input','http://user:password@proxy.example:8080\nsocks5://user:password@proxy.example:1080\nss://BASE64(method:password)@proxy.example:8388\nvmess://Base64\nvless://UUID@proxy.example:443?security=tls\ntrojan://password@proxy.example:443\nhy2://password@proxy.example:443\n{"proxies": [{"type":"socks5","server":"proxy.example","port":1080}]}'));linksPanel.append(examples);
      const name=input(subscription?.name||''),url=input('','url');url.placeholder=subscription?t('nlKeepURL'):'https://example.com/subscription';url.spellcheck=false;url.autocomplete='off';name.maxLength=100;
      const enabled=input('','checkbox');enabled.checked=subscription?.enabled??false;const interval=input(String(subscription?.interval_minutes||60),'number');interval.min='5';interval.max='43200';interval.step='1';
      const policy=select([['proxy-first',t('nlProxyFirst')],['proxy-only',t('nlProxyOnly')],['direct-only',t('nlDirectOnly')]],subscription?.policy||'proxy-first');
      const autoLabel=el('label','nl-checkbox');autoLabel.append(enabled,el('span','',t('nlAutoUpdate')));subPanel.append(field(t('nlName'),name),field(t('nlSubscriptionURL'),url),field(t('nlConnectionPolicy'),policy),el('p','muted',t('nlProxyFirstHelp')),autoLabel,field(t('nlInterval'),interval));enabled.onchange=()=>interval.disabled=!enabled.checked;enabled.onchange();
      const groupOptions=(lib.groups||[]).map(g=>[g.id,g.id==='local-imports'?t('imported'):g.name]),defaultGroup=groupOptions.some(([id])=>id===currentGroup.replace(/^group:/,''))?currentGroup.replace(/^group:/,''):'local-imports';
      const destination=select([['',t('nlSubscriptionOwnGroup')],...groupOptions],subscription?.group_id||(tab==='subscription'?'':defaultGroup));destination.dataset.importGroup='';const groupField=field(t('nlDestinationGroup'),destination);
      content.append(linksPanel,subPanel);form.body.append(content,groupField,el('p','muted import-privacy',t('importPrivacy')));
      const submit=dialogActions(form,t(subscription?'save':'import'),async()=>{
        if(tab==='links'){
          if(!text.value.trim())invalid('nlContentRequired');if(!destination.value)invalid('nlGroupRequired');await mutate('v2routeLibraryImport',{text:text.value,group_id:destination.value});text.value='';
        }else{
          if(!name.value.trim())invalid('nlNameRequired');if(!subscription&&!url.value.trim())invalid('nlURLRequired');
          if(url.value.trim()){let parsed;try{parsed=new URL(url.value.trim());}catch(_){invalid('nlURLRequired');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)invalid('nlURLRequired');}
          const minutes=Number(interval.value);if(!Number.isInteger(minutes)||minutes<5||minutes>43200)invalid('nlIntervalInvalid');
          const saved=await mutate('v2routeSubscriptionSave',{...(subscription?{id:subscription.id}:{}),name:name.value.trim(),...(url.value.trim()?{url:url.value.trim()}:{}),...(destination.value?{group_id:destination.value}:{}),enabled:enabled.checked,interval_minutes:minutes,policy:policy.value,revision:lib.revision});url.value='';if(!subscription&&saved?.created_id){const updated=await mutate('v2routeSubscriptionRefresh',{id:saved.created_id});if(updated?.refresh?.ok===false)notice(errorText(updated.refresh.code));}
        }
      });
      function changeTab(next){tab=next;linksPanel.hidden=tab!=='links';subPanel.hidden=tab!=='subscription';for(const [b,value]of [[linksTab,'links'],[subTab,'subscription']]){b.setAttribute('aria-selected',String(value===tab));b.tabIndex=value===tab?0:-1;}destination.options[0].disabled=tab==='links';if(tab==='links'&&!destination.value)destination.value='local-imports';submit.textContent=t(subscription?'save':tab==='links'?'import':'save');}
      tabs.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();changeTab(tab==='links'?'subscription':'links');(tab==='links'?linksTab:subTab).focus();}};changeTab(tab);(tab==='links'?text:name).focus();
    }
    function destroy(){
      if(!alive)return;alive=false;root.removeEventListener('pagehide',destroy);generation++;loadSerial++;clearTimeout(pollTimer);clearTimeout(stateTimer);closeDialog();if(job?.jobId&&!terminal(job.state))transport?.request('nodeMeasureCancel',{jobId:job.jobId}).catch(()=>{});transport?.close();transport=null;workspace.remove();
    }
    root.addEventListener('pagehide',destroy,{once:true});
    build();loadState();return{destroy,translate:build};
  }
  root.V2RNodeLibrary={mount};
})(globalThis);
