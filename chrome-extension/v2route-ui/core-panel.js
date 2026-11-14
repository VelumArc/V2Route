/* On-demand companion core status and repair. GPL-3.0-or-later. */
(function(root){
  'use strict';
  const strings={
    en:{title:'Proxy core',checking:'Checking the local component…',ready:'Xray is ready',missing:'Proxy core is missing',
      external:'A custom core is available',intro:'The complete Windows package includes Xray. v2rayN is optional.',
      verify:'Check again',install:'Install / repair core',installing:'Downloading and verifying…',done:'Core verified and ready',
      help:'Repair uses a pinned official Xray release and verifies its checksum. Existing connections stay running.',
      absent:'Install the local component once, then return here to check the core.',download:'Installation guide',
      absentHelp:'Use the matching Windows package or follow the guide to build it from source, then run setup.',
      failed:'Core operation failed. Try again or use the complete Windows package.'},
    zh:{title:'代理核心',checking:'正在检查本地组件…',ready:'Xray 核心已就绪',missing:'缺少代理核心',
      external:'自定义核心可用',intro:'Windows 完整包已包含 Xray，无需安装 v2rayN。',verify:'重新检查',
      install:'安装／修复核心',installing:'正在下载并校验…',done:'核心已校验，可正常使用',
      help:'修复使用固定版本的官方 Xray 并校验文件，当前连接保持运行。',
      absent:'请先安装一次本地组件，再返回检查核心。',download:'安装说明',
      absentHelp:'使用配套 Windows 包，或按说明从源码构建，然后运行安装器。',
      failed:'操作失败，可重试或使用 Windows 完整包。'}
  };
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  function create(){
    const language=I18n.language==='zh'?'zh':'en',t=k=>strings[language][k];
    const panel=el('section','card core-panel'),state=el('p','component-status',t('checking')),
      detail=el('small','muted'),actions=el('div','setup-actions'),notice=el('p','muted');
    state.setAttribute('role','status');state.setAttribute('aria-live','polite');
    panel.append(el('h2','',t('title')),el('p','muted',t('intro')),state,detail,actions,notice);
    const check=el('button','button subtle',t('verify')),install=el('button','button primary',t('install')),
      download=el('a','button subtle',t('download'));
    check.type=install.type='button';download.href='https://github.com/VelumArc/V2Route/blob/main/INSTALL.md';
    download.target='_blank';download.rel='noopener noreferrer';
    actions.append(check,install,download);download.hidden=true;install.disabled=true;
    let busy=false,sequence=0;
    function errorText(error){const parts=String(error?.message||'').split(' / ');return parts[language==='zh'&&parts.length>1?1:0]||t('failed');}
    async function run(repair=false){
      if(busy)return;busy=true;const ticket=++sequence;
      check.disabled=install.disabled=true;panel.setAttribute('aria-busy','true');
      state.classList.remove('error');state.textContent=t(repair?'installing':'checking');
      try{
        const response=await V2R.rpc(repair?'v2routeInstallCore':'v2routeCoreStatus'),value=response?.result||response;
        if(ticket!==sequence)return;
        if(!value||typeof value.installed!=='boolean')throw new Error(t('absent'));
        state.textContent=t(value.verified?(repair?'done':'ready'):value.installed?'external':'missing');
        detail.textContent=value.version||'';detail.title=value.path||'';
        install.hidden=!!value.verified;install.disabled=false;download.hidden=true;
        notice.textContent=t('help');
      }catch(error){
        if(ticket!==sequence)return;
        state.textContent=repair?errorText(error):t('absent');state.classList.add('error');
        detail.textContent=repair?'':errorText(error);install.hidden=!repair;install.disabled=false;
        download.hidden=false;notice.textContent=t(repair?'failed':'absentHelp');
      }finally{busy=false;check.disabled=false;panel.removeAttribute('aria-busy');}
    }
    check.onclick=()=>run();install.onclick=()=>run(true);run();return panel;
  }
  root.V2RCorePanel={create};
})(globalThis);
