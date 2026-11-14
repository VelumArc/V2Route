"""Read-only v2rayN routes and non-secret shared settings."""
import json
import outbound_adapter
import re
import sqlite3
from contextlib import closing
import unicodedata
from pathlib import Path
from route_labels import describe
import discovery
import node_import
import library_store
import explicit_chain

ROOT = Path(__file__).resolve().parent
HOST_SETTINGS = ROOT / 'data/host-settings.json'

PORT = 11809
MODES = ('ph', 'default')
BINDING_ID = re.compile(r'(?:ph|default|zo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
SETTINGS = Path(__file__).resolve().parent/'settings.json'
PROTOCOLS = {1:'vmess',3:'shadowsocks',4:'socks',5:'vless',6:'trojan',10:'http'}
# Display names are separate from the explicitly implemented translator map.
CONFIG_TYPE_NAMES = {**PROTOCOLS,2:'Custom',7:'Hysteria2',8:'TUIC',9:'WireGuard',
    10:'HTTP',11:'AnyTLS',12:'Naive',13:'自定义出站',14:'MASQUE',
    101:'策略组',102:'代理链'}
UNSUPPORTED_TYPE_MESSAGES = {
    7:'当前增强版尚未适配 Hysteria2（不是本机缺少核心）',
    8:'当前增强版尚未接入 TUIC 所需的 sing-box 核心',
    13:'当前增强版尚未适配自定义出站配置',
}

def default_settings():
    return {'version':1,'revision':0,'group_order':[],'buttons':{},'ports':{}}

def normalize_settings(value):
    if not isinstance(value,dict) or value.get('version') != 1:
        raise ValueError('设置格式不正确')
    revision=value.get('revision')
    if type(revision) is not int or revision<0: raise ValueError('设置版本不正确')
    buttons=value.get('buttons',{})
    if not isinstance(buttons,dict) or any(not isinstance(slot,str) or not BINDING_ID.fullmatch(slot) for slot in buttons):
        raise ValueError('线路绑定标识不正确')
    order=value.get('group_order',[])
    if not isinstance(order,list) or len(order)>1000 or any(not isinstance(g,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',g) for g in order) or len(order)!=len(set(order)):
        raise ValueError('分组排序格式不正确')
    result={'version':1,'revision':revision,'group_order':order,'buttons':{}}
    for slot in buttons:
        b=buttons[slot]
        name=b.get('label','') if isinstance(b,dict) else ''
        name=name.strip() if isinstance(name,str) else ''
        route=b.get('route','') if isinstance(b,dict) else ''
        if not 1<=len(name)<=128 or any(unicodedata.category(c).startswith('C') for c in name):
            raise ValueError('按钮名称需要 1–128 个可见字符')
        if not isinstance(route,str) or (route!='follow' and not re.fullmatch(r'node:[A-Za-z0-9_-]{1,128}',route)):
            raise ValueError('请选择有效线路')
        predecessor=b.get('predecessor','inherit')
        if predecessor not in ('inherit','none') and (not isinstance(predecessor,str) or not re.fullmatch(r'node:[A-Za-z0-9_-]{1,128}',predecessor)):
            raise ValueError('请选择有效前置代理')
        if route=='follow' and predecessor not in ('inherit','none'):raise ValueError('跟随 v2rayN 时前置由 v2rayN 管理')
        result['buttons'][slot]={'label':name,'route':route,'predecessor':predecessor}
        if 'chain' in b:
            result['buttons'][slot]['chain']=explicit_chain.normalize(route,b['chain'])
            result['buttons'][slot]['predecessor']='none'
    ports=value.get('ports',{})
    if not isinstance(ports,dict) or any(slot not in buttons or type(port) is not int or not 1024<=port<=65535 for slot,port in ports.items()) or len(set(ports.values()))!=len(ports):
        raise ValueError('线路端口记录不正确')
    result['ports']=dict(ports)
    return result

def load_settings():
    return normalize_settings(json.loads(SETTINGS.read_text(encoding='utf-8'))) if SETTINGS.exists() else default_settings()

def location():
    report = discovery.inspect_candidates()
    options = json.loads(HOST_SETTINGS.read_text(encoding='utf-8')) if HOST_SETTINGS.exists() else {}
    bundled = ROOT / 'cores/xray/xray.exe'
    core = options.get('corePath') or (str(bundled) if bundled.is_file() else report.get('core_path'))
    if core and not Path(core).is_file(): core = None
    return {**report, 'core_path': core, 'core_available': bool(core)}
def core_path():
    core = location()['core_path']
    if not core: raise ValueError('Xray core is unavailable; install the companion package / 缺少 Xray 核心，请安装配套本地组件')
    return Path(core)
def snapshot(root=None, discover=True):
    selected = root if root is not None else location()['selected'] if discover else None
    gui={'CoreBasicItem': {}, 'Inbound': []};nodes={};groups={}
    if selected:
        root=Path(selected)
        gui=json.loads((root/'guiConfigs/guiNConfig.json').read_text(encoding='utf-8-sig'))
        with closing(sqlite3.connect((root/'guiConfigs/guiNDB.db').as_uri()+'?mode=ro',uri=True)) as db:
            db.row_factory=sqlite3.Row
            nodes={str(r['IndexId']):dict(r) for r in db.execute('SELECT * FROM ProfileItem')}
            groups={str(r['Id']):dict(r) for r in db.execute('SELECT * FROM SubItem')}
    library=library_store.read();local=library['nodes']
    if set(local)&set(nodes):raise ValueError('Node identifier collision / 节点标识冲突')
    nodes.update(local)
    for ident,group in library_store.groups(library).items():
        if ident in groups:raise ValueError('Group identifier collision / 分组标识冲突')
        groups[ident]={'Remarks':group['name'],'PrevProfile':'','NextProfile':'','_source':'local'}
    return gui,nodes,groups

def build_choice(choice,data=None,predecessor='inherit',chain=None):
    gui,nodes,groups=data or snapshot()
    if chain is not None and choice!='follow':
        config,meta=explicit_chain.build(choice,(gui,nodes,groups),chain,translate)
        config['inbounds']=[{'tag':'chrome','listen':'127.0.0.1','port':PORT,'protocol':'socks','settings':{'auth':'noauth','udp':False}}]
        return config,{'listen':f'127.0.0.1:{PORT}',**meta}
    if chain is not None:explicit_chain.normalize(choice,chain)
    meta={'listen':f'127.0.0.1:{PORT}','chain':[],'chain_values':[]}
    if choice=='follow':
        if predecessor not in ('inherit','none'):raise ValueError('跟随 v2rayN 时前置由 v2rayN 管理')
        if not gui.get('Inbound'):raise ValueError('v2rayN is unavailable; select an imported node / 未找到 v2rayN，请选择导入节点')
        port=int(gui['Inbound'][0]['LocalPort'])
        if not 1<=port<=65535: raise ValueError('v2rayN 本地端口无效')
        outbounds=[{'tag':'exit','protocol':'socks','settings':{'servers':[{'address':'127.0.0.1','port':port}]}}]
        meta['upstream_port']=port
    else:
        node=nodes.get(choice.removeprefix('node:'))
        if node is None: raise ValueError('线路已不存在，请重新选择')
        outbounds=[];seen=set()
        def inherited_parent(n,group):
            reference=str(group.get('PrevProfile') or '').strip() if group else ''
            if not reference:return None
            # v2rayN group references belong to its own database. A separately
            # imported same-name node must not create false ambiguity or hijack it.
            external=[p for p in nodes.values() if p.get('_source')!='local']
            by_id=[p for p in external if str(p['IndexId'])==reference]
            matches=by_id or [p for p in external if str(p.get('Remarks') or '').strip()==reference]
            if len(matches)!=1:raise ValueError('前置代理名称不存在或重名，请在前置设置中指定节点')
            return matches[0]
        def add(n,tag,override='inherit'):
            if n['IndexId'] in seen or len(seen)>=6: raise ValueError('前置代理循环或超过六层')
            seen.add(n['IndexId'])
            group=groups.get(str(n['Subid']))
            if group and group['NextProfile']: raise ValueError('此分组包含尚未支持的后置代理')
            if override=='none':parent=None
            elif override=='inherit':parent=inherited_parent(n,group)
            elif isinstance(override,str) and override.startswith('node:'):
                parent=nodes.get(override[5:])
                if parent is None:raise ValueError('指定的前置代理已不存在，请重新选择')
            else:raise ValueError('前置代理设置无效')
            ob=translate(n,tag,gui);outbounds.append(ob)
            if parent:
                pretag=f'pre-{len(seen)}'
                ob['streamSettings'].setdefault('sockopt',{})['dialerProxy']=pretag
                extra=ob['streamSettings'].get('xhttpSettings',{}).get('extra',{})
                if isinstance(extra,dict) and isinstance(extra.get('downloadSettings'),dict):
                    extra['downloadSettings'].setdefault('sockopt',{})['dialerProxy']=pretag
                add(parent,pretag)
            meta['chain'].append(n['Remarks'])
            meta['chain_values'].append('node:'+str(n['IndexId']))
        add(node,'exit',predecessor)
    return {'log':{'loglevel':'error','access':'none'},'inbounds':[{'tag':'chrome','listen':'127.0.0.1','port':PORT,
      'protocol':'socks','settings':{'auth':'noauth','udp':False}}],'outbounds':outbounds},meta

def build(mode,settings=None):
    settings=settings or load_settings()
    if mode not in settings['buttons']: raise ValueError('Unknown binding')
    binding=settings['buttons'][mode]
    config,meta=build_choice(binding['route'],predecessor=binding.get('predecessor','inherit'),chain=binding.get('chain'))
    return config,{'mode':mode,**meta}

def catalog():
    report=location();read_error=''
    try:
        data=snapshot(report['selected'],discover=False);gui,nodes,groups=data
    except (OSError,ValueError,sqlite3.Error):
        data=snapshot(discover=False);gui,nodes,groups=data
        read_error='v2rayN configuration is unreadable / v2rayN 配置暂时无法读取'
    settings=load_settings();positions={g:i for i,g in enumerate(settings.get('group_order',[]))}
    items=[{'value':'follow','label':'Follow v2rayN / 跟随 v2rayN','group':'Quick actions / 快捷选项','group_id':'follow','supported':bool(gui.get('Inbound')),'chain':[],
      'source':'v2rayn','country':None,'suggested_label':'Follow v2rayN',
      'reason':'' if gui.get('Inbound') else 'v2rayN is unavailable / 未找到 v2rayN'}]
    for ident,n in nodes.items():
        item={'value':'node:'+ident,'label':n['Remarks'] or '未命名节点',
          'group':groups.get(str(n['Subid']),{}).get('Remarks') or '未分组',
          'group_id':str(n['Subid']) or '_ungrouped',
          'protocol':n.get('_outbound',{}).get('protocol') or CONFIG_TYPE_NAMES.get(n['ConfigType'],'未适配类型'),'supported':True,
          'source':'local' if n.get('_source')=='local' else 'v2rayn'}
        item.update(describe(item['label'],item['group']))
        if n.get('_source')=='local':
            item.update(origin_kind='subscription' if n.get('_subscription') else 'manual',
                        subscription_id=n.get('_subscription'),stale=bool(n.get('_subscription_stale')))
        try: _,meta=build_choice(item['value'],data);item['chain']=meta['chain'];item['chain_values']=meta['chain_values']
        except (ValueError,KeyError,TypeError) as exc:
            item.update(supported=False,reason=str(exc),override_supported=False)
            try:
                # A broken inherited predecessor must not make an otherwise
                # supported endpoint impossible to select with an override.
                build_choice(item['value'],data,'none')
                item['override_supported']=True
            except (ValueError,KeyError,TypeError):pass
        try:translate(n,'chain-check',gui);item['chain_supported']=True
        except (ValueError,KeyError,TypeError):item['chain_supported']=False
        items.append(item)
    items[1:]=sorted(items[1:],key=lambda n:(positions.get(n['group_id'],1001),n['group'].casefold(),n['label'].casefold(),n['value']))
    public_groups={ident:{'id':ident,'name':group.get('Remarks') or '未分组',
       'source':'local' if group.get('_source')=='local' else 'v2rayn',
       'readonly':group.get('_source')!='local' or ident==library_store.DEFAULT_GROUP,
       'count':sum(item.get('group_id')==ident for item in items[1:])} for ident,group in groups.items()}
    for item in items[1:]:
        if item['group_id'] not in public_groups:
            public_groups[item['group_id']]={'id':item['group_id'],'name':item['group'],'source':item['source'],'readonly':True,'count':sum(r.get('group_id')==item['group_id'] for r in items[1:])}
    ordered_groups=sorted(public_groups.values(),key=lambda group:(positions.get(group['id'],1001),group['name'].casefold(),group['id']))
    return {'ok':True,'settings':settings,'routes':items,'groups':ordered_groups,'discovery':report,'error':read_error,
            'hostSettings':{'v2raynRoot':report.get('selected'),'corePath':report.get('core_path')}}

def translate(n,tag,gui):
    """Compatibility entry point; compilation lives in the independent adapter."""
    if n.get('_source')=='local' and isinstance(n.get('_outbound'),dict):
        from proxy_import_formats import validate_outbound
        return {'tag':tag,**validate_outbound(n['_outbound'])}
    kind=n.get('ConfigType')
    if kind not in PROTOCOLS:
        raise ValueError(UNSUPPORTED_TYPE_MESSAGES.get(kind,'当前增强版尚未适配此线路类型'))
    return outbound_adapter.compile_record(n,tag,gui)
