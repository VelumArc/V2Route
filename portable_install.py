"""HKCU-only portable native-host registration, with ownership and rollback receipts."""
import argparse
import copy
import hashlib
import json
import os
import re
from pathlib import Path
import time
import uuid
import winreg as R

ROOT=Path(__file__).resolve().parent
NAME='local.v2route'
PRODUCT_ID='v2route'
KEYS={'chrome':r'Software\Google\Chrome\NativeMessagingHosts'+'\\'+NAME,
      'firefox':r'Software\Mozilla\NativeMessagingHosts'+'\\'+NAME}
VIEWS={'32':R.KEY_WOW64_32KEY,'64':R.KEY_WOW64_64KEY}

def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
    os.replace(tmp,path)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

class Registry:
    def read(self,browser,view):
        try:
            with R.OpenKey(R.HKEY_CURRENT_USER,KEYS[browser],0,R.KEY_READ|VIEWS[view]) as key:
                try:
                    value,kind=R.QueryValueEx(key,'')
                    return {'key_exists':True,'exists':True,'value':value,'type':kind}
                except FileNotFoundError:return {'key_exists':True,'exists':False}
        except FileNotFoundError:return {'key_exists':False,'exists':False}
    def write(self,browser,view,state):
        if state['exists']:
            with R.CreateKeyEx(R.HKEY_CURRENT_USER,KEYS[browser],0,R.KEY_WRITE|VIEWS[view]) as key:
                R.SetValueEx(key,'',0,state['type'],state['value'])
            return
        try:
            with R.OpenKey(R.HKEY_CURRENT_USER,KEYS[browser],0,R.KEY_READ|R.KEY_WRITE|VIEWS[view]) as key:
                try:R.DeleteValue(key,'')
                except FileNotFoundError:pass
                subkeys,values,_=R.QueryInfoKey(key)
            if not state.get('key_exists') and not subkeys and not values:
                R.DeleteKeyEx(R.HKEY_CURRENT_USER,KEYS[browser],VIEWS[view])
        except FileNotFoundError:pass

