/* Bounded user-started transfer measurements; no persisted results. */
(function(root){
  'use strict';
  const failure=code=>Object.assign(new Error(code),{code});
  async function upload({bytes=10485760,timeoutMs=60000,signal,onProgress,xhrFactory=()=>new XMLHttpRequest(),clock=()=>performance.now()}={}){
    if(!Number.isInteger(bytes)||bytes<1||bytes>104857600||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||typeof xhrFactory!=='function'||(onProgress!==undefined&&typeof onProgress!=='function'))throw failure('BAD_OPTIONS');
    const started=clock();let total=0;
    while(total<bytes){
      if(signal?.aborted)throw failure('CANCELLED');
      const remaining=timeoutMs-(clock()-started);if(remaining<=0)throw failure('TIMEOUT');
      const amount=Math.min(4*1048576,bytes-total),before=total;
      await new Promise((resolve,reject)=>{
        const xhr=xhrFactory();let settled=false;
        const finish=error=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);xhr.onload=xhr.onerror=xhr.ontimeout=xhr.onabort=null;xhr.upload.onprogress=null;error?reject(failure(error)):resolve();};
        const cancel=()=>{xhr.abort();finish('CANCELLED');};
        xhr.open('POST','https://speed.cloudflare.com/__up');xhr.timeout=Math.max(1,Math.ceil(remaining));xhr.withCredentials=false;
        xhr.upload.onprogress=event=>{if(!settled&&!signal?.aborted)onProgress?.({bytes:before+Math.min(amount,Math.max(0,event.loaded)),limitBytes:bytes});};
        xhr.onload=()=>{if(xhr.status<200||xhr.status>=300){finish('HTTP');return;}total=before+amount;onProgress?.({bytes:total,limitBytes:bytes});finish();};
        xhr.onerror=()=>finish('NETWORK');xhr.ontimeout=()=>finish('TIMEOUT');xhr.onabort=()=>finish('CANCELLED');
        signal?.addEventListener('abort',cancel,{once:true});
        if(signal?.aborted){cancel();return;}
        try{xhr.send(new Uint8Array(amount));}catch{finish('NETWORK');}
      });
    }
    const durationMs=Math.max(1,clock()-started);return {provider:'Cloudflare',bytes:total,limitBytes:bytes,durationMs,mbps:total*8/(durationMs*1000),partial:false};
  }
  function render(body,dialog,signal){
    const t=k=>I18n.t(k),el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
    const controls=el('div','ip-tool-controls speed-controls'),mode=el('select','speed-mode'),size=el('select','speed-size'),start=el('button','button primary speed-start',t('toolStart')),stop=el('button','button subtle speed-stop',t('netStop'));
    mode.setAttribute('aria-label',t('speedMode'));for(const [id,key]of [['both','speedBoth'],['download','speedDownload'],['upload','speedUpload']]){const o=el('option','',t(key));o.value=id;mode.append(o);}
    size.setAttribute('aria-label',t('netDownloadSize'));for(const value of [10,50,100]){const o=el('option','',value+' MiB');o.value=value;size.append(o);}
    start.type=stop.type='button';stop.hidden=true;controls.append(mode,size,start,stop);
    const note=el('p','ip-tool-status speed-budget'),cards=el('div','speed-metrics'),values={},labels={},metrics={};
    for(const [id,key]of [['download','speedDownload'],['upload','speedUpload'],['latency','speedLatency']]){
      const card=el('section','speed-metric');card.dataset.speed=id;values[id]=el('strong','','—');labels[id]=el('small','speed-metric-state');metrics[id]=card;
      card.append(el('span','',t(key)),values[id],labels[id]);cards.append(card);
    }
    const status=el('p','ip-tool-status speed-status');status.setAttribute('role','status');
    body.append(controls,note,cards,status);
    const updateNote=()=>{note.textContent=t('speedBudget').replace('{n}',size.value).replace('{total}',String(Number(size.value)*(mode.value==='both'?2:1)));};mode.onchange=size.onchange=updateNote;updateNote();
    let running=null,timer=0,phase='',received=0,previous=0,previousTime=0;
    const phaseName=()=>t(phase==='download'?'speedDownload':'speedUpload');
    const cleanup=()=>{clearInterval(timer);timer=0;};
    const cancel=()=>{running?.abort();cleanup();};stop.onclick=cancel;signal.addEventListener('abort',cancel,{once:true});
    function tick(){
      if(!running||running.signal.aborted||!dialog.open)return;
      const now=performance.now(),elapsed=now-previousTime;if(elapsed<1)return;
      const rate=(Math.max(0,received-previous)*8/(elapsed*1000)).toFixed(2)+' Mbps/s';
      values[phase].textContent=rate;labels[phase].textContent=t('speedRealtime');
      previous=received;previousTime=now;
    }
    start.onclick=async()=>{
      if(running||signal.aborted||!dialog.open)return;
      running=new AbortController();const controller=running,onAbort=()=>controller.abort();signal.addEventListener('abort',onAbort,{once:true});
      start.disabled=mode.disabled=size.disabled=true;stop.hidden=false;status.classList.remove('error');phase='';
      for(const id of Object.keys(values)){values[id].textContent='—';labels[id].textContent='';delete metrics[id].dataset.phaseState;}
      let partial=false;
      try{
        const samples=[];status.textContent=t('speedLatency');
        for(let i=0;i<3;i++){const x=await V2RIP.runDownload({bytes:65536,timeoutMs:8000,signal:controller.signal});samples.push(x.durationMs);}
        if(controller.signal.aborted)throw failure('CANCELLED');values.latency.textContent=Math.round(samples.reduce((a,b)=>a+b,0)/samples.length)+' ms';
        const phases=mode.value==='both'?['download','upload']:[mode.value];
        for(phase of phases){
          received=previous=0;previousTime=performance.now();metrics[phase].dataset.phaseState='running';values[phase].textContent='0.00 Mbps/s';labels[phase].textContent=t('speedRealtime');
          status.textContent=t('netRunning');timer=setInterval(tick,1000);
          const options={bytes:Number(size.value)*1048576,timeoutMs:Math.max(15000,Math.min(60000,Number(size.value)*1000)),signal:controller.signal,onProgress:p=>{
            if(controller.signal.aborted||!dialog.open)return;
            received=Math.max(received,Math.min(Number(size.value)*1048576,Number(p.bytes)||0));status.textContent=phaseName()+' · '+(received/1048576).toFixed(1)+' / '+size.value+' MiB';
          }};
          let value;
          try{value=await (phase==='download'?V2RIP.runDownload(options):upload(options));}finally{cleanup();}
          if(controller.signal.aborted)throw failure('CANCELLED');if(!dialog.open)return;
          values[phase].textContent=value.mbps.toFixed(2)+' Mbps';labels[phase].textContent=t('speedAverage')+(value.partial?' · '+t('netPartial'):'');metrics[phase].dataset.phaseState=value.partial?'partial':'complete';
          partial=partial||value.partial;
        }
        status.textContent=t(partial?'netPartial':'netComplete');
      }catch(error){
        if(dialog.open){
          if(phase&&metrics[phase].dataset.phaseState==='running'){values[phase].textContent='—';labels[phase].textContent=t(error.code==='CANCELLED'?'netStopped':'toolNoResponse');metrics[phase].dataset.phaseState=error.code==='CANCELLED'?'stopped':'error';}
          status.classList.toggle('error',error.code!=='CANCELLED');status.textContent=t(error.code==='CANCELLED'?'netStopped':error.code==='TIMEOUT'?'ipTimeout':'toolDownloadError');
        }
      }finally{cleanup();signal.removeEventListener('abort',onAbort);running=null;if(dialog.open){start.disabled=mode.disabled=size.disabled=false;stop.hidden=true;}}
    };
  }
  const api=Object.freeze({upload,render});if(typeof module==='object'&&module.exports)module.exports=api;else root.ToolSpeed=api;
})(globalThis);
