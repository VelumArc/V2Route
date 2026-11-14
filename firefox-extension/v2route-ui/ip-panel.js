/* One bounded check per IP Tools visit; results stay in page memory. */
(function(root){
  'use strict';
  let latestResult=null,family='ipv4',active=null,view=null,generation=0,configurationEpoch=0,entryChecked=false,nativePending=null;
  const t=k=>I18n.t(k),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(label,fn,cls='button subtle')=>{const n=el('button',cls,label);n.type='button';n.onclick=fn;return n;};
  const labelContext=c=>c.name==='direct'?t('direct'):c.name==='system'?t('system'):c.name||t('noProfile');
  const time=result=>new Date(result.checkedAt).toLocaleTimeString(I18n.language==='zh'?'zh-CN':'en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const errorText=e=>t(({TIMEOUT:'ipTimeout',CONTEXT_TIMEOUT:'ipContextTimeout',CANCELLED:'ipCancelled',NETWORK:'ipNetwork',HTTP:'ipHttp',INVALID_RESPONSE:'ipInvalid',TOO_LARGE:'ipInvalid',PERMISSION:'ipPing0Permission',CHALLENGE:'ipPublicChallenge',BAD_OPTIONS:'ipInvalid'})[e?.code]||'ipFailure');
  function checkActive(controller){if(controller.signal.aborted){const error=new Error('Cancelled');error.code='CANCELLED';throw error;}}
  function stop(clearResult=false){root.V2RTools?.close();generation++;active?.abort();active=null;view=null;if(clearResult){latestResult=null;entryChecked=false;}}
  function reportButton(label,url){const control=button(label,()=>V2RTools.openUrl({title:t('ipPublicReport'),provider:'Ping0',url:control.dataset.url}),'ip-external');control.dataset.url=url;return control;}
  async function context({signal}={}){
    const failure=code=>{const error=new Error(code);error.code=code;return error;};
    if(signal?.aborted)throw failure('CANCELLED');
    let timer,onAbort;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('CONTEXT_TIMEOUT')),5000);onAbort=()=>reject(failure('CANCELLED'));signal?.addEventListener('abort',onAbort,{once:true});});
    try{const {options,state}=await Promise.race([V2R.read(),deadline]),name=state.isSystemProfile?'system':state.currentProfileName;const profile=options['+'+name];return{name:name||'system',kind:profile?.profileType||'',revision:profile?.revision||'',fingerprint:JSON.stringify({name,revision:profile?.revision||'',choice:profile?._zeroRouteChoice||'',epoch:configurationEpoch,blocked:!!state.proxyNotControllable}),controlled:!state.proxyNotControllable};}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
  }
  function ping0Permission(origin,signal) {
    const request={origins:[origin]};
    if(chrome.runtime.getManifest().browser_specific_settings?.gecko)request.data_collection=['locationInfo'];
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=code=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);if(code)reject(Object.assign(new Error(code),{code}));else resolve();};
      const cancel=()=>finish('CANCELLED');
      if(signal?.aborted){cancel();return;}
      signal?.addEventListener('abort',cancel,{once:true});
      if(!chrome.permissions?.request){finish('PERMISSION');return;}
      try{chrome.permissions.request(request,allowed=>{const denied=chrome.runtime.lastError||!allowed;finish(denied?'PERMISSION':null);});}catch(_){finish('PERMISSION');}
    });
  }
  function hasPing0Permission(signal){
    return new Promise(resolve=>{
      if(signal?.aborted||!chrome.permissions?.contains){resolve(false);return;}
      const request={origins:['https://ping0.cc/*']};
      if(chrome.runtime.getManifest().browser_specific_settings?.gecko)request.data_collection=['locationInfo'];
      try{chrome.permissions.contains(request,allowed=>resolve(!chrome.runtime.lastError&&!!allowed&&!signal?.aborted));}catch(_){resolve(false);}
    });
  }
  function noteDetails(label,...texts){
    const details=el('details','ip-notes');details.append(el('summary','',label));
    for(const text of texts)details.append(el('p','muted ip-small',text));return details;
  }
  // Colour expresses an explicit provider label, never a score inferred locally.
  function reportValue({id,value}){
    const cell=el('dd'),text=String(value),plain=text.trim().replace(/\s+/g,' ');
    const badge=(label,tone)=>el('span','ip-result-badge ip-tone-'+tone,label);
    let tone='neutral';
    if(id==='risk'){
      const label=plain.replace(/^\d+(?:\.\d+)?%\s*/,'');
      if(/^(纯净|低风险|非常纯净|clean|low risk)$/i.test(label))tone='good';
      else if(/^(中等|中等风险|中风险|medium risk|moderate)$/i.test(label))tone='warm';
      else if(/^(高风险|极高风险|高危|危险|不纯净|high risk|dangerous)$/i.test(label))tone='coral';
    }else if(id==='type'){
      if(/^(家庭宽带|家庭住宅|住宅|住宅宽带|residential)(?:\s*IP)?$/i.test(plain))tone='good';
      else if(/^(IDC机房|IDC 机房|数据中心|机房|data center|datacenter|hosting)(?:\s*IP)?$/i.test(plain))tone='coral';
    }else if(id==='native'){
      if(/^(广播\s*IP|broadcast\s*IP)$/i.test(plain))tone='warm';
      else if(/^(原生\s*IP|native\s*IP)$/i.test(plain))tone='good';
    }else if(id==='sharing'){
      if(/[（(](极好|很好|良好|优秀|excellent|very good|good)[)）]\s*$/i.test(plain))tone='good';
      else if(/[（(](一般|中等|average|moderate)[)）]\s*$/i.test(plain))tone='warm';
      else if(/[（(](较差|很差|差|poor|bad)[)）]\s*$/i.test(plain))tone='coral';
    }
    if(['risk','type','native','sharing'].includes(id)){
      const pill=badge(text,tone);if(id==='risk')pill.classList.add('ip-risk-badge');cell.append(pill);
    }else if(['owner','organization'].includes(id)&&/^IDC\s+/.test(text)){
      cell.append(badge('IDC','coral'),document.createTextNode(text.slice(3)));
    }else cell.textContent=text;
    return cell;
  }
  function detailRows(host,latest){
    if(!latest.publicReport)return null;
    const section=el('section','ip-public-report');
    section.append(el('h2','',t('ipPublicReport')));
    const fields=el('div','ip-public-table ip-report-grid');
    for(const [className,ids] of [['ip-report-basics',['location','asn','owner','organization']],['ip-report-quality',['type','risk','native','sharing']]]){
      const column=el('dl','ip-report-column '+className);
      for(const id of ids){
        const field=latest.publicReport.rows.find(row=>row.id===id);if(!field)continue;
        const row=el('div','ip-report-field');row.dataset.reportField=id;
        row.append(el('dt','',field.name),reportValue(field));column.append(row);
      }
      fields.append(column);
    }
    const footer=el('div','ip-report-footer'),source=el('span','ip-report-source',t('ipPublicSource')+' · '+time(latest.publicReport));
    footer.append(source,reportButton(t('ipPublicOriginal'),V2RIP.qualityURL(latest.ip)));
    section.append(fields,footer);host.append(section);return footer;
  }

  function renderNetwork(host,token){
    host.append(el('h2','',t('netTitle')));
    const targets=el('div','ip-network-targets'),region=el('select'),target=el('select');
    region.id='network-region';region.setAttribute('aria-label',t('netRegion'));
    target.id='network-target';target.setAttribute('aria-label',t('netTarget'));
    for(const [value,key] of [['node','netNodeArea'],['china','netChina'],['global','netGlobal'],['custom','netCustomTarget']]){
      const option=el('option','',t(key));option.value=value;region.append(option);
    }
    let contextName=null;
    function setContext(value){
      const node=region.querySelector('option[value=node]'),available=value.kind==='FixedProfile';
      node.hidden=node.disabled=!available;
      if(!available&&region.value==='node'){
        region.value=I18n.language==='zh'?'china':'global';setTargets();
      }else if(available&&contextName===null){region.value='node';setTargets();}
      contextName=value.name;
    }
    function setTargets(){
      target.replaceChildren();
      const choices={node:[['current',t('netCurrentTarget')]],china:[['ali',t('netAli')+' · 223.5.5.5'],['tencent',t('netTencent')+' · 119.29.29.29']],global:[['cloudflare','Cloudflare · 1.1.1.1'],['google','Google · 8.8.8.8']],custom:[['custom',t('netCustomTarget')]]}[region.value];
      for(const [value,text]of choices){const option=el('option','',text);option.value=value;target.append(option);}
      custom.hidden=region.value!=='custom';
    }
    const custom=el('div','ip-network-custom'),customHost=el('input'),customPort=el('input');custom.hidden=true;
    customHost.id='network-host';customHost.type='text';customHost.placeholder='example.com';customHost.autocomplete='off';customHost.spellcheck=false;customHost.maxLength=253;
    customPort.id='network-port';customPort.type='number';customPort.min='1';customPort.max='65535';customPort.value='443';
    for(const [text,control]of [[t('netHost'),customHost],[t('netPort'),customPort]]){const label=el('label');label.append(el('span','ip-small',text),control);custom.append(label);}
    region.onchange=setTargets;setTargets();targets.append(region,target);
    const controls=el('div','ip-controls'),ping=button('Ping',()=>run('ping')),tcp=button('TCPing',()=>run('tcp'));
    const mtr=button('MTR',()=>run('mtr')),download=button(t('toolSpeed'),()=>V2RTools.open('speed'),'button primary');
    const cancel=button(t('netStop'),()=>active?.abort());cancel.hidden=true;
    ping.id='network-ping';tcp.id='network-tcp';mtr.id='network-mtr';download.id='network-download';cancel.id='network-cancel';
    controls.append(ping,tcp,mtr,download,cancel);
    const toolbar=el('div','ip-network-toolbar');toolbar.append(targets,controls,custom);host.append(toolbar);
    const terminal=el('div','network-console');
    const bar=el('div','network-console-bar'),title=el('span','',t('netConsole')),clear=button(t('netLogClear'),()=>{log.replaceChildren();},'');
    bar.append(title,clear);
    const log=el('div','network-console-log'),stats=el('div','network-console-stats'),mtrScroll=el('div','network-mtr-scroll');
    log.setAttribute('role','log');log.setAttribute('aria-label',t('netConsole'));log.setAttribute('aria-live','off');log.tabIndex=0;
    const table=el('table','network-mtr-table'),thead=el('thead'),head=el('tr'),tbody=el('tbody');
    for(const text of [t('netHop'),t('netAddress'),t('netLoss'),t('netSent'),t('netReceived'),t('netLast'),t('netAverageShort'),t('netBest'),t('netWorst')])head.append(el('th','',text));
    thead.append(head);table.append(thead,tbody);mtrScroll.append(table);mtrScroll.hidden=true;
    terminal.append(bar,log,mtrScroll,stats);
    log.append(el('div','network-log-line',t('netStartHelp')));
    const message=el('p','ip-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    host.append(terminal,message,noteDetails(t('ipTestDetails'),t('netConsoleHelp')));
    function appendLine(text,tone=''){
      const pinned=log.scrollTop+log.clientHeight>=log.scrollHeight-30;
      log.append(el('div','network-log-line '+tone,text));
      while(log.childElementCount>200)log.firstElementChild.remove();
      if(pinned)log.scrollTop=log.scrollHeight;
    }
    const clock=()=>new Date().toLocaleTimeString(I18n.language==='zh'?'zh-CN':'en-US',{hour12:false});
    const failure=code=>Object.assign(new Error(code),{code});
    const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
      const abort=()=>{cleanup();reject(failure('CANCELLED'));};
      const timer=setTimeout(()=>{cleanup();resolve();},ms);
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
    async function nativeProbe(settings,signal){
      if(nativePending)throw new Error(t('netFinishing'));
      const request=V2R.rpc('v2routeNetworkTest',[settings]);nativePending=request;
      request.then(()=>{if(nativePending===request)nativePending=null;},()=>{if(nativePending===request)nativePending=null;});
      let timer,abort;
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('TIMEOUT')),12000);abort=()=>reject(failure('CANCELLED'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
      try{return await Promise.race([request,deadline]);}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    }
    async function run(kind){
      if(active)return;
      if(nativePending){message.textContent=t('netFinishing');return;}
      let settings={kind,target:target.value};
      if(kind==='ping'||kind==='tcp')settings.count=1;
      if(target.value==='custom'){
        settings.host=customHost.value.trim();if(!settings.host){message.textContent=t('netHostRequired');customHost.focus();return;}
        if(kind==='tcp'){settings.port=Number(customPort.value);if(!Number.isInteger(settings.port)||settings.port<1||settings.port>65535){message.textContent=t('invalidPort');customPort.focus();return;}}
      }
      const controller=new AbortController();active=controller;
      const inputs=[region,target,customHost,customPort,ping,tcp,mtr,download];inputs.forEach(b=>b.disabled=true);cancel.hidden=false;
      log.replaceChildren();tbody.replaceChildren();stats.replaceChildren();stats.title='';message.textContent='';message.className='ip-message';
      terminal.hidden=false;log.hidden=false;mtrScroll.hidden=true;log.style.height='';
      let sent=0,received=0,total=0,round=0,sequence=0,endpointKey=null;const hops=new Map();
      const summary=()=>{stats.replaceChildren();for(const text of [t('netSent')+' '+sent,t('netReceived')+' '+received,t('netLoss')+' '+(sent?((sent-received)/sent*100).toFixed(1)+'%':'—'),t('netAverageShort')+' '+(received?(total/received).toFixed(1)+' ms':'—')])stats.append(el('span','',text));};
      try{
        const before=await context({signal:controller.signal});checkActive(controller);
        // Reconcile again at click time in case the profile changed while reading it.
        setContext(before);settings={...settings,target:target.value};
        title.textContent=(kind==='tcp'?'TCPing':kind.toUpperCase())+' · '+t('netDirectShort');
        appendLine('> '+kind+' '+target.options[target.selectedIndex].textContent);
        summary();
        while(!controller.signal.aborted&&token===generation){
          const roundStarted=performance.now();
          const value=await nativeProbe(settings,controller.signal);checkActive(controller);if(token!==generation)return;
          const after=await context({signal:controller.signal});checkActive(controller);if(before.fingerprint!==after.fingerprint)throw failure('STALE');
          const nextEndpoint=JSON.stringify([value?.host||'',value?.address||'',value?.port||0]);
          if(endpointKey!==null&&endpointKey!==nextEndpoint)throw failure('STALE');
          endpointKey=nextEndpoint;round++;
          if(kind==='mtr'){
            if(!value||!Array.isArray(value.hops)||value.hops.length>24)throw failure('INVALID_RESPONSE');
            log.hidden=true;mtrScroll.hidden=false;
            for(const hop of value.hops){
              if(!Number.isInteger(hop.ttl)||hop.ttl<1||hop.ttl>24)continue;
              const old=hops.get(hop.ttl),address=typeof hop.address==='string'?hop.address.slice(0,64):null;
              const row=old&&(!address||!old.address||old.address===address)?old:{ttl:hop.ttl,address,sent:0,received:0,total:0,timed:0,last:null,best:null,worst:null,destination:false};
              if(hop.sent===1)row.sent++;
              const duration=Number.isFinite(hop.durationMs)&&hop.durationMs>=0&&hop.durationMs<=12000?hop.durationMs:null;
              if(hop.sent===1&&hop.received===1){row.received++;if(duration!==null){row.total+=duration;row.timed++;row.best=row.best===null?duration:Math.min(row.best,duration);row.worst=row.worst===null?duration:Math.max(row.worst,duration);}}
              if(hop.sent===1)row.last=hop.received===1?duration:null;
              row.address=address||row.address;row.destination=hop.destination===true||row.address===value.address;hops.set(hop.ttl,row);
            }
            if(value.destinationReached&&Number.isInteger(value.destinationTtl))for(const ttl of hops.keys())if(ttl>value.destinationTtl)hops.delete(ttl);
            tbody.replaceChildren();
            for(const hop of [...hops.values()].sort((a,b)=>a.ttl-b.ttl)){
              const row=el('tr');row.dataset.destination=String(hop.destination);
              for(const cell of [hop.ttl,(hop.address||'*')+(hop.destination?' ✓':''),hop.sent?((hop.sent-hop.received)/hop.sent*100).toFixed(0)+'%':'—',hop.sent,hop.received,hop.last===null?'—':hop.last.toFixed(1),hop.timed?(hop.total/hop.timed).toFixed(1):'—',hop.best===null?'—':hop.best.toFixed(1),hop.worst===null?'—':hop.worst.toFixed(1)])row.append(el('td','',String(cell)));
              tbody.append(row);
            }
            const endpoint=value.destinationSample;
            if(endpoint?.sent===1){sent++;if(endpoint.received===1&&Number.isFinite(endpoint.durationMs)&&endpoint.durationMs>=0){received++;total+=endpoint.durationMs;}}
            title.textContent='MTR · '+t('netRound')+' '+round+' · '+(value.destinationReached?t('netDestination')+' '+(value.address||value.host):t('netNoDestination'));
            summary();stats.title=t('netDestination')+' · ICMP';
          }else{
            if(!value||!Array.isArray(value.samples)||!value.samples.length||value.samples.length>5)throw failure('INVALID_RESPONSE');
            for(const sample of value.samples){
              sequence++;
              const ok=sample?.ok===true&&Number.isFinite(sample.durationMs)&&sample.durationMs>=0&&sample.durationMs<=12000;
              const networkIcmp=[11002,11003,11004,11005,11009,11013,11014,11015,11016].includes(sample?.statusCode);
              const localError=['platform','local-error'].includes(sample?.errorCode)||(sample?.errorCode==='icmp-error'&&!networkIcmp);
              if(!localError){sent++;if(ok){received++;total+=sample.durationMs;}}
              const status=ok?'time='+sample.durationMs.toFixed(1)+' ms':localError?t('netProbeError'):kind==='ping'?t('netIcmpShort'):t('netUnreachable');
              appendLine(clock()+'  #'+sequence+'  '+String(value.address||value.host||settings.host||'').slice(0,253)+(kind==='tcp'&&value.port?':'+value.port:'')+'  '+status,ok?'good':'warn');
            }
            summary();
          }
          message.textContent=t('netRunning');await sleep(Math.max(0,1000-(performance.now()-roundStarted)),controller.signal);
        }
      }catch(error){if(token===generation){
        const known={
          'Select a node or manual proxy profile, or enter a custom target / 请先切换到节点或手动代理情景，或填写自定义目标':'netCurrentUnavailable',
          'Invalid diagnostic host or port / 检测地址或端口无效':'netInvalidTarget',
          'IPv6 ICMP is not available; use TCPing / 暂不支持 IPv6 ICMP，请使用 TCPing':'netIpv6PingUnavailable',
          'DNS lookup failed or timed out / 地址解析失败或超时':'netDnsUnavailable',
          'IPv6 Ping/MTR is not available; use TCPing / 暂不支持 IPv6 Ping/MTR，请使用 TCPing':'netIpv6PingUnavailable',
          'MTR requires an IPv4 address; use TCPing for IPv6 / MTR 需要 IPv4 地址，IPv6 请使用 TCPing':'netIpv6PingUnavailable',
          'No IPv4 address or DNS lookup timed out / 无可用 IPv4 地址或解析超时':'netDnsUnavailable',
          'MTR requires a unicast IPv4 target / MTR 需要单播 IPv4 目标':'netInvalidTarget',
          'DNS lookup busy; retry later / 地址解析正忙，请稍后重试':'netDnsUnavailable',
          'Cannot start DNS lookup / 无法启动地址解析':'netDnsUnavailable'
        };
        const text=controller.stale||error.code==='STALE'?t('ipStale'):error.code==='CANCELLED'?t('netStopped'):known[error.message]?t(known[error.message]):error.code?errorText(error):error.message||t('ipFailure');
        message.textContent=text;appendLine('> '+text,error.code==='CANCELLED'?'':'error');
      }}finally{if(token===generation){active=null;inputs.forEach(b=>b.disabled=false);cancel.hidden=true;}}
    }
    return {setContext};
  }

  function render(host){stop();const token=generation;let currentContext=null;const shell=el('div','ip-tools-layout'),main=el('section','card ip-check-card'),side=el('section','card ip-links-card');const network=el('section','card ip-network-card');const rail=el('aside','ip-side-column');rail.append(side);shell.append(main,rail,network);host.append(shell);
    const current=el('div','ip-context');current.append(el('span','ip-small muted',t('ipCurrentProfile')),el('strong','',t('loading')));const toolbar=el('div','ip-check-toolbar'),contextBlock=el('div','ip-context-block'),summary=el('div','ip-address-summary');contextBlock.append(current);toolbar.append(contextBlock,summary);main.append(toolbar);
    const disclosure=el('p','ip-disclosure',t('ipDisclosure'));disclosure.id='ip-disclosure';
    const controls=el('div','ip-controls'),mode=el('select');mode.setAttribute('aria-label',t('ipMethod'));mode.setAttribute('aria-describedby','ip-disclosure');for(const [value,text]of [['ipv4','IPv4'],['dual',t('ipDual')]]){const option=el('option','',text);option.value=value;mode.append(option);}mode.value=family;mode.onchange=()=>{family=mode.value;};
    const check=button(t('ipCheck'),run,'button primary'),cancel=button(t('cancel'),()=>active?.abort());check.id='ip-check';cancel.id='ip-cancel';cancel.hidden=true;controls.append(mode,check,cancel);toolbar.append(controls);contextBlock.append(disclosure);
    const result=el('div','ip-result'),message=el('p','ip-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');const notes=noteDetails(t('ipDataDetails'),t('ipPublicPartial'),t('ipRouteCaution'),t('ipDualHelp'),t('ipDurationHelp'));main.append(result,message);
    side.append(el('h2','',t('ipQuality')));
    const loadReport=button(t('ipLoadReport'),queryReport,'button primary');loadReport.id='ip-public-check';loadReport.disabled=true;
    const original=reportButton(t('ipPublicOriginal'),'https://ping0.cc/');original.id='ip-public-original';original.hidden=true;
    const reportActions=el('div','ip-tool-report-actions');reportActions.append(loadReport,original);
    const toolGrid=el('div','ip-tool-grid');
    let previousGroup='';
    for(const tool of [...V2RTools.TOOLS].sort((a,b)=>a.group.localeCompare(b.group))){
      if(previousGroup!==tool.group){toolGrid.append(el('h3','ip-tool-group',t('toolGroup'+tool.group)));previousGroup=tool.group;}
      const entry=button('',()=>V2RTools.open(tool.id,{getCurrentIP:async signal=>{
        const before=await context({signal});
        const cached=latestResult&&latestResult.context.fingerprint===before.fingerprint&&Date.now()-Date.parse(latestResult.checkedAt)<30000;
        const ip=cached?latestResult.ip:(await V2RIP.runCheck({family,signal})).ip;
        const after=await context({signal});if(before.fingerprint!==after.fingerprint)throw new Error('Route changed');return ip;
      }}),'ip-tool-button');entry.dataset.tool=tool.id;
      entry.append(el('strong','',t(tool.key)),el('small','',tool.provider));toolGrid.append(entry);
    }
    side.append(reportActions,toolGrid,noteDetails(t('ipDataDetails'),t('ipQualityPrivacy')));
    function updateReport(){const latest=latestResult;loadReport.disabled=!!active||!latest||!!(currentContext&&currentContext.fingerprint!==latest.context.fingerprint);original.hidden=!latest;if(latest)original.dataset.url=V2RIP.qualityURL(latest.ip);}
    function addressControls(latest){
      const line=el('div','ip-address-line'),address=button('',copyIP,'ip-address-copy'),copy=button('',copyIP,'ip-copy-button ip-copy-icon'),feedback=el('p','ip-copy-feedback');
      let pending=false,reset;
      function copyState(state='ready'){
        const label=t(state==='success'?'ipCopied':state==='pending'?'ipCopying':'ipCopy');
        copy.title=label;copy.setAttribute('aria-label',label);copy.replaceChildren();
        const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
        for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
        const shape=document.createElementNS(ns,'path');shape.setAttribute('d',state==='success'?'M5 12l4 4L19 6':'M9 5V3h12v12h-2M3 7h12v14H3z');svg.append(shape);copy.append(svg);
      }
      copyState();
      address.append(el('code','ip-address',latest.ip));address.title=t('ipCopy');address.setAttribute('aria-label',t('ipCopy')+': '+latest.ip);
      feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.setAttribute('aria-atomic','true');line.append(address,copy);
      async function copyIP(){
        if(pending)return;pending=true;clearTimeout(reset);line.dataset.copyState='pending';copyState('pending');feedback.textContent='';feedback.className='ip-copy-feedback';
        for(const control of [address,copy]){control.setAttribute('aria-disabled','true');control.setAttribute('aria-busy','true');}
        let succeeded=false;
        try{await navigator.clipboard.writeText(latest.ip);succeeded=true;}catch(_){/* Keep the address selectable when clipboard access is denied. */}
        finally{pending=false;}
        // Ignore a clipboard completion for a replaced result, language or page.
        if(token!==generation||!line.isConnected)return;
        for(const control of [address,copy]){control.setAttribute('aria-disabled','false');control.removeAttribute('aria-busy');}
        line.dataset.copyState=succeeded?'success':'error';copyState(succeeded?'success':'ready');feedback.textContent=t(succeeded?'ipCopied':'ipCopyFailed');feedback.classList.toggle('error',!succeeded);
        if(succeeded)reset=setTimeout(()=>{if(token!==generation||!line.isConnected)return;delete line.dataset.copyState;copyState();feedback.textContent='';},2000);
      }
      return [line,feedback];
    }
    const draw=()=>{
      result.replaceChildren();summary.replaceChildren();const latest=latestResult;
      if(latest){
        summary.append(...addressControls(latest));
        const meta=el('div','ip-result-meta');
        meta.append(el('span','','IPv'+latest.ipVersion+' · '+latest.durationMs+' ms'),el('time','',time(latest)));
        meta.title=t('ipDurationHelp');summary.append(meta);
        if(currentContext&&currentContext.fingerprint!==latest.context.fingerprint)result.append(el('p','ip-result-stale ip-small',t('ipStaleResult')));
        const footer=detailRows(result,latest)||el('div','ip-report-footer');
        if(!footer.isConnected)result.append(footer);
        footer.append(button(t('ipReport'),async()=>{
          const report={app:'Proxy V2Route',version:chrome.runtime.getManifest().version,provider:latest.provider,checkedAt:latest.checkedAt,ipVersion:latest.ipVersion,httpDurationMs:latest.durationMs};
          try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));message.textContent=t('ipReportCopied');}catch{message.textContent=t('ipCopyFailed');}
        },'ip-report text-link'),notes);
      }else summary.append(el('p','ip-empty',t('ipNoResult')));
      updateReport();
    };
    const diagnostics=renderNetwork(network,token);const setContext=c=>{currentContext=c;current.lastElementChild.textContent=labelContext(c);diagnostics.setContext(c);draw();};view={draw,message,setContext};draw();context().then(c=>{if(token===generation)setContext(c);}).catch(()=>{if(token===generation)current.lastElementChild.textContent=t('ipContextUnknown');});
    function publicFailure(target){
      message.className='ip-message ip-report-failure';
      const source=reportButton(t('ipViewSource'),V2RIP.qualityURL(target.ip));source.classList.add('ip-source-button');
      message.replaceChildren(document.createTextNode(t('ipReadFailed')+' '),source);
    }
    async function run({automatic=false}={}){
      if(active)return;const controller=new AbortController();active=controller;check.disabled=mode.disabled=true;cancel.hidden=false;message.className='ip-message';message.textContent=t('ipChecking');updateReport();
      try{
        // Automatic visits use existing grants only. A permission request needs a user gesture.
        let reportAllowed=true;
        if(automatic)reportAllowed=await hasPing0Permission(controller.signal);
        else try{await ping0Permission('https://ping0.cc/*',controller.signal);}catch(error){if(error.code!=='PERMISSION')throw error;reportAllowed=false;}
        checkActive(controller);const before=await context({signal:controller.signal});if(token!==generation)return;checkActive(controller);setContext(before);
        const measured=await V2RIP.runCheck({family,signal:controller.signal});if(token!==generation)return;checkActive(controller);
        const after=await context({signal:controller.signal});if(token!==generation)return;checkActive(controller);
        if(controller.stale||before.fingerprint!==after.fingerprint){setContext(after);message.textContent=t('ipStale');return;}
        const target={...measured,context:before};latestResult=target;setContext(after);
        if(!reportAllowed){message.textContent=t('ipPing0Permission');return;}
        try{
          const report=await V2RIP.runPublicReport({ip:target.ip,signal:controller.signal});checkActive(controller);
          const latestContext=await context({signal:controller.signal});if(token!==generation)return;checkActive(controller);
          if(controller.stale||before.fingerprint!==latestContext.fingerprint||latestResult!==target){setContext(latestContext);message.textContent=t('ipStale');return;}
          target.publicReport=report;setContext(latestContext);message.textContent=before.controlled?'':t('externalControl');
        }catch(error){if(token===generation){if(controller.stale||error.code==='CANCELLED')message.textContent=controller.stale?t('ipStale'):errorText(error);else publicFailure(target);}}
      }catch(error){if(token===generation){message.textContent=controller.stale?t('ipStale'):errorText(error);message.className='ip-message'+(error?.code==='CANCELLED'?'':' error');}}
      finally{if(token===generation){active=null;check.disabled=mode.disabled=false;cancel.hidden=true;updateReport();}}
    }
    if(!entryChecked){entryChecked=true;queueMicrotask(()=>{if(token===generation)run({automatic:true});});}
    async function queryReport(){
      if(active||loadReport.disabled)return;
      const target=latestResult,controller=new AbortController();active=controller;check.disabled=mode.disabled=true;cancel.hidden=false;updateReport();message.className='ip-message';message.textContent=t('ipChecking');
      try{await ping0Permission('https://ping0.cc/*',controller.signal);checkActive(controller);const before=await context({signal:controller.signal});if(before.fingerprint!==target.context.fingerprint)throw Object.assign(new Error('stale'),{code:'STALE'});
        const report=await V2RIP.runPublicReport({ip:target.ip,signal:controller.signal});checkActive(controller);const after=await context({signal:controller.signal});if(token!==generation)return;
        if(controller.stale||before.fingerprint!==after.fingerprint||latestResult!==target){message.textContent=t('ipStale');return;}target.publicReport=report;setContext(after);message.textContent='';
      }catch(error){if(token===generation){if(controller.stale||error.code==='STALE'||['PERMISSION','CANCELLED'].includes(error.code))message.textContent=controller.stale||error.code==='STALE'?t('ipStale'):errorText(error);else publicFailure(target);}}
      finally{if(token===generation){active=null;check.disabled=mode.disabled=false;cancel.hidden=true;updateReport();}}
    }
  }
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(key=>key!=='v2routeUi')){configurationEpoch++;if(active){active.stale=true;active.abort();}const target=view;if(target)context().then(c=>{if(view===target)target.setContext(c);}).catch(()=>{});}});
  addEventListener('pagehide',()=>stop(true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)active?.abort();});
  root.V2RIPPanel={render,stop};
})(globalThis);