class Installer:
    def __init__(self,root=ROOT,registry=None):
        self.root=Path(root).resolve(strict=True)
        self.registry=registry or Registry()
        self.product=json.loads((self.root/'product.json').read_text(encoding='utf-8'))
        if self.product.get('product_id')!=PRODUCT_ID or self.product.get('host_name')!=NAME:
            raise RuntimeError('便携包身份无效，未修改注册表')
        if not re.fullmatch('[a-p]{32}', self.product.get('chrome_id','')) or self.product.get('firefox_id')!='v2route@v2route.local':
            raise RuntimeError('Invalid extension identity / 扩展身份无效，未修改注册表')
        self.receipt=self.root/'data/install-receipt.json'
    def manifest_path(self,browser):return self.root/'native'/f'{NAME}.{browser}.json'
    def manifest(self,browser):
        value={'name':NAME,'description':'V2Route local companion',
               'path':str(self.root/'native/V2RouteHost.exe'),'type':'stdio'}
        if browser=='chrome':value['allowed_origins']=['chrome-extension://'+self.product['chrome_id']+'/']
        else:value['allowed_extensions']=[self.product['firefox_id']]
        return value
    def snapshot(self):return {b:{v:self.registry.read(b,v) for v in VIEWS} for b in KEYS}
    def expected(self):
        return {b:{v:{'key_exists':True,'exists':True,'value':str(self.manifest_path(b)),'type':R.REG_SZ} for v in VIEWS} for b in KEYS}
    def previous(self):
        if not self.receipt.is_file():return None
        record=json.loads(self.receipt.read_text(encoding='utf-8'))
        if record.get('product_id')!=PRODUCT_ID:raise RuntimeError('安装回执身份不匹配')
        return record
    def owner(self,path,browser,prior):
        p=Path(path)
        if not p.is_file():
            if prior and prior.get('state')=='installed' and path==prior.get('manifests',{}).get(browser,{}).get('path'):
                return prior
            raise RuntimeError('同名宿主指向不存在的目录，无法核实归属：'+path)
        try:
            body=json.loads(p.read_text(encoding='utf-8'));oldroot=p.resolve().parent.parent
            product=json.loads((oldroot/'product.json').read_text(encoding='utf-8'))
            expected=self.manifest(browser);expected['path']=str(oldroot/'native/V2RouteHost.exe')
            identity_keys=('product_id','host_name','chrome_id','firefox_id')
            if any(product.get(k)!=self.product.get(k) for k in identity_keys) or body!=expected or p.name!=self.manifest_path(browser).name:raise ValueError('identity')
            record=json.loads((oldroot/'data/install-receipt.json').read_text(encoding='utf-8'))
            if record.get('product_id')!=PRODUCT_ID or record.get('manifests',{}).get(browser,{}).get('sha256')!=sha(p):raise ValueError('receipt')
            if record.get('state')=='rolled_back':
                # Reinstalling this exact root can have identical before/after
                # registrations. Its rollback still points at this owned host;
                # preserve all identity/hash checks and accept only that proof.
                same_path=False
                for view in VIEWS:
                    previous=record.get('before',{}).get(browser,{}).get(view)
                    after=record.get('after',{}).get(browser,{}).get(view)
                    restored=record.get('restored_to',{}).get(browser,{}).get(view)
                    if (previous==after==restored and isinstance(restored,dict)
                            and restored.get('exists') and restored.get('type')==R.REG_SZ
                            and restored.get('value')==path):same_path=True
                if not same_path:raise ValueError('inactive rollback')
            elif record.get('state') not in ('installed','installing','failed'):raise ValueError('inactive')
            return record
        except (OSError,ValueError,KeyError,TypeError) as exc:
            raise RuntimeError('检测到非本包或被修改的同名宿主，未覆盖：'+str(p)) from exc
    def plan(self):
        if not (self.root/'native/V2RouteHost.exe').is_file() or not (self.root/'runtime/python.exe').is_file():
            raise RuntimeError('便携包缺少宿主或内置 Python，请重新完整解压')
        before=self.snapshot();baseline=copy.deepcopy(before);prior=self.previous()
        for b,views in before.items():
            for v,state in views.items():
                if state['exists']:
                    if state.get('type')!=R.REG_SZ or not isinstance(state.get('value'),str):raise RuntimeError('同名宿主类型异常')
                    record=self.owner(state['value'],b,prior)
                    baseline[b][v]=copy.deepcopy(record['baseline'][b][v])
        for b in KEYS:
            p=self.manifest_path(b)
            if p.exists():
                body=json.loads(p.read_text(encoding='utf-8'))
                info=(prior or {}).get('manifests',{}).get(b,{})
                if body!=self.manifest(b) and sha(p)!=info.get('sha256'):
                    raise RuntimeError('本包宿主清单已被外部修改，未覆盖：'+str(p))
        return {'product_id':PRODUCT_ID,'scope':'HKCU only','root':str(self.root),'before':before,
                'baseline':baseline,'after':self.expected(),'manifests':{b:self.manifest(b) for b in KEYS}}
    def save(self,record):
        atomic_json(self.root/'data/installations'/(record['transaction']+'.json'),record)
        atomic_json(self.receipt,record)
    def prepare(self):
        plan=self.plan()
        for browser in KEYS:atomic_json(self.manifest_path(browser),self.manifest(browser))
        return {'ok':True,'registered':False,'manifests':{b:str(self.manifest_path(b)) for b in KEYS}}
    def install(self):
        plan=self.plan()
        record={**{k:plan[k] for k in ('product_id','root','before','baseline','after')},
                'transaction':time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8],
                'state':'installing','keys':KEYS,'launcher_sha256':sha(self.root/'native/V2RouteHost.exe'),
                'manifests':{},'manifest_backups':{}}
        for b in KEYS:
            p=self.manifest_path(b);content=json.dumps(self.manifest(b),ensure_ascii=False,indent=2)
            record['manifest_backups'][b]=p.read_text(encoding='utf-8') if p.exists() else None
            record['manifests'][b]={'path':str(p),'sha256':hashlib.sha256(content.encode()).hexdigest()}
        self.save(record)
        try:
            for b in KEYS:atomic_json(self.manifest_path(b),self.manifest(b))
            for b in KEYS:
                for v in VIEWS:
                    if self.registry.read(b,v) not in (record['before'][b][v],record['after'][b][v]):
                        raise RuntimeError('注册期间检测到外部改动，未覆盖：'+b+'/'+v)
                    self.registry.write(b,v,record['after'][b][v])
            if self.snapshot()!=record['after']:raise RuntimeError('注册值写入后核验失败')
            record['state']='installed';self.save(record)
            return {'ok':True,'host':NAME,'receipt':str(self.receipt),'root':str(self.root)}
        except Exception as exc:
            record['error']=str(exc);record['rollback_errors']=[]
            for b in KEYS:
                for v in VIEWS:
                    try:
                        current=self.registry.read(b,v)
                        if current in (record['after'][b][v],record['before'][b][v]):self.registry.write(b,v,record['before'][b][v])
                        else:raise RuntimeError('外部注册发生变化，保留该项')
                    except Exception as rollback:record['rollback_errors'].append(str(rollback))
            record['state']='failed';self.save(record);raise
    def restore(self,rollback=False):
        record=self.previous()
        if not record or record.get('state') not in ('installed','installing','failed'):raise RuntimeError('没有本包可恢复的安装回执')
        target=record['before'] if rollback else record['baseline'];current=self.snapshot()
        for b in KEYS:
            for v in VIEWS:
                if current[b][v] not in (record['after'][b][v],target[b][v]):raise RuntimeError('宿主注册已被外部改变，未覆盖：'+b+'/'+v)
        for b in KEYS:
            for v in VIEWS:self.registry.write(b,v,target[b][v])
        actual=self.snapshot()
        for b in KEYS:
            for v in VIEWS:
                if any(actual[b][v].get(k)!=target[b][v].get(k) for k in ('exists','value','type')):raise RuntimeError('恢复核验失败')
        record['state']='rolled_back' if rollback else 'uninstalled';record['restored_to']=actual;self.save(record)
        return {'ok':True,'state':record['state'],'files_preserved':True,'receipt':str(self.receipt)}

def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group()
    for command in ('install','uninstall','rollback','plan','prepare'):group.add_argument('--'+command,action='store_true')
    args=parser.parse_args();installer=Installer()
    result=installer.install() if args.install else installer.restore(args.rollback) if (args.uninstall or args.rollback) else installer.prepare() if args.prepare else installer.plan()
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
