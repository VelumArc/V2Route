"""Private subscription/group operations for one-shot native hosts.

Network work happens outside the library lock. Public replies never include
subscription URLs, account credentials, core outbounds or raw network errors.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
import uuid
import library_store as store
import node_import
import subscription_fetch as net
import subscription_formats as parser

POLICIES = {'proxy-first', 'proxy-only', 'direct-only'}
MAX_TOTAL = 2000
MAX_SUBSCRIPTIONS = 100
MAX_GROUPS = 1000


def _now():
    return int(time.time() * 1000)


def _error(code):
    raise ValueError(code)


def _request(value, fields):
    if not isinstance(value, dict) or set(value) - set(fields):
        _error('INVALID_LIBRARY_REQUEST')


def _name(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 128 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        _error('INVALID_NAME')
    return value.strip()


def _revision(data, value):
    if value.get('revision') is not None and (type(value['revision']) is not int or value['revision'] != data['revision']):
        _error('LIBRARY_CHANGED')


def _secure():
    # Production storage gets the same current-user/SYSTEM-only ACL as the
    # companion. Isolated tests replace STORE and never touch application data.
    if os.name == 'nt' and node_import.STORE.parent == node_import.ROOT / 'private':
        import backend
        backend.secure_storage()


def _group_id(data, value):
    if not isinstance(value, str) or value not in store.groups(data):
        _error('GROUP_NOT_FOUND')
    return value


def _new_group(data, name):
    if len(data['groups']) >= MAX_GROUPS:
        _error('GROUP_LIMIT')
    ident = 'local-group-' + uuid.uuid4().hex
    data['groups'][ident] = {'name': _name(name)}
    return ident


def _refs():
    import routes
    values = set()
    for item in routes.load_settings()['buttons'].values():
        values.update(v.removeprefix('node:') for v in [item.get('route', ''), item.get('predecessor', ''), *item.get('chain', [])] if isinstance(v, str) and v.startswith('node:'))
    return values


def _fingerprint(node):
    value = {key: val for key, val in node.items() if key not in ('IndexId', 'Remarks', 'Subid') and not key.startswith('_subscription')}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def _validate_nodes(nodes):
    import routes
    configs = [routes.translate(node, 'import-' + str(index), {'CoreBasicItem': {}, 'Inbound': []}) for index, node in enumerate(nodes.values())]
    executable = routes.location().get('core_path')
    if not executable:
        return
    folder = node_import.STORE.parent
    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='subscription-check-', dir=folder) as temporary:
        path = Path(temporary) / 'config.json'
        path.write_text(json.dumps({'log': {'loglevel': 'none'}, 'outbounds': configs}), encoding='utf-8')
        try:
            result = subprocess.run([str(executable), 'run', '-test', '-config', str(path)], cwd=Path(executable).parent,
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=10, creationflags=0x08000000 if os.name == 'nt' else 0)
        except (OSError, subprocess.TimeoutExpired):
            _error('CORE_VALIDATION_FAILED')
        if result.returncode:
            _error('CORE_VALIDATION_FAILED')


def state(value=None, include_catalog=True):
    if value is not None:
        _request(value, set())
    data = store.read()
    now = _now()
    groups = []
    for ident, group in store.groups(data).items():
        groups.append({'id': ident, 'name': group['name'], 'source': 'local', 'readonly': ident == store.DEFAULT_GROUP,
                       'count': sum(node.get('Subid', store.DEFAULT_GROUP) == ident for node in data['nodes'].values())})
    subscriptions = []
    due = []
    for ident, item in data['subscriptions'].items():
        status = item.get('status', 'idle')
        if status == 'updating' and item.get('_lease_until', 0) <= now:
            status = 'idle'
        public = {key: item.get(key) for key in ('name', 'group_id', 'enabled', 'interval_minutes', 'policy', 'generation', 'last_attempt', 'last_success', 'next_due', 'error_code', 'last_transport')}
        public.update(id=ident, hostname=urlsplit(item['url']).hostname, status=status,
                      count=sum(node.get('_subscription') == ident and not node.get('_subscription_stale') for node in data['nodes'].values()))
        subscriptions.append(public)
        if item['enabled'] and (item.get('next_due') or 0) <= now and item.get('_lease_until', 0) <= now:
            due.append(ident)
    result = {'revision': data['revision'], 'groups': groups, 'subscriptions': subscriptions, 'due': due}
    if include_catalog:
        import routes
        result['catalog'] = routes.catalog()
    return result


def groups(value):
    _request(value, {'action', 'id', 'name', 'revision'})
    _secure()
    with store.locked():
        data = store.read()
        _revision(data, value)
        action = value.get('action')
        ident = value.get('id')
        if action == 'create':
            ident = _new_group(data, value.get('name'))
        elif action in ('rename', 'remove'):
            if ident == store.DEFAULT_GROUP or ident not in data['groups']:
                _error('GROUP_NOT_EDITABLE')
            if action == 'rename':
                data['groups'][ident]['name'] = _name(value.get('name'))
            else:
                del data['groups'][ident]
                for node in data['nodes'].values():
                    if node.get('Subid') == ident:
                        node['Subid'] = store.DEFAULT_GROUP
                for item in data['subscriptions'].values():
                    if item['group_id'] == ident:
                        item['group_id'] = store.DEFAULT_GROUP
                        item['generation'] += 1
                        item.update(status='idle', _lease_until=0, _lease='')
        else:
            _error('INVALID_GROUP_ACTION')
        store.write(data)
    return {**state(), 'created_id': ident if action == 'create' else None}


def save(value):
    _request(value, {'id', 'name', 'url', 'group_id', 'enabled', 'interval_minutes', 'policy', 'revision'})
    _secure()
    with store.locked():
        data = store.read()
        _revision(data, value)
        ident = value.get('id')
        if ident is not None and (not isinstance(ident,str) or ident not in data['subscriptions']):
            _error('SUBSCRIPTION_NOT_FOUND')
        old = data['subscriptions'].get(ident, {})
        if not old and len(data['subscriptions']) >= MAX_SUBSCRIPTIONS:
            _error('SUBSCRIPTION_LIMIT')
        name = _name(value.get('name', old.get('name')))
        url = net.validate_url(value.get('url') or old.get('url'))
        interval = value.get('interval_minutes', old.get('interval_minutes', 60))
        if type(interval) is not int or not 5 <= interval <= 43200:
            _error('INVALID_INTERVAL')
        enabled = value.get('enabled', old.get('enabled', False))
        policy = value.get('policy', old.get('policy', 'proxy-first'))
        if type(enabled) is not bool or not isinstance(policy,str) or policy not in POLICIES:
            _error('INVALID_SUBSCRIPTION_SETTINGS')
        group = value.get('group_id', old.get('group_id'))
        group = _group_id(data, group) if group else _new_group(data, name)
        ident = ident or 'subscription-' + uuid.uuid4().hex
        item = {**old, 'name': name, 'url': url, 'group_id': group, 'enabled': enabled, 'interval_minutes': interval,
                'policy': policy, 'generation': old.get('generation', 0) + 1, 'status': 'idle', 'error_code': '',
                'last_attempt': old.get('last_attempt'), 'last_success': old.get('last_success'),
                'last_transport': old.get('last_transport'), 'next_due': _now() + interval * 60000 if enabled else None,
                '_lease': '', '_lease_until': 0}
        data['subscriptions'][ident] = item
        for node in data['nodes'].values():
            if node.get('_subscription') == ident:
                node['Subid'] = group
        store.write(data)
    return {**state(), 'created_id': ident}


def context(value):
    """Sensitive internal reply: native → background only, never options RPC."""
    _request(value, {'id'})
    if not isinstance(value.get('id'), str):
        _error('SUBSCRIPTION_NOT_FOUND')
    item = store.read()['subscriptions'].get(value.get('id'))
    if not item:
        _error('SUBSCRIPTION_NOT_FOUND')
    return {'url': item['url'], 'generation': item['generation'], 'policy': item['policy']}


def remove(value):
    _request(value, {'id', 'keep_nodes', 'revision'})
    if type(value.get('keep_nodes', True)) is not bool:
        _error('INVALID_LIBRARY_REQUEST')
    _secure()
    with store.locked():
        data = store.read()
        _revision(data, value)
        ident = value.get('id')
        if not isinstance(ident,str) or ident not in data['subscriptions']:
            _error('SUBSCRIPTION_NOT_FOUND')
        refs = _refs()
        for key, node in list(data['nodes'].items()):
            if node.get('_subscription') != ident:
                continue
            if not value.get('keep_nodes', True) and key not in refs:
                del data['nodes'][key]
            else:
                node.pop('_subscription', None)
                node.pop('_subscription_stale', None)
        del data['subscriptions'][ident]
        store.write(data)
    return state()


def import_links(value):
    """Keep legacy manual import semantics; group selection is additive."""
    _request(value, {'text', 'group_id', 'revision'})
    _secure()
    incoming = node_import.parse_links(value.get('text'))
    _validate_nodes(incoming)
    with store.locked():
        data = store.read()
        _revision(data, value)
        group = _group_id(data, value.get('group_id') or store.DEFAULT_GROUP)
        if group != store.DEFAULT_GROUP:
            updated = {}
            for node in incoming.values():
                node['IndexId'] = 'local-' + hashlib.sha256((group + ':' + _fingerprint(node)).encode()).hexdigest()[:32]
                node['Subid'] = group
                updated[node['IndexId']] = node
            incoming = updated
        current = data['nodes']
        if len(set(current) | set(incoming)) > MAX_TOTAL:
            _error('NODE_LIMIT')
        result = {'added': len(set(incoming) - set(current)), 'updated': len(set(incoming) & set(current)), 'ids': list(incoming)}
        data['nodes'] = {**current, **incoming}
        store.write(data)
    return {'import_result': result, 'catalog': state()['catalog']}


def remove_node(value):
    _request(value, {'id'})
    ident = value.get('id')
    if not isinstance(ident, str):
        _error('INVALID_LIBRARY_REQUEST')
    ident = ident.removeprefix('node:')
    _secure()
    with store.locked():
        data = store.read()
        if ident not in data['nodes']:
            _error('NODE_NOT_FOUND')
        if ident in _refs():
            _error('NODE_IN_USE')
        del data['nodes'][ident]
        store.write(data)
    return {'catalog': state()['catalog']}


def refresh(value, fetcher=net.fetch, validator=_validate_nodes):
    _request(value, {'id', 'transport', 'trigger', 'expected_generation'})
    if value.get('trigger', 'manual') not in ('manual', 'automatic'):
        _error('INVALID_LIBRARY_REQUEST')
    transport = net.validate_transport(value.get('transport', {'kind': 'unavailable'}))
    _secure()
    ident = value.get('id')
    if not isinstance(ident,str):
        _error('SUBSCRIPTION_NOT_FOUND')
    lease = uuid.uuid4().hex
    with store.locked():
        data = store.read()
        item = data['subscriptions'].get(ident)
        if not item:
            _error('SUBSCRIPTION_NOT_FOUND')
        if value.get('expected_generation') is not None and (type(value['expected_generation']) is not int or value['expected_generation'] != item['generation']):
            _error('SUBSCRIPTION_CHANGED')
        now = _now()
        if item.get('_lease_until', 0) > now:
            return {**state(), 'refresh': {'ok': False, 'code': 'BUSY'}}
        if value.get('trigger') == 'automatic' and (not item['enabled'] or (item.get('next_due') or 0) > now):
            return {**state(), 'refresh': {'ok': False, 'code': 'NOT_DUE'}}
        item.update(status='updating', last_attempt=now, error_code='', _lease=lease, _lease_until=now + 65000)
        generation, url, policy = item['generation'], item['url'], item['policy']
        store.write(data)
    modes = [({'kind': 'direct'}, 'direct')] if policy == 'direct-only' else [(transport, 'proxy')]
    if policy == 'proxy-first':
        modes.append(({'kind': 'direct'}, 'direct'))
    incoming = None
    code = 'UPDATE_FAILED'
    used = None
    attempts = []
    deadline = time.monotonic() + 42
    for route, label in modes:
        # Direct mode is not a failed proxy attempt: do it only once, in the
        # explicitly allowed fallback stage. Proxy-only must never go direct.
        if label == 'proxy' and route['kind'] in ('direct', 'unavailable'):
            attempts.append({'transport': 'proxy', 'code': 'PROXY_UNAVAILABLE'})
            code = 'PROXY_UNAVAILABLE'
            continue
        try:
            text = fetcher(url, route, deadline=min(deadline, time.monotonic() + 18))
            candidate = parser.parse(text)
            validator(candidate)
            incoming, used, code = candidate, label, 'UPDATED'
            attempts.append({'transport': label, 'code': 'OK'})
            break
        except (net.FetchError, parser.FormatError) as exc:
            code = exc.code
        except (ValueError, OSError, subprocess.TimeoutExpired):
            code = 'VALIDATION_FAILED'
        attempts.append({'transport': label, 'code': code})
        if time.monotonic() >= deadline:
            break
    counts = {'added': 0, 'updated': 0, 'removed': 0, 'retained': 0}
    with store.locked():
        data = store.read()
        item = data['subscriptions'].get(ident)
        if not item or item['generation'] != generation or item.get('_lease') != lease:
            return {**state(), 'refresh': {'ok': False, 'code': 'SUBSCRIPTION_CHANGED', 'attempts': attempts}}
        if incoming is not None:
            current = data['nodes']
            owned = {key: node for key, node in current.items() if node.get('_subscription') == ident}
            candidates = {}
            for node in incoming.values():
                node = copy.deepcopy(node)
                key = 'local-' + hashlib.sha256((ident + ':' + _fingerprint(node)).encode()).hexdigest()[:32]
                node.update(IndexId=key, Subid=item['group_id'], _subscription=ident)
                candidates[key] = node
            refs = _refs()
            removed = set(owned) - set(candidates)
            retained = removed & refs
            total = (set(current) - (removed - retained)) | set(candidates)
            if len(total) > MAX_TOTAL:
                incoming, code = None, 'NODE_LIMIT'
            else:
                counts = {'added': len(set(candidates) - set(owned)), 'updated': len(set(candidates) & set(owned)),
                          'removed': len(removed - retained), 'retained': len(retained)}
                for key in removed - retained:
                    del current[key]
                for key in retained:
                    current[key]['_subscription_stale'] = True
                current.update(candidates)
                item.update(last_success=_now(), last_transport=used)
        item.update(status='ok' if incoming is not None else 'error', error_code='' if incoming is not None else code,
                    next_due=_now() + item['interval_minutes'] * 60000 if item['enabled'] else None,
                    _lease='', _lease_until=0)
        store.write(data)
    return {**state(), 'refresh': {'ok': incoming is not None, 'code': code, 'transport': used, 'attempts': attempts, **counts}}


def handle(command, settings=None):
    handlers = {'libraryGroups': groups, 'subscriptionSave': save,
                'subscriptionRemove': remove, 'subscriptionRefresh': refresh,
                'subscriptionState': state, 'subscriptionContext': context,
                'libraryImport': import_links, 'importLinks': import_links, 'removeNode': remove_node}
    if command not in handlers:
        _error('INVALID_LIBRARY_COMMAND')
    return handlers[command]({} if settings is None else settings)
