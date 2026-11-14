/* Presentation-only ordering: no profile activation or native requests. */
(function(root){
  'use strict';
  const identities=new WeakMap();
  const key=profile=>identities.get(profile)||(profile._zeroRouteSlot?'slot:'+profile._zeroRouteSlot:'name:'+profile.name);
  function sorted(profiles,saved){
    const counts=new Map();for(const profile of profiles)if(profile._zeroRouteSlot)counts.set(profile._zeroRouteSlot,(counts.get(profile._zeroRouteSlot)||0)+1);
    for(const profile of profiles)identities.set(profile,profile._zeroRouteSlot&&counts.get(profile._zeroRouteSlot)===1?'slot:'+profile._zeroRouteSlot:'name:'+profile.name);
    const positions=new Map((Array.isArray(saved)?saved:[]).slice(0,5000).map((value,index)=>[value,index]));
    return profiles.slice().sort((a,b)=>(positions.get(key(a))??10000)-(positions.get(key(b))??10000));
  }
  function attach(host,{save,canStart=()=>true,onError=()=>{},onSaved=()=>{}}){
    let session=null,frame=0,saving=false,suppressClick=false;
    const rows=()=>[...host.children];
    const restore=order=>{host.append(...order);};
    async function commit(before,row){
      const next=rows(),keys=next.map(item=>item.dataset.orderKey);
      if(next.every((item,index)=>item===before[index]))return;
      saving=true;next.forEach(item=>item.disabled=true);
      try{await save(keys);if(host.isConnected)onSaved();}
      catch(error){if(host.isConnected){restore(before);onError(error);}}
      finally{saving=false;if(host.isConnected){rows().forEach(item=>item.disabled=false);row.focus();}}
    }
    function moveAtPoint(){
      const current=session;if(!current?.active)return;
      const box=host.getBoundingClientRect(),distance=current.y-box.top;
      if(distance<18)host.scrollTop-=10;else if(current.y>box.bottom-18)host.scrollTop+=10;
      const target=document.elementFromPoint(current.x,current.y)?.closest('.popup-profile');
      if(target&&target!==current.row&&target.parentElement===host){
        const children=rows();
        if(children.indexOf(target)>children.indexOf(current.row))target.after(current.row);else target.before(current.row);
        try{current.row.setPointerCapture(current.id);}catch(_){}
      }
      frame=requestAnimationFrame(moveAtPoint);
    }
    function finish(cancel=false,event){
      const current=session;if(!current)return;
      session=null;clearTimeout(current.timer);cancelAnimationFrame(frame);delete host.dataset.dragging;current.row.classList.remove('order-dragging');
      if(current.row.hasPointerCapture?.(current.id))current.row.releasePointerCapture(current.id);
      if(!current.active)return;
      suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
      const box=host.getBoundingClientRect(),outside=event&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom);
      if(cancel||outside){restore(current.before);current.row.focus();}else void commit(current.before,current.row);
    }
    function down(event){
      const row=event.target.closest('.popup-profile');
      if(event.button!==0||!row||row.parentElement!==host||row.disabled||saving||!canStart())return;
      finish(true);
      const current={row,id:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,before:rows(),active:false};session=current;
      current.timer=setTimeout(()=>{
        if(session!==current)return;current.active=true;host.dataset.dragging='true';row.classList.add('order-dragging');
        try{row.setPointerCapture(current.id);}catch(_){}
        frame=requestAnimationFrame(moveAtPoint);
      },450);
    }
    function move(event){
      const current=session;if(!current||event.pointerId!==current.id)return;
      if(current.active&&event.buttons===0){finish(true);return;}
      current.x=event.clientX;current.y=event.clientY;
      if(!current.active){if(Math.hypot(current.x-current.startX,current.y-current.startY)>6)finish(true);return;}
      event.preventDefault();
    }
    function up(event){if(session?.id===event.pointerId)finish(false,event);}
    function cancel(event){if(!event||session?.id===event.pointerId)finish(true);}
    function click(event){if(suppressClick||session?.active){event.preventDefault();event.stopImmediatePropagation();}}
    function keyboard(event){
      if(event.key==='Escape'&&session){event.preventDefault();event.stopPropagation();finish(true);return;}
      const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-2,ArrowDown:2}[event.key],row=event.target.closest('.popup-profile');
      if(!event.altKey||!delta||!row||row.parentElement!==host||saving||!canStart())return;
      event.preventDefault();const before=rows(),index=before.indexOf(row),next=index+delta;
      if(next<0||next>=before.length)return;
      const target=before[next];if(delta>0)target.after(row);else target.before(row);void commit(before,row);
    }
    const context=event=>{if(session?.active)event.preventDefault();};
    const hidden=()=>{if(document.hidden)finish(true);};
    const blurred=()=>finish(true);
    host.addEventListener('pointerdown',down);host.addEventListener('click',click,true);host.addEventListener('contextmenu',context);addEventListener('keydown',keyboard);
    addEventListener('pointermove',move,{passive:false});addEventListener('pointerup',up);addEventListener('pointercancel',cancel);document.addEventListener('visibilitychange',hidden);
    addEventListener('blur',blurred);
    addEventListener('pagehide',()=>{finish(true);removeEventListener('pointermove',move);removeEventListener('pointerup',up);removeEventListener('pointercancel',cancel);document.removeEventListener('visibilitychange',hidden);removeEventListener('blur',blurred);removeEventListener('keydown',keyboard);},{once:true});
  }
  root.PopupOrder=Object.freeze({key,sorted,attach});
})(globalThis);
