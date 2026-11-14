"""Atomic, backward-readable private library storage shared by native processes."""
from contextlib import contextmanager
import copy
import json
import os
import threading
import time
import uuid

_THREAD_LOCK = threading.RLock()
_LOCAL = threading.local()
DEFAULT_GROUP = 'local-imports'


def path():
    import node_import
    return node_import.STORE


def empty():
    return {'version': 1, 'revision': 0, 'nodes': {}, 'groups': {}, 'subscriptions': {}}


def read():
    target = path()
    if not target.exists():
        return empty()
    try:
        value = json.loads(target.read_text(encoding='utf-8'))
        if not isinstance(value, dict) or value.get('version') != 1:
            raise ValueError()
        if any(not isinstance(value.get(key, {}), dict) for key in ('nodes', 'groups', 'subscriptions')):
            raise ValueError()
        if type(value.get('revision', 0)) is not int or value.get('revision', 0) < 0:
            raise ValueError()
        return {**empty(), **value}
    except (ValueError, TypeError):
        raise ValueError('Invalid local node database / 本地节点库无效') from None


@contextmanager
def locked(timeout=10):
    """Lock the complete read/modify/write cycle, also across one-shot hosts."""
    with _THREAD_LOCK:
        if getattr(_LOCAL, 'depth', 0):
            _LOCAL.depth += 1
            try:
                yield
            finally:
                _LOCAL.depth -= 1
            return
        target = path()
        target.parent.mkdir(parents=True, exist_ok=True)
        lock = target.with_suffix('.lock')
        with lock.open('a+b') as handle:
            handle.seek(0, 2)
            if not handle.tell():
                handle.write(b'\0')
                handle.flush()
            deadline = time.monotonic() + timeout
            while True:
                try:
                    handle.seek(0)
                    if os.name == 'nt':
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise ValueError('Node library is busy / 节点库正忙，请稍后重试') from None
                    time.sleep(.025)
            _LOCAL.depth = 1
            try:
                yield
            finally:
                _LOCAL.depth = 0
                handle.seek(0)
                if os.name == 'nt':
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def write(value):
    if not getattr(_LOCAL, 'depth', 0):
        raise RuntimeError('Library writes require the transaction lock')
    target = path()
    candidate = copy.deepcopy(value)
    candidate['version'] = 1  # Warm pre-subscription companions can still read nodes.
    candidate['revision'] = int(value.get('revision', 0)) + 1
    temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as output:
            json.dump(candidate, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    value['revision'] = candidate['revision']


def groups(value=None):
    value = value if value is not None else read()
    result = {DEFAULT_GROUP: {'name': 'Imported nodes / 导入节点'}}
    result.update(value.get('groups', {}))
    return result
