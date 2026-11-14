/* V2Route UI. GPL-3.0-or-later. Background owns proxy state and native access. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const runtime = () => root.chrome && root.chrome.runtime;
  const uiText = (key, fallback) => root.I18n?.t(key) || fallback;
  function rpc(method, args = []) {
    return new Promise((resolve, reject) => {
      if (!runtime()) return reject(new Error(uiText('backgroundUnavailable', 'Extension background is unavailable.')));
      runtime().sendMessage({method, args}, response => {
        const error = runtime().lastError || response && response.error;
        if (error) return reject(new Error(error.message || error.reason || String(error)));
        if (!response) return reject(new Error(uiText('backgroundNoResponse', 'The background did not respond.')));
        resolve(response.result);
      });
    });
  }
  async function read() {
    const [options, state] = await Promise.all([
      rpc('getAll'), rpc('getState', [['availableProfiles', 'currentProfileName', 'isSystemProfile', 'proxyNotControllable', 'zeroRouteError']])
    ]);
    return {options, state};
  }
  function prefsGet() { return new Promise(resolve => chrome.storage.local.get('v2routeUi', v => resolve(v.v2routeUi || {}))); }
  function prefsSet(value) { return new Promise((resolve, reject) => chrome.storage.local.set({v2routeUi:value}, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve())); }
  function profiles(options) { return Object.keys(options || {}).filter(k => k[0] === '+' && options[k] && !options[k].builtin && !options[k].name.startsWith('_')).map(k => options[k]); }
  function groups(routes, order = []) {
    const items = new Map(), positions = new Map(order.map((v, i) => [v, i]));
    for (const route of routes || []) {
      if (route.value === 'follow' || route.value === 'manual') continue;
      const id = route.group_id || route.source || 'local';
      // Only this reserved native group is application-owned. Subscription and
      // user labels remain exact, even when they happen to contain both languages.
      const name = route.source === 'local' && id === 'local-imports' ? uiText('imported', 'Imported') : route.group || uiText(route.source === 'local' ? 'imported' : 'ungrouped', route.source === 'local' ? 'Imported' : 'Ungrouped');
      if (!items.has(id)) items.set(id, {id, name, routes:[]});
      items.get(id).routes.push(route);
    }
    return [...items.values()].sort((a,b) => (positions.get(a.id) ?? 10000) - (positions.get(b.id) ?? 10000));
  }
  function move(order, id, target, after) {
    if (id === target || !order.includes(id) || !order.includes(target)) return order.slice();
    const result = order.filter(x => x !== id), at = result.indexOf(target) + (after ? 1 : 0);
    result.splice(at, 0, id); return result;
  }
  // Matches the bundled flag-icons assets; unknown values never become paths.
  const flagCountries=new Set('ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cp cr cu cv cw cx cy cz de dg dj dk dm do dz ec ee eg eh er es et eu fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu ic id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pc pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um un us uy uz va vc ve vg vi vn vu wf ws xk ye yt za zm zw'.split(' '));
  const countryCode=value=>{const code=String(value||'').toLowerCase();return flagCountries.has(code)?code:'';};
  const countryAliases={tw:['台湾','台灣','Taiwan'],hk:['香港','Hong Kong'],mo:['澳门','澳門','Macao','Macau'],cn:['中国','中國','China'],jp:['日本','Japan'],sg:['新加坡','Singapore'],us:['美国','美國','United States','USA'],gb:['英国','英國','United Kingdom','UK'],kr:['韩国','韓國','South Korea'],de:['德国','德國','Germany'],fr:['法国','法國','France'],ca:['加拿大','Canada'],au:['澳大利亚','澳洲','Australia'],nl:['荷兰','荷蘭','Netherlands'],ru:['俄罗斯','俄羅斯','Russia'],ph:['菲律宾','菲律賓','Philippines'],in:['印度','India'],th:['泰国','泰國','Thailand'],vn:['越南','Vietnam']};
  function labelCountry(label){
    const text=String(label||'').trim(),flags=[...text.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)];
    const flag=flags.length===1&&flags[0].index===0?countryCode([...flags[0][0]].map(c=>String.fromCharCode(c.codePointAt(0)-0x1f1e6+97)).join('')):'';
    if(flags.length&&!flag)return '';
    const found=new Set(),prefixes=new Set();
    for(const [code,aliases]of Object.entries(countryAliases))for(const alias of aliases){
      const latin=/^[a-z]/i.test(alias),pattern=latin?'(^|[^A-Za-z])'+alias+'(?=$|[^A-Za-z])':alias;
      if(new RegExp(pattern,'i').test(text))found.add(code);
      if(new RegExp('^'+alias+(latin?'(?=$|[^A-Za-z])':'(?=$|[\\s\\d·_\\-/（(]|测试|測試|节点|節點|线路|線路)'),'i').test(text))prefixes.add(code);
    }
    if(flag)return [...found].every(code=>code===flag)?flag:'';
    return found.size===1&&prefixes.size===1?[...prefixes][0]:'';
  }
  function routeIcon(route) {
    const country = countryCode(route && route.country);
    if (route && route.value === 'follow') return 'icons/follow.svg';
    return country ? '../zero-assets/flags/' + country + '.svg' : 'icons/route.svg';
  }
  function profileIcon(profile,metadata) {
    if(!profile)return '';
    if(profile.profileType==='DirectProfile')return 'icons/direct.svg';
    if(profile.profileType==='SystemProfile')return '';
    if (profile && (profile._zeroRouteChoice === 'follow' || profile._zeroRouteIcon === 'zero-assets/v2rayn.png')) return 'icons/follow.svg';
    if(metadata&&metadata.choice===profile._zeroRouteChoice)return routeIcon({country:metadata.country});
    const savedFlag=String(profile._zeroRouteIcon||'').match(/^zero-assets\/flags(?:-png)?\/([a-z]{2})\.(?:svg|png)$/i);
    const country=countryCode(profile._zeroRouteCountry)||countryCode(savedFlag?.[1]);
    if(country)return routeIcon({country});
    // Legacy profiles predate country metadata. Only explicit, unambiguous
    // country prefixes on a managed node are used; no IP geography is guessed.
    if(profile._zeroRouteChoice?.startsWith('node:'))return routeIcon({country:labelCountry(profile.name)});
    return profile._zeroRouteIcon==='v2route-ui/icons/route.svg'?'icons/route.svg':'';
  }
  function routeLabel(route) {
    // Localize by reserved identity, never by matching or splitting user text.
    if (route?.value === 'follow') return uiText('follow', 'Follow v2rayN');
    if (route?.value === 'manual') return uiText('manual', 'Manual proxy');
    return String(route && (route.label || route.name) || '').replace(/^(?:[\u{1F1E6}-\u{1F1FF}]{2}\s*)+/u, '').trim();
  }
  root.V2R = {rpc, read, clone, prefsGet, prefsSet, profiles, groups, move, routeIcon, profileIcon, routeLabel};
  if (typeof module === 'object') module.exports = root.V2R;
})(typeof globalThis === 'object' ? globalThis : this);
