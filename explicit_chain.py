"""Ordered entry-to-exit paths, independent of inherited v2rayN groups."""
import re,ipaddress

NODE=re.compile(r'node:[A-Za-z0-9_-]{1,128}')

def reject_entrance_loops(config,ports):
    def check(host,port):
        if port not in ports:return
        host=str(host or '').strip('[]').rstrip('.').lower()
        try:
            ip=ipaddress.ip_address(host);local=ip.is_loopback or bool(getattr(ip,'ipv4_mapped',None) and ip.ipv4_mapped.is_loopback)
        except ValueError:local=host=='localhost'
        if local:raise ValueError('A chain hop points to this tool entrance / 链路节点指向本工具入口，会形成循环')
    for outbound in config['outbounds']:
        proxy=outbound.get('settings',{});stream=outbound.get('streamSettings',{})
        for endpoint in [proxy,*proxy.get('servers',[]),*proxy.get('vnext',[])]:check(endpoint.get('address'),endpoint.get('port'))
        for name in ('xhttpSettings','splithttpSettings'):
            extra=stream.get(name,{}).get('extra',{})
            download=extra.get('downloadSettings',{}) if isinstance(extra,dict) else {}
            if isinstance(download,dict):check(download.get('address'),download.get('port'))
        for peer in proxy.get('peers',[]):
            endpoint=peer.get('endpoint','')
            if isinstance(endpoint,str) and ':' in endpoint:
                host,port=endpoint.rsplit(':',1)
                if port.isdecimal():check(host,int(port))

def normalize(route,chain):
    if not isinstance(route,str) or (route!='follow' and not NODE.fullmatch(route)):
        raise ValueError('Invalid exit node / 落地节点无效')
    if not isinstance(chain,list) or any(not isinstance(x,str) or not NODE.fullmatch(x) for x in chain):
        raise ValueError('Invalid chain nodes / 链式代理节点无效')
    if route=='follow' and chain:raise ValueError('Follow v2rayN manages its own chain / 跟随 v2rayN 时由它管理代理链')
    return list(chain)

def own_sockets(stream,previous):
    def assign(value):
        value.pop('dialerProxy',None)
        if previous:value['dialerProxy']=previous
    def visit(value):
        if isinstance(value,dict):
            if value.get('echConfigList'):
                assign(value.setdefault('echSockopt',{}))
            for key,item in value.items():
                if key in ('sockopt','echSockopt') and isinstance(item,dict):assign(item)
                else:visit(item)
        elif isinstance(value,list):
            for item in value:visit(item)
    assign(stream.setdefault('sockopt',{}))
    for name in ('xhttpSettings','splithttpSettings'):
        extra=stream.get(name,{}).get('extra',{})
        if isinstance(extra,dict) and isinstance(extra.get('downloadSettings'),dict):
            assign(extra['downloadSettings'].setdefault('sockopt',{}))
    visit(stream)

def build(route,data,chain,translate):
    chain=normalize(route,chain)
    if route=='follow':raise ValueError('Select an exit node / 请选择落地节点')
    gui,nodes,_=data;choices=chain+[route];outbounds=[];names=[]
    for index,choice in enumerate(choices):
        node=nodes.get(choice.removeprefix('node:'))
        if node is None:raise ValueError(f'Chain hop {index+1} is missing / 第 {index+1} 层节点已不存在')
        tag='exit' if index==len(choices)-1 else f'chain-{index}'
        outbound=translate(node,tag,gui)
        # Explicit order owns normal, split-download and ECH bootstrap sockets.
        own_sockets(outbound.setdefault('streamSettings',{}),f'chain-{index-1}' if index else None)
        outbounds.append(outbound);names.append(str(node.get('Remarks') or choice))
    # Default outbound stays the exit; dialers connect backwards to the entry.
    return {'log':{'loglevel':'error','access':'none'},'inbounds':[],
            'outbounds':list(reversed(outbounds))},{'chain':names,'chain_values':choices}
