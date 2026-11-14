"""Additional proxy import formats, normalized to private core outbounds.

No subscription fetch, executable content or local file references are accepted.
The bundled core performs a second configuration check before atomic persistence.
"""
import base64
from copy import deepcopy
import ipaddress
import json
import re
from urllib.parse import urlsplit, parse_qsl, unquote

PROTOCOLS = {'http', 'socks', 'vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria', 'wireguard', 'masque'}
SETTINGS_KEYS = {
    'http': {'address','port','user','pass','servers','headers','level','email'},
    'socks': {'address','port','user','pass','servers','level','email'},
    'vmess': {'address','port','id','security','experiments','level','email','vnext'},
    'vless': {'address','port','id','encryption','flow','seed','level','email','vnext'},
    'trojan': {'address','port','password','flow','servers','level','email'},
    'shadowsocks': {'address','port','method','password','servers','level','email'},
    'hysteria': {'version','address','port'},
    'wireguard': {'secretKey','address','peers','mtu','reserved','remoteDNS','noKernelTun'},
    'masque': {'address','port','remoteDNS'},
}
STREAM_KEYS = {'address','port','network','method','security','tlsSettings','realitySettings',
    'rawSettings','tcpSettings','wsSettings','grpcSettings','httpupgradeSettings','xhttpSettings',
    'splithttpSettings','kcpSettings','hysteriaSettings','masqueSettings','xdriveSettings','sockopt','finalmask'}

def check_fields(value, allowed):
    if not isinstance(value,dict) or set(value)-set(allowed):
        fail('Unsupported nested proxy fields','代理包含未支持的嵌套字段')

def validate_nested(protocol, settings, stream):
    # Xray intentionally tolerates unknown JSON keys. Reject misspelled account,
    # endpoint and security fields here so a valid core check cannot hide them.
    if 'servers' in settings or 'vnext' in settings:
        if any(k in settings for k in ('address','port','user','pass','password','id')):
            fail('Use either a flat endpoint or a server list','服务器参数请使用平铺格式或列表中的一种')
        key='servers' if 'servers' in settings else 'vnext'
        for server in settings[key] if isinstance(settings[key],list) else [None]:
            if protocol in ('http','socks','vmess','vless'):
                check_fields(server,{'address','port','users'})
                if 'users' in server:
                    users=server['users']
                    if not isinstance(users,list) or len(users)!=1:fail('Use one account per proxy','每个代理须使用一个账号')
                    fields={'user','pass'} if protocol in ('http','socks') else SETTINGS_KEYS[protocol]-{'address','port','vnext'}
                    for user in users:check_fields(user,fields)
            else:check_fields(server,SETTINGS_KEYS[protocol]-{'servers'})
    if protocol=='wireguard':
        for peer in settings.get('peers',[]):check_fields(peer,{'publicKey','preSharedKey','endpoint','keepAlive','allowedIPs','level','email'})
    if 'tlsSettings' in stream:
        tlsvalue=stream['tlsSettings']
        check_fields(tlsvalue,{'allowInsecure','certificates','serverName','alpn','enableSessionResumption','disableSystemRoot','minVersion','maxVersion','cipherSuites','fingerprint','rejectUnknownSni','curvePreferences','pinnedPeerCertSha256','verifyPeerCertByName','echServerKeys','echConfigList','echSockopt','useSystemCA'})
        for cert in tlsvalue.get('certificates',[]):check_fields(cert,{'certificate','key','usage','ocspStapling','oneTimeLoading','buildChain'})
    if 'realitySettings' in stream:
        check_fields(stream['realitySettings'],{'show','fingerprint','serverName','password','publicKey','shortId','mldsa65Verify','spiderX'})
    if 'hysteriaSettings' in stream:check_fields(stream['hysteriaSettings'],{'version','auth','udpIdleTimeout'})
    if 'masqueSettings' in stream:check_fields(stream['masqueSettings'],{'host','path','user','pass','headers','warp','xmux'})


def fail(en, zh):
    raise ValueError(en+' / '+zh)


def api():
    import node_import
    return node_import


