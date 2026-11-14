/* SPDX-License-Identifier: GPL-3.0-or-later
 * A native session belongs to one page/job. It never changes proxy settings. */
(function(root){
'use strict';
const NODE_COMMANDS=['nodeMeasureStart','nodeMeasurePoll','nodeMeasureCancel'];
function createSession({api=root.chrome,commands=NODE_COMMANDS,timeoutMs=30000}={}){
 const allowed=new Set(commands);
 let port=null,closed=false,active=null,queue=[];
 function fail(reason){
  if(closed)return;
  closed=true;
  const error=reason instanceof Error?reason:new Error(String(reason||'Native session closed / 本地会话已关闭'));
  if(active){clearTimeout(active.timer);active.reject(error);active=null;}
  for(const item of queue)item.reject(error);
  queue=[];
  const previous=port;port=null;
  try{previous?.disconnect();}catch(_){}
 }
 function drain(){
  if(closed||active||!queue.length)return;
  active=queue.shift();
  active.timer=setTimeout(()=>fail(new Error('Native request timed out / 本地请求超时')),timeoutMs);
  try{
   if(!port){
    port=api.runtime.connectNative('local.v2route');
    port.onDisconnect.addListener(()=>{
     // Reading lastError suppresses browser warnings; do not expose native logs.
     void api.runtime.lastError;
     fail(new Error('Native session disconnected / 本地会话已断开'));
    });
    port.onMessage.addListener(message=>{
     if(closed||!active)return;
     const item=active;clearTimeout(item.timer);active=null;
     if(!message||message.ok!==true||!Object.hasOwn(message,'result')){
      item.reject(new Error(typeof message?.error==='string'?message.error:'Invalid native response / 本地组件返回无效'));
     }else item.resolve(message.result);
     drain();
    });
   }
   port.postMessage({command:active.command,settings:active.settings});
  }catch(_){fail(new Error('Native component unavailable / 本地组件不可用'));}
 }
 function request(command,settings={}){
  if(closed)return Promise.reject(new Error('Native session closed / 本地会话已关闭'));
  if(!allowed.has(command)||!settings||typeof settings!=='object'||Array.isArray(settings))return Promise.reject(new Error('Invalid native request / 本地请求无效'));
  if(queue.length>=32)return Promise.reject(new Error('Too many pending requests / 等待请求过多'));
  return new Promise((resolve,reject)=>{queue.push({command,settings,resolve,reject});drain();});
 }
 return {request,close:()=>fail(new Error('Native session closed / 本地会话已关闭')),get closed(){return closed;}};
}
const api={create:createSession};
root.V2RNativeClient=api;
root.V2RNodeMeasure={create:options=>createSession({...options,commands:NODE_COMMANDS})};
if(typeof module==='object'&&module.exports)module.exports={...api,NODE_COMMANDS};
})(typeof globalThis==='object'?globalThis:this);

