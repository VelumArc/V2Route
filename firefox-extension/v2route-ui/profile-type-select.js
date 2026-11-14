/* Accessible glass control for profile type; the native select owns its value. */
(function(root){
  'use strict';
  let sequence=0;
  function mount(select,{label}={}){
    const field=select.parentElement,id='profile-type-'+(++sequence),control=document.createElement('div'),trigger=document.createElement('button'),text=document.createElement('span'),arrow=document.createElement('span'),menu=document.createElement('div');
    const original={hidden:select.hidden,tabIndex:select.getAttribute('tabindex'),ariaHidden:select.getAttribute('aria-hidden'),labelFor:field.getAttribute('for'),value:Object.getOwnPropertyDescriptor(select,'value')};
    const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    let opened=false,destroyed=false,active=-1,rows=[],search='',searchedAt=0;
    control.className='profile-type-control';trigger.className='profile-type-trigger';trigger.type='button';trigger.id=id;trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id+'-menu');trigger.setAttribute('aria-autocomplete','none');
    text.className='profile-type-value';arrow.className='profile-type-arrow';arrow.setAttribute('aria-hidden','true');trigger.append(text,arrow);
    menu.className='profile-type-menu';menu.id=id+'-menu';menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label||select.getAttribute('aria-label')||'');
    select.before(control);control.append(select,trigger,menu);select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');if(field.tagName==='LABEL')field.htmlFor=id;
    function enabled(){return rows.map((row,index)=>!row.option.disabled?index:-1).filter(index=>index>=0);}
    function focusOption(index){
      if(index<0||!rows[index]||rows[index].option.disabled)return;active=index;
      rows.forEach((row,i)=>row.element.classList.toggle('is-active',i===active));
      trigger.setAttribute('aria-activedescendant',rows[index].element.id);
      rows[index].element.scrollIntoView({block:'nearest'});
    }
    function close(focus=false){
      opened=false;menu.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');
      document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);
      if(focus&&!destroyed&&trigger.isConnected&&!trigger.disabled)trigger.focus();
    }
    function open(index=select.selectedIndex){
      if(destroyed||select.disabled||trigger.closest('[inert]'))return;
      sync();opened=true;menu.hidden=false;trigger.setAttribute('aria-expanded','true');trigger.focus();
      const choices=enabled();focusOption(choices.includes(index)?index:choices[0]);
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    }
    function choose(index){
      const item=rows[index];if(!item||item.option.disabled||select.disabled)return;
      const changed=select.value!==item.option.value;select.value=item.option.value;close(true);
      if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    function outside(event){if(!event.composedPath().includes(control))close();}
    function escape(event){if(opened&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}}
    function sync(){
      if(destroyed)return;
      text.textContent=select.selectedOptions[0]?.textContent||'';trigger.setAttribute('aria-label',(label?label+': ':'')+text.textContent);trigger.disabled=select.disabled;
      rows.forEach((row,index)=>{row.element.setAttribute('aria-selected',String(index===select.selectedIndex));row.element.setAttribute('aria-disabled',String(row.option.disabled));});
      if(select.disabled)close();
    }
    function rebuild(){
      menu.replaceChildren();rows=Array.from(select.options,(option,index)=>{
        const element=document.createElement('div'),name=document.createElement('span'),check=document.createElement('span');
        element.className='profile-type-option';element.id=id+'-option-'+index;element.setAttribute('role','option');element.dataset.value=option.value;name.textContent=option.textContent;check.className='profile-type-check';check.setAttribute('aria-hidden','true');element.append(name,check);menu.append(element);
        element.addEventListener('pointermove',()=>{if(opened&&!option.disabled)focusOption(index);});
        element.addEventListener('click',event=>{event.preventDefault();choose(index);});return {option,element};
      });sync();if(opened)focusOption(select.selectedIndex);
    }
    trigger.addEventListener('click',event=>{event.preventDefault();opened?close():open();});
    trigger.addEventListener('keydown',event=>{
      const choices=enabled();if(!choices.length)return;
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();if(event.altKey&&event.key==='ArrowUp'){close(true);return;}
        if(event.key==='Home'||event.key==='End'){const index=event.key==='Home'?choices[0]:choices.at(-1);opened?focusOption(index):open(index);}
        else if(!opened)open();
        else{const at=choices.indexOf(active),next=Math.max(0,Math.min(choices.length-1,at+(event.key==='ArrowDown'?1:-1)));focusOption(choices[next]);}
      }else if(event.key==='Enter'||event.key===' '){event.preventDefault();opened?choose(active):open();}
      else if(event.key==='Tab')close();
      else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        const now=performance.now();search=now-searchedAt<700?search+event.key:event.key;searchedAt=now;
        const find=query=>choices.find(index=>rows[index].option.textContent.trim().toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
        let index=find(search);if(index===undefined){search=event.key;index=find(search);}if(index!==undefined){event.preventDefault();opened?focusOption(index):open(index);}
      }
    });
    control.addEventListener('focusout',event=>{if(opened&&!control.contains(event.relatedTarget))close();});
    menu.addEventListener('pointerdown',event=>event.preventDefault());
    select.addEventListener('change',sync);select.addEventListener('input',sync);
    Object.defineProperty(select,'value',{configurable:true,enumerable:descriptor.enumerable,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});
    const optionObserver=new MutationObserver(rebuild);optionObserver.observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','selected','label']});
    const ownerObserver=new MutationObserver(()=>{if(!control.isConnected)destroy();});ownerObserver.observe(document.documentElement,{childList:true,subtree:true});
    function destroy(){
      if(destroyed)return;close();destroyed=true;optionObserver.disconnect();ownerObserver.disconnect();select.removeEventListener('change',sync);select.removeEventListener('input',sync);
      if(original.value)Object.defineProperty(select,'value',original.value);else delete select.value;
      select.hidden=original.hidden;for(const [key,value]of [['tabindex',original.tabIndex],['aria-hidden',original.ariaHidden]])value===null?select.removeAttribute(key):select.setAttribute(key,value);
      if(field.tagName==='LABEL')original.labelFor===null?field.removeAttribute('for'):field.setAttribute('for',original.labelFor);
      if(control.isConnected){control.before(select);control.remove();}
    }
    rebuild();return Object.freeze({sync,destroy});
  }
  root.V2RProfileTypeSelect=Object.freeze({mount});
})(globalThis);