def pairs(query):
    try:
        entries=parse_qsl(query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        fail('Invalid URI parameters', '链接参数无效')
    if len(dict(entries)) != len(entries):
        fail('Duplicate URI parameters', '链接参数重复')
    return {k:api().text(v,'parameter') for k,v in entries}


def credential(value):
    return api().text(unquote(value or ''), 'credential', 8192)


def identity(record):
    import hashlib
    data={k:v for k,v in record.items() if k not in ('IndexId','Remarks')}
    record['IndexId']='local-'+hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()[:32]
    return record


def record(outbound, label=''):
    outbound=validate_outbound(outbound)
    address,port=endpoint(outbound)
    kind=outbound['protocol']
    return identity({'IndexId':'','ConfigType':13,'Address':address,'Port':port,
        'Password':'','Username':'','Remarks':api().text(label or kind.upper()+' proxy','name',200),
        'Subid':'local-imports','_source':'local','_outbound':outbound})


def endpoint(outbound):
    settings=outbound['settings']
    if outbound['protocol']=='wireguard':
        peers=settings.get('peers') or []
        if not peers or not isinstance(peers[0],dict):fail('WireGuard peer is required','缺少 WireGuard 对端')
        value=peers[0].get('endpoint','')
        u=urlsplit('proxy://'+str(value))
        address,port=u.hostname,u.port
    else:
        server=settings
        for key in ('servers','vnext'):
            if key in settings:
                values=settings[key]
                if not isinstance(values,list) or len(values)!=1 or not isinstance(values[0],dict):
                    fail('Use one endpoint per imported proxy','每个导入代理须包含一个服务器')
                server=values[0]
        address,port=server.get('address'),server.get('port')
    return api().host(address),api().integer(port,'port',1,65535)


def validate_outbound(value):
    if not isinstance(value,dict):fail('Invalid outbound JSON','出站 JSON 无效')
    unknown=set(value)-{'protocol','settings','streamSettings','mux','tag','name','remarks','packetEncoding'}
    if unknown:fail('Unsupported outbound fields','出站包含未支持的字段')
    protocol=value.get('protocol')
    if protocol not in PROTOCOLS:fail('Protocol is not supported by the bundled Xray core','随包 Xray 核心不支持此协议')
    settings=value.get('settings')
    if not isinstance(settings,dict) or set(settings)-SETTINGS_KEYS[protocol]:
        fail('Invalid or unsupported protocol settings','协议参数无效或尚未支持')
    result={k:deepcopy(v) for k,v in value.items() if k not in ('tag','name','remarks')}
    stream=result.setdefault('streamSettings',{})
    if not isinstance(stream,dict) or set(stream)-STREAM_KEYS:fail('Unsupported transport fields','传输参数尚未支持')
    validate_nested(protocol,settings,stream)
    # External node files are data, never an instruction to read another file,
    # open an interface, or reference a different locally configured outbound.
    def inspect(obj,depth=0):
        if depth>18:fail('Proxy JSON is too deeply nested','代理 JSON 嵌套过深')
        if isinstance(obj,dict):
            for key,item in obj.items():
                if key.lower().endswith(('file','filepath')) or key in ('dir','dialerProxy','outboundTag','interface','masterKeyLog'):
                    fail('File and external route references are not allowed in imports','导入不接受本地文件或外部线路引用')
                inspect(item,depth+1)
        elif isinstance(obj,list):
            if len(obj)>512:fail('Proxy JSON array is too large','代理 JSON 数组过大')
            for item in obj:inspect(item,depth+1)
        elif isinstance(obj,str):api().text(obj,'JSON value',32768)
        elif obj is not None and type(obj) not in (bool,int,float):fail('Invalid JSON value','JSON 值无效')
    inspect(result)
    endpoint(result)
    # A node is an outbound, never a system TUN. Force the userspace WG backend.
    if protocol=='wireguard':settings=result['settings'];settings['noKernelTun']=True
    return result


def tls(options, default=False):
    security=options.get('security') or ('tls' if default else 'none')
    if security not in ('none','tls','reality'):fail('Unsupported security','不支持此安全类型')
    for name in ('insecure','allowInsecure','skip-cert-verify'):
        if options.get(name) not in (None,'','0','false','False'):
            fail('Certificate verification must remain enabled','必须保留证书验证')
    if security=='none':
        if any(options.get(k) for k in ('sni','peer','fp','pbk','sid','spx','alpn')):
            fail('TLS fields require TLS or Reality','TLS 字段需要 TLS 或 Reality')
        return {}
    if security!='reality' and any(options.get(k) for k in ('pbk','sid','spx')):
        fail('Reality fields require Reality','Reality 字段需要 Reality')
    detail={}
    for old,new in (('sni','serverName'),('peer','serverName'),('fp','fingerprint'),('pbk','publicKey'),('sid','shortId'),('spx','spiderX')):
        if options.get(old):detail[new]=options[old]
    if options.get('alpn'):detail['alpn']=options['alpn'].split(',')
    return {'security':security,security+'Settings':detail}


def transport(options, default_tls=False):
    network=options.get('type') or 'raw'
    if network=='tcp':network='raw'
    if network not in ('raw','ws','grpc','httpupgrade','xhttp','kcp'):
        fail('Unsupported transport','不支持此传输类型')
    applicable={'host':('ws','httpupgrade','xhttp'),'path':('ws','httpupgrade','xhttp'),
        'serviceName':('grpc',),'authority':('grpc',),'mode':('grpc','xhttp'),'seed':('kcp',),'headerType':('kcp',)}
    for key,networks in applicable.items():
        if options.get(key) and network not in networks:
            fail('Parameter does not apply to the selected transport','参数不适用于所选传输类型')
    if network=='grpc' and options.get('mode','') not in ('','gun','multi'):
        fail('Invalid gRPC mode','gRPC mode 无效')
    if network=='xhttp' and options.get('mode','auto') not in ('auto','packet-up','stream-up','stream-one'):
        fail('Invalid XHTTP mode','XHTTP mode 无效')
    result={'network':network,**tls(options,default_tls)}
    detail={}
    if network in ('ws','httpupgrade','xhttp'):
        for key in ('host','path'):
            if options.get(key):detail[key]=options[key]
        if network=='xhttp':detail['mode']=options.get('mode','auto')
    elif network=='grpc':
        detail={'serviceName':options.get('serviceName',''),'authority':options.get('authority',''),
            'multiMode':options.get('mode')=='multi'}
    elif network=='kcp':
        if options.get('seed'):detail['seed']=options['seed']
        detail['header']={'type':options.get('headerType') or 'none'}
    if detail:result[network+'Settings']=detail
    return result


def normalize_socks_uri(link):
    scheme=link.split('://',1)[0].lower()
    if '://' in link:link=scheme+'://'+link.split('://',1)[1]
    if scheme in ('socks','socks5','socks5h'):
        # v2rayN shares SOCKS credentials as Base64(user:password) before @.
        match=re.match(r'^[^:]+://([^@?#\s]+)@(.+)$',link)
        if match and ':' not in match[1]:
            try:decoded=api().b64(unquote(match[1]))
            except ValueError:decoded=''
            if ':' in decoded:
                from urllib.parse import quote
                user,secret=decoded.split(':',1)
                link=scheme+'://'+quote(user,safe='')+':'+quote(secret,safe='')+'@'+match[2]

    return link


def parse_uri(link):
    # Scheme-less vendor account lines have a documented HTTP default.
    if '://' not in link:
        if '@' in link:link='http://'+link
        else:
            m=re.fullmatch(r'(\[[^\]]+\]|[^:\s]+):(\d+)(?::([^:]+):(.*))?',link)
            if not m:fail('Expected a proxy link or host:port:user:password','请填写代理链接或 地址:端口:账号:密码')
            from urllib.parse import quote
            login=(quote(m[3],safe='')+':'+quote(m[4],safe='')+'@') if m[3] is not None else ''
            link='http://'+login+m[1]+':'+m[2]
    scheme=link.split('://',1)[0].lower()
    if scheme in ('socks4','socks4a'):
        fail('SOCKS4 is browser-manual only; bundled core supports SOCKS5','SOCKS4 请用浏览器手动代理；随包核心仅支持 SOCKS5')
    if scheme=='ss':return parse_ss(link)
    link=normalize_socks_uri(link)
    try:
        u=urlsplit(link);address=api().host(u.hostname)
        port=api().integer(u.port if u.port is not None else (80 if scheme=='http' else 443 if scheme in ('https','trojan','hysteria2','hy2') else 0),'port',1,65535)
        options=pairs(u.query);label=unquote(u.fragment)
        username,password=credential(u.username),credential(u.password)
        if u.path not in ('','/'):fail('Use a query parameter for transport paths','传输路径请放在链接参数中')
        if scheme in ('http','https','socks','socks5','socks5h'):
            api().unknown_fields(options,{'sni','peer','alpn','fp','security','insecure','allowInsecure'})
            if bool(username)!=bool(password):fail('Both username and password are required','账号和密码须同时填写')
            protocol='http' if scheme in ('http','https') else 'socks'
            settings={'address':address,'port':port}
            if username:settings.update(user=username,**{'pass':password})
            return record({'protocol':protocol,'settings':settings,'streamSettings':{'network':'raw',**tls(options,scheme=='https')}},label)
        if scheme=='trojan':
            api().unknown_fields(options,{'security','type','sni','peer','fp','alpn','pbk','sid','spx','host','path','serviceName','authority','mode','insecure','allowInsecure','seed','headerType'})
            secret=credential((u.username or '')+(':'+u.password if u.password is not None else ''))
            if not secret:fail('Trojan password is required','缺少 Trojan 密码')
            return record({'protocol':'trojan','settings':{'address':address,'port':port,'password':secret},'streamSettings':transport(options,True)},label)
        if scheme in ('hysteria2','hy2'):
            api().unknown_fields(options,{'sni','peer','insecure','allowInsecure','obfs','obfs-password','pinSHA256','alpn','mport','up','down'})
            secret=credential(u.username+(':'+u.password if u.password is not None else '')) if u.username else ''
            stream={'network':'hysteria',**tls(options,True),'hysteriaSettings':{'version':2,'auth':secret}}
            if options.get('pinSHA256'):stream['tlsSettings']['pinnedPeerCertSha256']=options['pinSHA256']
            if options.get('obfs-password') and not options.get('obfs'):
                fail('Obfuscation password requires an obfuscation method','混淆密码需要同时设置混淆方法')
            if options.get('obfs'):
                if options['obfs']!='salamander' or not options.get('obfs-password'):fail('Invalid Hysteria obfuscation','Hysteria 混淆参数无效')
                stream['finalmask']={'udp':[{'type':'salamander','settings':{'password':options['obfs-password']}}]}
            if options.get('mport') or options.get('up') or options.get('down'):
                fail('Use Xray JSON for Hysteria port hopping or bandwidth settings','Hysteria 端口跳跃或带宽参数请使用 Xray JSON')
            return record({'protocol':'hysteria','settings':{'address':address,'port':port,'version':2},'streamSettings':stream},label)
        if scheme in ('wireguard','wg'):
            api().unknown_fields(options,{'publickey','publicKey','presharedkey','preSharedKey','address','mtu','reserved','keepalive','allowedIPs'})
            peer={'publicKey':options.get('publickey') or options.get('publicKey',''),'endpoint':('['+address+']' if ':' in address else address)+':'+str(port)}
            if options.get('presharedkey') or options.get('preSharedKey'):peer['preSharedKey']=options.get('presharedkey') or options['preSharedKey']
            if options.get('keepalive'):peer['keepAlive']=api().integer(options['keepalive'],'keepalive',0,65535)
            if options.get('allowedIPs'):peer['allowedIPs']=options['allowedIPs'].split(',')
            settings={'secretKey':username,'peers':[peer],'noKernelTun':True}
            if options.get('address'):settings['address']=options['address'].split(',')
            if options.get('mtu'):settings['mtu']=api().integer(options['mtu'],'mtu',576,65535)
            if options.get('reserved'):settings['reserved']=[api().integer(x,'reserved',0,255) for x in options['reserved'].split(',')]
            return record({'protocol':'wireguard','settings':settings},label)
    except (TypeError,ValueError) as exc:
        if isinstance(exc,ValueError) and ' / ' in str(exc):raise
        fail('Invalid proxy URI','代理链接无效')
    fail('Unsupported protocol; use a bundled-core outbound JSON where available','不支持此链接协议；核心支持的协议可使用出站 JSON')


def parse_ss(link):
    payload=link[5:];main,sep,fragment=payload.partition('#')
    if '@' not in main:
        main=api().b64(main)
    u=urlsplit('ss://'+main)
    options=pairs(u.query)
    if options.get('plugin'):fail('Shadowsocks plugins require an unavailable plugin runtime','Shadowsocks 插件需要未集成的插件运行时')
    api().unknown_fields(options,{'plugin'})
    login=unquote(u.username or '')
    if u.password is None:
        login=api().b64(login)
    else:login+=':'+unquote(u.password)
    method,sep,password=login.partition(':')
    if not sep or not password:fail('Invalid Shadowsocks credentials','Shadowsocks 密钥无效')
    return record({'protocol':'shadowsocks','settings':{'address':api().host(u.hostname),
        'port':api().integer(u.port,'port',1,65535),'method':method,'password':password}},unquote(fragment))


def parse_object(value):
    if not isinstance(value,dict):fail('Expected a proxy object','请提供代理对象')
    if 'protocol' in value and 'settings' in value:
        return record(value,value.get('name') or value.get('remarks') or value.get('tag',''))
    # Common JSON account records (Clash-style fields accepted as a single proxy).
    kind=value.get('type') or value.get('protocol') or value.get('scheme')
    kind={'socks':'socks5','ss':'shadowsocks','hy2':'hysteria2'}.get(kind,kind)
    address=value.get('server') or value.get('host') or value.get('address')
    port=value.get('port') or value.get('server_port')
    name=value.get('name') or value.get('remarks','')
    if kind in ('http','https','socks5'):
        api().unknown_fields(value,{'type','protocol','scheme','server','host','address','port','server_port','username','password','user','pass','name','remarks','tls','sni','udp','skip-cert-verify'})
        from urllib.parse import quote,urlencode
        username=value.get('username',value.get('user',''));password=value.get('password',value.get('pass',''))
        username=api().text(username,'username',8192);password=api().text(password,'password',8192)
        login=quote(username,safe='')+':'+quote(password,safe='')+'@' if username or password else ''
        address=api().host(address);address='['+address+']' if ':' in address else address
        options={}
        if value.get('tls'):options['security']='tls'
        if value.get('sni'):options['sni']=value['sni']
        if value.get('skip-cert-verify'):options['insecure']='1'
        return parse_uri(kind+'://'+login+address+':'+str(port)+('?' + urlencode(options) if options else '')+'#'+quote(name))
    if kind=='shadowsocks':
        api().unknown_fields(value,{'type','protocol','server','address','port','server_port','cipher','method','password','name','remarks','udp'})
        return record({'protocol':'shadowsocks','settings':{'address':address,'port':port,'method':value.get('cipher',value.get('method')),'password':value.get('password')}},name)
    fail('Use a share link or Xray outbound JSON for this proxy object','此代理对象请使用分享链接或 Xray 出站 JSON')


def parse_document(value):
    value=value.strip()
    if value.startswith('```'):
        value=re.sub(r'^```(?:json|text)?\s*\n','',value,flags=re.I)
        value=re.sub(r'\n```\s*$','',value).strip()
    if value.startswith(('{','[')):
        try:data=json.loads(value,object_pairs_hook=api().unique_object,parse_constant=lambda _:fail('Nonfinite JSON number','JSON 数值无效'))
        except (json.JSONDecodeError,RecursionError):fail('Invalid proxy JSON','代理 JSON 无效')
        if isinstance(data,dict) and 'outbounds' in data:data=data['outbounds']
        elif isinstance(data,dict) and 'proxies' in data:data=data['proxies']
        values=data if isinstance(data,list) else [data]
        # Routing-only builtins are not remote proxy nodes.
        values=[v for v in values if not isinstance(v,dict) or v.get('protocol') not in ('freedom','blackhole','dns','loopback')]
        return values
    if '://' not in value and re.fullmatch(r'[A-Za-z0-9_+/=\s-]+',value):
        try:
            decoded=api().b64(re.sub(r'\s','',value))
            if '://' in decoded:return [x.strip() for x in decoded.splitlines() if x.strip()]
        except ValueError:pass
    return [line.strip() for line in value.splitlines() if line.strip()]
