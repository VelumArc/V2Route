/* Local folder navigation is read-only. Choosing returns a draft, never saves. */
(function(root){
  'use strict';
  let active=null;
  const t=key=>I18n.t(key);
  function node(tag,cls,text){const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;}
  function open({path='',rpc=V2R.rpc}={}){
    active?.close();
    return new Promise(resolve=>{
      const opener=document.activeElement,dialog=node('dialog','folder-picker'),head=node('header','folder-picker-head'),title=node('h2','',t('folderTitle')),hint=node('p','folder-picker-hint',t('folderHint'));
      title.id='folder-picker-title';const titleText=node('span','theme-ink',title.textContent),titleIcon=document.createElementNS('http://www.w3.org/2000/svg','svg'),titlePath=document.createElementNS('http://www.w3.org/2000/svg','path');
      for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))titleIcon.setAttribute(key,value);
      titlePath.setAttribute('d','M3 6h6l2 2h10v12H3V6Z');titleIcon.append(titlePath);title.replaceChildren(titleIcon,titleText);dialog.setAttribute('aria-labelledby',title.id);head.append(title,hint);
      const controls=node('form','folder-picker-controls'),address=node('input'),go=node('button','button subtle',t('folderGo'));
      address.type='text';address.value=path;address.placeholder=t('folderPath');address.setAttribute('aria-label',t('folderPath'));address.autocomplete='off';address.spellcheck=false;go.type='submit';controls.append(address,go);
      const nav=node('nav','folder-picker-nav'),up=node('button','button subtle',t('folderUp')),drives=node('button','button subtle',t('folderDrives')),current=node('button','button subtle',t('folderCurrent'));
      for(const b of [up,drives,current])b.type='button';nav.append(up,drives,current);
      const status=node('p','folder-picker-status'),list=node('div','folder-picker-list'),footer=node('footer','folder-picker-footer'),cancel=node('button','button subtle',t('cancel')),choose=node('button','button primary',t('folderChoose'));
      status.setAttribute('role','status');status.setAttribute('aria-live','polite');list.setAttribute('aria-label',t('folderList'));cancel.type=choose.type='button';footer.append(cancel,choose);dialog.append(head,controls,nav,status,list,footer);
      let selected=null,state=null,serial=0,busy=false;
      const enabled=()=>{address.disabled=busy;go.disabled=busy;up.disabled=busy||!state?.parent;drives.disabled=busy;current.disabled=busy||!path;choose.disabled=busy||!state?.selectable||address.value!==state?.path;};
      async function load(value){
        const request=++serial;busy=true;state=null;list.replaceChildren();status.textContent=t('loading');status.classList.remove('error');enabled();
        try{
          const data=await rpc('v2routeBrowseV2Folder',[{path:value}]);if(!dialog.open||request!==serial)return;
          state=data;address.value=data.path;
          const entries=data.path?data.folders.map(name=>({label:name,path:data.path.replace(/[\\/]$/,'')+'\\'+name})):data.roots.map(value=>({label:value,path:value}));
          for(const entry of entries){const row=node('button','folder-picker-row'),icon=node('span','folder-picker-icon'),label=node('span','',entry.label);row.type='button';icon.setAttribute('aria-hidden','true');row.append(icon,label);row.onclick=()=>load(entry.path);list.append(row);}
          status.textContent=t(data.truncated?'folderTruncated':data.selectable?'folderReady':data.path?'folderInvalid':'folderSelectDrive');
          if(!entries.length&&data.path)list.append(node('p','folder-picker-empty',t('folderEmpty')));
        }catch{if(dialog.open&&request===serial){status.textContent=t('folderUnavailable');status.classList.add('error');}}
        finally{if(dialog.open&&request===serial){busy=false;enabled();}}
      }
      controls.onsubmit=e=>{e.preventDefault();if(!busy)load(address.value.trim());};address.oninput=enabled;
      up.onclick=()=>load(state.parent);drives.onclick=()=>load('');current.onclick=()=>load(path);cancel.onclick=()=>dialog.close();
      choose.onclick=async()=>{
        if(choose.disabled)return;const request=++serial,validatingPath=state.path;busy=true;enabled();status.textContent=t('folderValidating');
        try{const checked=await rpc('v2routeBrowseV2Folder',[{path:validatingPath,validate:true}]);if(!dialog.open||request!==serial||state?.path!==validatingPath)return;if(!checked.valid){status.textContent=t('folderInvalidConfig');status.classList.add('error');return;}selected=checked.path;dialog.close();}
        catch{if(dialog.open&&request===serial){status.textContent=t('folderUnavailable');status.classList.add('error');}}
        finally{if(dialog.open&&request===serial){busy=false;enabled();}}
      };
      dialog.addEventListener('close',()=>{serial++;dialog.remove();if(active===dialog)active=null;if(!active&&opener?.isConnected)opener.focus();resolve(selected);},{once:true});
      document.body.append(dialog);active=dialog;dialog.showModal();address.focus();load(path);
    });
  }
  root.V2RFolderPicker=Object.freeze({open});
  addEventListener('pagehide',()=>active?.close());addEventListener('hashchange',()=>active?.close());
})(globalThis);
