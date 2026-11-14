/* Stable DOM pointer sorting. A drag changes markers, never captured rows. */
(function(root) {
  'use strict';
  const {groups, move, routeLabel, routeIcon} = V2R, t = key => I18n.t(key);
  const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls;if(text!=null)n.textContent=text;return n; };
  let pickerSequence=0;
  class RoutePicker {
    constructor(host, options) {
      this.host=host;this.options=options;this.value=options.value||'follow';this.catalog=options.catalog;this.active=null;this.query='';this.drag=null;this.suppressClick=false;this.build();
    }
    build() {
      this.host.replaceChildren();this.host.classList.add('route-picker');
      this.trigger=el('button','route-trigger');this.trigger.type='button';this.trigger.setAttribute('aria-haspopup','dialog');this.trigger.setAttribute('aria-expanded','false');
      this.trigger.onclick=()=>this.toggle();this.host.append(this.trigger);
      this.menu=el('div','route-menu');this.menu.id='route-picker-'+(++pickerSequence);this.trigger.setAttribute('aria-controls',this.menu.id);this.menu.hidden=true;this.menu.setAttribute('role','dialog');this.menu.setAttribute('aria-label',t('selectRoute'));
      const searchbar=el('div','route-search');this.search=el('input');this.search.type='search';this.search.placeholder=t('searchRoutes');this.search.setAttribute('aria-label',t('searchRoutes'));this.search.oninput=()=>{this.cancelDrag();this.query=this.search.value.trim().toLocaleLowerCase();this.renderGroups();};
      const refresh=el('button','icon-button','↻');refresh.type='button';refresh.title=t('refresh');refresh.setAttribute('aria-label',t('refresh'));refresh.onclick=async()=>{if(!this.options.onRefresh)return;refresh.disabled=true;try{const next=await this.options.onRefresh();this.update(next.catalog||next,this.value);this.hint.textContent=t('groupHint');}catch(error){this.options.onError?.(error);}finally{refresh.disabled=false;}};
      const close=el('button','icon-button','×');close.type='button';close.title=t('close');close.setAttribute('aria-label',t('close'));close.onclick=()=>this.close();searchbar.append(this.search,refresh,close);
      const columns=el('div','route-columns');this.list=el('div','route-groups');this.list.setAttribute('role','group');this.list.setAttribute('aria-label',t('selectGroup'));this.nodes=el('div','route-nodes');this.nodes.setAttribute('role','group');this.nodes.setAttribute('aria-label',t('selectRoute'));columns.append(this.list,this.nodes);
      this.hint=el('div','route-hint',t('groupHint'));this.hint.setAttribute('role','status');this.menu.append(searchbar,columns,this.hint);this.host.append(this.menu);
      this.menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.drag?this.cancelDrag(true):this.close();}});
      this.nodes.addEventListener('keydown',event=>{
        if(event.key==='ArrowLeft'){event.preventDefault();this.rows().find(row=>row.dataset.groupId===this.active)?.focus();}
        else this.navigateRows(event,[...this.nodes.querySelectorAll('button:not(:disabled)')]);
      });
      this.list.addEventListener('pointerdown',event=>this.down(event));
      this.list.addEventListener('pointermove',event=>this.motion(event));
      this.list.addEventListener('pointerup',event=>this.up(event));
      this.list.addEventListener('pointercancel',()=>this.cancelDrag(true));
      this.list.addEventListener('lostpointercapture',()=>{if(this.drag)this.cancelDrag(true);});
      this.list.addEventListener('dragstart',event=>event.preventDefault());
      this.outsidePointer=event=>{if(!this.menu.hidden&&!this.drag&&!event.composedPath().includes(this.host))this.close(false);};
      document.addEventListener('pointerdown',this.outsidePointer,true);
      this.renderTrigger();this.renderGroups();
    }
    allGroups() { const hidden=new Set(this.options.hiddenValues||[]);return groups(this.catalog.routes.filter(r=>!hidden.has(r.value)),this.catalog.settings.group_order); }
    selectable(route) { return route.supported!==false||(this.options.allowPredecessorOverride===true&&route.override_supported===true); }
    selected() { return this.catalog.routes.find(r=>r.value===this.value); }
    renderTrigger() {
      const r=this.selected(),label=r?routeLabel(r):this.value==='unselected'&&this.options.placeholder?this.options.placeholder:t('routeMissing');this.trigger.replaceChildren();this.trigger.title=label;this.trigger.setAttribute('aria-label',t('selectRoute')+': '+label);
      const image=el('img','route-icon');image.src=routeIcon(r);image.alt='';
      const chevron=el('span','chevron','⌄');chevron.setAttribute('aria-hidden','true');this.trigger.append(image,el('span','grow',label),chevron);
    }
    toggle() { if(this.menu.hidden){this.menu.hidden=false;this.trigger.setAttribute('aria-expanded','true');this.search.focus();}else this.close(); }
    close(returnFocus=true) { this.cancelDrag();this.menu.hidden=true;this.trigger.setAttribute('aria-expanded','false');if(returnFocus)this.trigger.focus(); }
    update(catalog,value) { this.catalog=catalog;if(value!==undefined)this.value=value;this.renderTrigger();this.renderGroups(); }
    choose(route) { if(!this.selectable(route))return;this.value=route.value;this.renderTrigger();this.close();this.options.onChange(route); }
    renderGroups() {
      this.list.replaceChildren();const query=this.query;
      const follow=this.catalog.routes.find(r=>r.value==='follow');
      if(follow&&(!query||(routeLabel(follow)+' '+t('follow')).toLowerCase().includes(query))){const b=this.row(t('follow'),routeIcon(follow));b.classList.add('fixed-group');b.disabled=follow.supported===false;b.title=follow.reason||t('follow');b.setAttribute('aria-pressed',String(this.value==='follow'));b.onkeydown=event=>this.navigateRows(event,[...this.list.querySelectorAll('button:not(:disabled)')]);b.onclick=()=>this.choose(follow);this.list.append(b);}
      this.visible=this.allGroups().map(g=>({...g,routes:!query||g.name.toLocaleLowerCase().includes(query)?g.routes:g.routes.filter(r=>(routeLabel(r)+' '+(r.suggested_label||'')).toLocaleLowerCase().includes(query))})).filter(g=>g.routes.length);
      for(const group of this.visible){
        const b=this.row(group.name);b.dataset.groupId=group.id;b.classList.toggle('selected-group',group.id===this.active);b.title=group.name;
        const grip=el('span','drag-grip','⠿');grip.setAttribute('aria-hidden','true');const chevron=el('span','chevron','›');chevron.setAttribute('aria-hidden','true');b.prepend(grip);b.append(chevron);
        b.onpointerenter=()=>{if(!this.drag?.active)this.activate(group.id);};b.onfocus=()=>{if(!this.drag?.active)this.activate(group.id);};
        b.onclick=()=>{if(this.suppressClick){this.suppressClick=false;return;}this.activate(group.id);};
        b.onkeydown=event=>this.key(event,group);this.list.append(b);
      }
      if(!this.visible.some(g=>g.id===this.active))this.active=this.visible[0]?.id||null;
      this.activate(this.active);
    }
    row(text,icon) { const b=el('button','group-row');b.type='button';if(icon){const image=el('img','route-icon');image.src=icon;image.alt='';b.append(image);}b.append(el('span','grow',text));return b; }
    activate(id) {
      this.active=id;for(const row of this.list.querySelectorAll('[data-group-id]')){row.classList.toggle('selected-group',row.dataset.groupId===id);row.setAttribute('aria-pressed',String(row.dataset.groupId===id));}
      this.nodes.replaceChildren();const g=this.visible.find(g=>g.id===id);if(!g){this.nodes.append(el('p','empty',t('empty')));return;}
      this.nodes.append(el('div','node-heading',g.name+' · '+g.routes.length+' '+t('nodeCount')));
      for(const route of g.routes){const b=this.row(routeLabel(route),routeIcon(route));b.className='node-row';b.dataset.route=route.value;b.disabled=!this.selectable(route);b.classList.toggle('chosen',route.value===this.value);b.setAttribute('aria-pressed',String(route.value===this.value));b.title=route.reason||routeLabel(route);if(route.value===this.value){const check=el('span','check','✓');check.setAttribute('aria-hidden','true');b.append(check);}if(route.supported===false)b.append(el('span','badge',t(this.selectable(route)?'preConfigure':'unavailable')));b.onclick=()=>this.choose(route);this.nodes.append(b);}
    }
    rows() { return [...this.list.querySelectorAll('[data-group-id]')]; }
    down(event) {
      if(event.button!==0||this.saving)return;const row=event.target.closest('[data-group-id]');if(!row)return;
      if(this.query){this.hint.textContent=t('searchSort');return;}
      this.cancelDrag();this.drag={id:event.pointerId,group:row.dataset.groupId,startX:event.clientX,startY:event.clientY,active:false,order:this.allGroups().map(g=>g.id),target:row.dataset.groupId,after:false};
      this.drag.timer=setTimeout(()=>{if(!this.drag)return;this.drag.active=true;row.classList.add('dragging');this.list.classList.add('sorting');this.hint.textContent=t('dragHint');try{this.list.setPointerCapture(event.pointerId);}catch(_){}},450);
    }
    motion(event) {
      const d=this.drag;if(!d||event.pointerId!==d.id)return;
      if(!d.active){if(Math.hypot(event.clientX-d.startX,event.clientY-d.startY)>10)this.cancelDrag();return;}
      event.preventDefault();const rect=this.list.getBoundingClientRect();
      if(event.clientY<rect.top+28)this.list.scrollTop-=16;else if(event.clientY>rect.bottom-28)this.list.scrollTop+=16;
      this.clearMarkers();const rows=this.rows().filter(r=>r.dataset.groupId!==d.group);
      let target=rows.find(r=>event.clientY<r.getBoundingClientRect().bottom);if(!target)target=rows.at(-1);if(!target)return;
      const bounds=target.getBoundingClientRect();d.target=target.dataset.groupId;d.after=event.clientY>bounds.top+bounds.height/2;target.classList.add(d.after?'drop-after':'drop-before');
    }
    up(event) {
      const d=this.drag;if(!d||event.pointerId!==d.id)return;const order=move(d.order,d.group,d.target,d.after);this.cancelDrag();
      if(d.active){this.suppressClick=true;setTimeout(()=>this.suppressClick=false,0);if(JSON.stringify(order)!==JSON.stringify(d.order))this.saveOrder(order);}
    }
    clearMarkers() { for(const r of this.rows())r.classList.remove('drop-before','drop-after'); }
    cancelDrag(feedback=false) {
      const d=this.drag;if(!d)return;this.drag=null;clearTimeout(d.timer);this.clearMarkers();for(const r of this.rows())r.classList.remove('dragging');this.list.classList.remove('sorting');try{this.list.releasePointerCapture(d.id);}catch(_){}if(feedback)this.hint.textContent=t('orderCancelled');
    }
    async saveOrder(order) {
      if(this.saving)return;this.saving=true;this.list.classList.add('saving');
      const fullOrder=groups(this.catalog.routes,this.catalog.settings.group_order).map(g=>g.id),visible=new Set(order);let i=0;const mergedOrder=fullOrder.map(id=>visible.has(id)?order[i++]:id);
      try{
        const result=await this.options.onOrder(mergedOrder,this.catalog.settings.revision),focused=document.activeElement;
        const focusGroup=this.list.contains(focused)?focused.closest('[data-group-id]')?.dataset.groupId:null,focusFollow=this.list.contains(focused)&&focused.classList.contains('fixed-group'),focusRoute=this.nodes.contains(focused)?focused.closest('[data-route]')?.dataset.route:null,scrollTop=this.list.scrollTop;
        this.catalog=result.catalog||result;this.renderGroups();this.hint.textContent=t('orderSaved');
        // Restore only the item that still owned focus when the response arrived.
        // A pending save must not pull focus back from another control or page.
        if(!this.menu.hidden){if(focusGroup)this.rows().find(r=>r.dataset.groupId===focusGroup)?.focus({preventScroll:true});else if(focusFollow)this.list.querySelector('.fixed-group')?.focus({preventScroll:true});else if(focusRoute)[...this.nodes.querySelectorAll('[data-route]')].find(r=>r.dataset.route===focusRoute)?.focus({preventScroll:true});}
        this.list.scrollTop=scrollTop;
      }
      catch(error){this.hint.textContent=error.message;this.options.onError?.(error);}
      finally{this.saving=false;this.list.classList.remove('saving');}
    }
    key(event,group) {
      if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();if(this.query){this.hint.textContent=t('searchSort');return;}const order=this.allGroups().map(g=>g.id),i=order.indexOf(group.id),j=i+(event.key==='ArrowUp'?-1:1);if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];this.saveOrder(order);}
      else if(event.key==='ArrowRight'){event.preventDefault();this.activate(group.id);this.nodes.querySelector('button:not(:disabled)')?.focus();}
      else this.navigateRows(event,[...this.list.querySelectorAll('button:not(:disabled)')]);
    }
    navigateRows(event,rows) {if(event.altKey||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const index=rows.indexOf(event.target.closest('button'));if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?rows.length-1:index+(event.key==='ArrowUp'?-1:1);rows[next]?.focus();}
    destroy() { this.cancelDrag();document.removeEventListener('pointerdown',this.outsidePointer,true);this.host.replaceChildren(); }
  }
  root.RoutePicker=RoutePicker;
})(globalThis);
