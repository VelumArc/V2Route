/* Keep decorative text gradients separate from control surfaces and semantic colours. */
(function(){
  'use strict';
  const selector='#page-title,.nav-label,#content h2,#content h3,#content .node-library-row strong,#content .node-row-meta>span:not(.warning),#modal h2,#content .node-group-tabs button>span,#content .profile-list strong,#content .button:not(.primary):not(.danger):not(.danger-text),.ip-tool-header h2';
  let pending=false;
  function paint(){
    pending=false;
    for(const host of document.querySelectorAll(selector)){
      if(host.closest('.ip-report-failure,.component-status,.ip-result-badge,.network-console')||host.matches('.theme-ink'))continue;
      for(const node of [...host.childNodes])if(node.nodeType===Node.TEXT_NODE&&node.textContent.trim()){
        const span=document.createElement('span');span.className='theme-ink';node.replaceWith(span);span.append(node);
      }
    }
  }
  new MutationObserver(()=>{if(!pending){pending=true;queueMicrotask(paint);}}).observe(document.body,{childList:true,subtree:true});
  paint();
})();
