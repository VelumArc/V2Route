"""User-invoked portable setup. Never closes browsers or installs startup jobs."""
import argparse
import json
import os
from pathlib import Path
import struct
import sys
from portable_install import Installer, ROOT

def platform_check():
    if os.name!='nt' or struct.calcsize('P')!=8 or sys.getwindowsversion().major<10:
        raise RuntimeError('Windows 10/11 x64 is required / 此套件需要 Windows 10/11 x64。')
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full',0,
                            winreg.KEY_READ|winreg.KEY_WOW64_32KEY) as key:
            release=winreg.QueryValueEx(key,'Release')[0]
        if int(release)<379893:raise ValueError('old framework')
    except (OSError,ValueError,TypeError):
        raise RuntimeError('.NET Framework 4.5.2+ is required / 未检测到所需 Windows .NET Framework 系统组件。')

def select_v2(selected=None,interactive=False,rescan=False):
    import discovery
    report=discovery.select_root(selected) if selected else discovery.inspect_candidates(rescan)
    if report.get('ok'):return report
    if not interactive:return report
    print(report.get('error','未找到有效 v2rayN 目录。'))
    choices=report.get('candidates',[])
    if choices:
        for index,item in enumerate(choices,1):print(f"{index}. {item['path']}")
        answer=input('输入目录序号；直接回车打开文件夹选择；Q 取消：').strip()
        if answer.lower()=='q':return {'ok':False,'error':'用户取消，未注册宿主'}
        if answer:
            if not answer.isdigit() or not 1<=int(answer)<=len(choices):
                return {'ok':False,'error':'无效序号，未注册宿主；请重新运行安装。'}
            return discovery.select_root(choices[int(answer)-1]['path'])
    return discovery.choose_root()

def instructions():
    print('\nProxy V2Route companion registered for this Windows user / 本地配套程序已为当前用户注册。')
    print('Chrome: chrome://extensions > Developer mode > Load unpacked / 开发者模式 > 加载已解压扩展：')
    print('  '+str(ROOT/'chrome-extension'))
    print('Enable per browser profile; allow private browsing if needed / 每个浏览器用户分别启用，需要时允许无痕。')
    print('Firefox unsigned test: about:debugging > This Firefox > Load Temporary Add-on / 此 Firefox > 临时载入附加组件。')
    print('Select firefox-extension/manifest.json. Temporary add-ons disappear after restart / 重启后临时扩展消失，永久安装需 Mozilla 签名。')
    print('Use one proxy manager at a time / 请只启用一种代理管理方式，避免其他代理扩展或原窗口按钮覆盖。')
    print('v2rayN is optional: import your own supported node links in Proxy V2Route / v2rayN 可选，可在设置中导入支持的节点链接。')
    print('After moving the whole folder, run install.cmd again / 移动整个文件夹后，重新运行 install.cmd 更新注册路径。')

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group()
    for name in ('install','uninstall','rollback','plan','detect','choose-v2','upgrade-plan'):group.add_argument('--'+name,action='store_true')
    parser.add_argument('--v2',metavar='FOLDER');parser.add_argument('--interactive',action='store_true')
    parser.add_argument('--rescan',action='store_true')
    parser.add_argument('--upgrade',action='store_true',help='Explicitly migrate/restart an owned Proxy V2Route companion')
    args=parser.parse_args(argv);platform_check();installer=Installer()
    from upgrade_install import Upgrade
    if args.upgrade and not args.install:parser.error('--upgrade requires --install')
    if args.upgrade_plan:
        print(json.dumps(Upgrade(installer).plan(),ensure_ascii=False));return 0
    if args.uninstall or args.rollback:
        result=installer.restore(args.rollback)
        print('Host registration restored; user data and package files preserved / 宿主注册已恢复，用户数据和文件均保留。')
        print('Before disabling Proxy V2Route, select Direct or System in the extension / 停用前请切换直连或系统代理。')
        print(json.dumps(result,ensure_ascii=False));return 0
    if args.install:
        # Node-link users must be able to install without v2rayN or a folder prompt.
        if args.v2:
            report=select_v2(args.v2,False,args.rescan)
            if not report.get('ok'):
                print('Optional v2rayN selection failed / 可选 v2rayN 目录未选定: '+report.get('error',''))
                return 1
        result=Upgrade(installer).install(explicit=args.upgrade);print(json.dumps(result,ensure_ascii=False))
        if not args.v2:
            # Auto-discover on first install, never force a picker or block
            # standalone imported-node use when v2rayN is absent/ambiguous.
            try:report=select_v2(None,False,args.rescan)
            except Exception:report={'ok':False,'error':'Automatic discovery unavailable / 自动识别暂时不可用'}
        if report.get('ok'):print('Detected v2rayN / 已识别 v2rayN：'+report['selected'])
        else:print('v2rayN is optional. Use Node Library > Rescan or Settings to select a folder / v2rayN 可选，可在节点库重新扫描或在设置中选择目录。')
        instructions();return 0
    if args.detect or args.choose_v2 or args.v2:
        if args.choose_v2:
            import discovery
            report=discovery.choose_root()
        else:report=select_v2(args.v2,args.interactive,args.rescan)
        if not report.get('ok'):
            print('Optional discovery incomplete / 可选目录发现未完成: '+report.get('error','v2rayN not found'))
            print('You can still install and import node links / 仍可安装并导入节点链接；宿主注册未改变。')
            return 1
        print('Selected v2rayN / 已选择 v2rayN: '+report['selected'])
        if not args.install:return 0
        result=installer.install();print(json.dumps(result,ensure_ascii=False));instructions();return 0
    print(json.dumps(installer.plan(),ensure_ascii=False,indent=2));return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:
        print('Not completed / 未完成: '+str(exc),file=sys.stderr)
        print('Keep this error and data/installations receipts / 请保留提示与安装回执。',file=sys.stderr)
        raise SystemExit(1)
