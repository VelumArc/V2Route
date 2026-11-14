"""Derive compact display labels from names, never from credentials or guessed IP geography."""
import json
import re
import unicodedata
from pathlib import Path

NAMES=dict(pair.split(':',1) for pair in (
 'hk:香港 sg:新加坡 us:美国 jp:日本 tw:台湾 kr:韩国 kp:朝鲜 ph:菲律宾 mo:澳门 mm:缅甸 vn:越南 th:泰国 '
 'in:印度 my:马来西亚 id:印度尼西亚 ae:阿联酋 sa:沙特 kh:柬埔寨 kg:吉尔吉斯斯坦 kz:哈萨克斯坦 bn:文莱 '
 'il:以色列 mn:蒙古 az:阿塞拜疆 jo:约旦 ru:俄罗斯 tr:土耳其 aq:南极洲 mx:墨西哥 ua:乌克兰 nz:新西兰 '
 'nl:荷兰 ca:加拿大 au:澳大利亚 fr:法国 de:德国 gb:英国 es:西班牙 ro:罗马尼亚 lu:卢森堡 it:意大利 '
 'at:奥地利 al:阿尔巴尼亚 fi:芬兰 ch:瑞士 no:挪威 se:瑞典 im:马恩岛 is:冰岛 cz:捷克 dk:丹麦 hu:匈牙利 '
 'xk:科索沃 bg:保加利亚 md:摩尔多瓦 ar:阿根廷 br:巴西 cl:智利 pe:秘鲁 eg:埃及 ng:尼日利亚 tg:多哥 '
 'za:南非 cn:中国 pt:葡萄牙 ie:爱尔兰 be:比利时 pl:波兰 pk:巴基斯坦 bd:孟加拉国 np:尼泊尔 '
 'lk:斯里兰卡 ir:伊朗 iq:伊拉克 gr:希腊 rs:塞尔维亚 eu:欧盟 un:联合国').split())
EXTRA={'tw':['TWN','台灣'], 'hk':['HKG'], 'jp':['JPN'], 'kr':['KOR'], 'sg':['SGP','狮城'],
 'us':['USA','SJC','LAX','SEA','NYC','美國'],'gb':['GBR','UK'],'cn':['CHN','中国大陆'],
 'de':['DEU'],'fr':['FRA'],'ca':['CAN'],'au':['AUS','澳洲'],'ru':['RUS'],'ph':['PHL'],
 'id':['IDN','印尼'],'sa':['沙特阿拉伯'],'tr':['TUR'],'nl':['NLD'],'it':['ITA']}
COUNTRIES=json.loads((Path(__file__).resolve().parent/'assets/countries.json').read_text(encoding='utf-8'))
ENGLISH={c['code']:c['name'] for c in COUNTRIES}
FLAG=re.compile(r'[\U0001F1E6-\U0001F1FF]{2}')
CIRCLED=re.compile(r'[①-⑳❶-❿➀-➉]')

def aliases(code):
    return [x for x in [NAMES.get(code),code,ENGLISH.get(code),*EXTRA.get(code,[])] if x]

def token_pattern(value):
    escaped=re.escape(value)
    return r'(?<![A-Za-z])'+escaped+r'(?![A-Za-z])' if value.isascii() else escaped

def country(text):
    m=FLAG.search(text)
    if m:
        code=''.join(chr(ord(c)-0x1f1e6+97) for c in m[0])
        if code in ENGLISH or code in NAMES:return code
    # Destination names after "to" take precedence over entry-city names.
    text=re.split(r'(?i)\bto\b|(?<=[\u4e00-\u9fff])to',text)[-1]
    for code,name in sorted(NAMES.items(),key=lambda p:-len(p[1])):
        if re.search('|'.join(token_pattern(x) for x in aliases(code)),text,re.I):return code
    return None

def describe(label,group=''):
    code=country(label) or country(group)
    if not code:
        return {'country':None,'country_name':None,'suggested_label':label[:128] or '线路'}
    name=NAMES.get(code,ENGLISH.get(code,code.upper()))
    head=FLAG.sub('',label).split('|',1)[0].strip()
    number=''
    circle=CIRCLED.search(head)
    if circle:number=str(int(unicodedata.numeric(circle[0])))
    else:
        for alias in sorted(aliases(code),key=len,reverse=True):
            pattern=token_pattern(alias)
            m=re.search(pattern+r'\s*[-_#.]?\s*(\d{1,3})(?![\d.])',head,re.I)
            if not m:m=re.search(r'(?:^|\s)(\d{1,3})\s*[-_#.]?\s*'+pattern,head,re.I)
            if m:number=str(int(m[1]));break
    suggested=name+number
    if re.search(r'海外用[户戶]',label):suggested+=' - 海外用户'
    return {'country':code,'country_name':name,'suggested_label':suggested}

if __name__=='__main__':
    examples={'🇹🇼 ①台湾 | TWN [解锁/GPT] x1.2{Ver11S}':'台湾1',
      '🇹🇼 ②台湾 | TWN [解锁/GPT] x1.2{Ver11S}':'台湾2','TW-7':'台湾7','TW-10':'台湾10',
      '🇹🇼 TWN | Direct Access [海外用户] x1.2{Ver5}':'台湾 - 海外用户',
      '🇺🇸美国01|V6中转|1x':'美国1','US-1TCP':'美国1','HK2-HY2':'香港2',
      '🇯🇵日本|高速|x1.2{Ver11S}':'日本','菲律宾ALI':'菲律宾','上海to香港A':'香港',
      'SJC-REALITY':'美国','斯巴达VMS':'斯巴达VMS'}
    for raw,expected in examples.items():assert describe(raw)['suggested_label']==expected,(raw,describe(raw),expected)
    print(json.dumps({'examples_passed':len(examples)},ensure_ascii=False))
