/* V2Route on-demand IP checks. No storage, timers or network activity on load. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.V2RIP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const MAX_BYTES = 4096;
  const MAX_TIMEOUT = 8000;
  const PROVIDERS = Object.freeze({
    ipv4: Object.freeze({ id: 'ipify-ipv4', family: 'ipv4', label: 'ipify IPv4', url: 'https://api.ipify.org?format=json' }),
    dual: Object.freeze({ id: 'ipify-dual', family: 'dual', label: 'ipify IPv4/IPv6', url: 'https://api64.ipify.org?format=json' })
  });
  const MESSAGES = Object.freeze({
    BAD_OPTIONS: 'Invalid IP check options.',
    CHALLENGE: 'The website requires verification on its original page.',
    TIMEOUT: 'The IP check timed out.',
    CANCELLED: 'The IP check was cancelled.',
    NETWORK: 'The IP service could not be reached.',
    HTTP: 'The IP service returned an unsuccessful response.',
    INVALID_RESPONSE: 'The IP service returned an invalid response.',
    TOO_LARGE: 'The IP service response exceeded the size limit.'
  });
  function failure(code) {
    const error = new Error(MESSAGES[code]);
    error.name = 'IPCheckError';
    error.code = code;
    return error;
  }
  function isFamily(value) { return value === 'ipv4' || value === 'dual'; }
  function ipv4(value) {
    if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
    const octets = value.split('.').map(Number);
    return octets.every(n => n <= 255) ? octets : null;
  }
  function address(value) {
    if (typeof value !== 'string' || value.length < 2 || value.length > 45) return null;
    if (!value.includes(':')) {
      const octets = ipv4(value);
      return octets ? { ip: octets.join('.'), version: 4 } : null;
    }
    if (!/^[\da-fA-F:.]+$/.test(value)) return null;
    let source = value;
    if (source.includes('.')) {
      const last = source.lastIndexOf(':');
      const octets = ipv4(source.slice(last + 1));
      if (!octets) return null;
      source = source.slice(0, last + 1) + ((octets[0] << 8) | octets[1]).toString(16) + ':' + ((octets[2] << 8) | octets[3]).toString(16);
    }
    const halves = source.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if (![...left, ...right].every(part => /^[\da-fA-F]{1,4}$/.test(part))) return null;
    const length = left.length + right.length;
    if ((halves.length === 1 && length !== 8) || (halves.length === 2 && length >= 8)) return null;
    const groups = [...left.map(n => parseInt(n, 16)), ...Array(8 - length).fill(0), ...right.map(n => parseInt(n, 16))];
    let bestStart = -1, bestLength = 0;
    for (let i = 0; i < groups.length;) {
      if (groups[i] !== 0) { i++; continue; }
      const start = i;
      while (i < groups.length && groups[i] === 0) i++;
      if (i - start >= 2 && i - start > bestLength) { bestStart = start; bestLength = i - start; }
    }
    const texts = groups.map(n => n.toString(16));
    const ip = bestStart < 0 ? texts.join(':') : texts.slice(0, bestStart).join(':') + '::' + texts.slice(bestStart + bestLength).join(':');
    return { ip, version: 6 };
  }
  function nonce() {
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(12);
      root.crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function now() { return root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now(); }
  async function boundedBody(response, signal, maxBytes = MAX_BYTES) {
    const declared = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : null;
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw failure('TOO_LARGE');
    if (!response.body || typeof response.body.getReader !== 'function') throw failure('INVALID_RESPONSE');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0, reads = 0;
    const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {} };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        if (signal.aborted) throw failure('CANCELLED');
        const item = await reader.read();
        if (signal.aborted) throw failure('CANCELLED');
        if (item.done) break;
        if (!(item.value instanceof Uint8Array)) throw failure('INVALID_RESPONSE');
        if (++reads > maxBytes * 2) { cancel(); throw failure('TOO_LARGE'); }
        size += item.value.byteLength;
        if (size > maxBytes) { cancel(); throw failure('TOO_LARGE'); }
        if (item.value.byteLength) chunks.push(item.value);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      try { reader.releaseLock(); } catch (_) {}
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { throw failure('INVALID_RESPONSE'); }
  }
  async function runCheck(options) {
    if (!options || typeof options !== 'object' || !isFamily(options.family)) throw failure('BAD_OPTIONS');
    const family = options.family;
    if (options.service !== undefined && options.service !== 'ipify') throw failure('BAD_OPTIONS');
    const provider = PROVIDERS[family];
    return request(options, provider, body => parseCheck(body, provider, family));
  }
  async function request(options, provider, parse, maxBytes = MAX_BYTES) {
    const timeoutMs = options.timeoutMs === undefined ? MAX_TIMEOUT : options.timeoutMs;
    const fetchImpl = options.fetchImpl === undefined ? (typeof root.fetch === 'function' ? root.fetch.bind(root) : null) : options.fetchImpl;
    const external = options.signal;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT || typeof fetchImpl !== 'function' ||
      (external !== undefined && (!external || typeof external.aborted !== 'boolean' || typeof external.addEventListener !== 'function' || typeof external.removeEventListener !== 'function'))) throw failure('BAD_OPTIONS');
    if (external && external.aborted) throw failure('CANCELLED');
    const controller = new AbortController();
    const start = now();
    let stopped = '', rejectStop, completed = false;
    const stopPromise = new Promise((_, reject) => { rejectStop = reject; });
    const stop = code => {
      if (stopped || completed) return;
      stopped = code;
      controller.abort();
      rejectStop(failure(code));
    };
    const onCancel = () => stop('CANCELLED');
    if (external) external.addEventListener('abort', onCancel, { once: true });
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    const request = async () => {
      const url = new URL(provider.url);
      if (provider.fresh !== false) url.searchParams.set('_v2r', nonce());
      const response = await fetchImpl(url.href, { method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
      if (stopped) throw failure(stopped);
      if (!response) throw failure('HTTP');
      if (response.redirected || response.type === 'opaque') throw failure('INVALID_RESPONSE');
      if (response.ok !== true) {
        if (provider.publicPage && [403, 503].includes(response.status)) {
          const deniedBody = await boundedBody(response, controller.signal, maxBytes);
          try { parse(deniedBody); } catch (error) { if (error?.code === 'CHALLENGE') throw error; }
        }
        // A result carried in an unsuccessful response is never accepted.
        throw failure('HTTP');
      }
      const body = await boundedBody(response, controller.signal, maxBytes);
      return Object.freeze({ ...parse(body), durationMs: Math.max(0, Math.round(now() - start)), checkedAt: new Date().toISOString() });
    };
    try {
      const result = await Promise.race([request(), stopPromise]);
      completed = true;
      return result;
    } catch (error) {
      if (stopped) throw failure(stopped);
      if (error && error.name === 'IPCheckError' && Object.hasOwn(MESSAGES, error.code)) throw failure(error.code);
      throw failure('NETWORK');
    } finally {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onCancel);
      if (!completed) controller.abort();
    }
  }

  function parseCheck(body, provider, family) {
    let payload;
    try { payload = JSON.parse(body); } catch (_) { throw failure('INVALID_RESPONSE'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'ip')) throw failure('INVALID_RESPONSE');
    const parsed = address(payload.ip);
    if (!parsed || (family === 'ipv4' && parsed.version !== 4)) throw failure('INVALID_RESPONSE');
    return {provider: provider.id, family, ip: parsed.ip, ipVersion: parsed.version};
  }

  // Parse to plain data, never DOM. Even detached template/DOMParser inputs
  // compile event attributes under Chrome extension CSP. The local parse5
  // bundle has no DOM, script execution or resource loader.
  function parsePublicReport(body, ip) {
    const target = address(ip);
    if (!target || typeof body !== 'string' || body.length > 512 * 1024) throw failure('INVALID_RESPONSE');
    const parser = root.V2RHtml || (typeof module === 'object' && module.exports ? require('./vendor/html-parser.js') : null);
    if (!parser?.parse) throw failure('INVALID_RESPONSE');
    const fragment = parser.parse(body);
    const children = node => node?.childNodes || [];
    const attr = (node, name) => node?.attrs?.find(a => !a.namespace && a.name === name)?.value || '';
    const html = node => node?.namespaceURI === 'http://www.w3.org/1999/xhtml';
    const has = (node, name) => html(node) && attr(node, 'class').split(/\s+/).includes(name);
    function all(node, match) {
      const found = [], stack = node ? [node] : [];
      while (stack.length) { const n = stack.pop(); if (match(n)) found.push(n); const c = children(n); for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]); }
      return found;
    }
    const first = (node, match) => all(node, match)[0];
    const rawText = node => all(node, n => n.nodeName === '#text').map(n => n.value).join('');
    const title = rawText(first(fragment, n => html(n) && n.tagName === 'title')).trim();
    const regions = all(fragment, n => has(n, 'content') && has(n.parentNode, 'info') && has(n.parentNode, 'asninfo') && has(n.parentNode?.parentNode, 'container') && attr(n.parentNode?.parentNode?.parentNode, 'id') === 'check');
    if (regions.length !== 1) {
      // Only classify a verification page when the normal result region is absent.
      // Never execute challenge code or poll the site to resolve it.
      const marker = first(fragment, n => ['challenge-form','challenge-running','challenge-stage'].includes(attr(n, 'id')) || attr(n, 'id').startsWith('cf-chl') || has(n, 'cf-turnstile'));
      const challengeCode = all(fragment, n => html(n) && n.tagName === 'script').some(script => /(?:window\.)?_cf_chl_opt\s*=/.test(rawText(script)));
      if (challengeCode || (marker && /just a moment|attention required|verify|verification|验证|人机|安全检查/i.test(title))) throw failure('CHALLENGE');
      throw failure('INVALID_RESPONSE');
    }
    if (address(title.split('-')[0])?.ip !== target.ip) throw failure('INVALID_RESPONSE');
    const region = regions[0];
    // Verify a second, visible page reference agrees with the detected address.
    const ipRow = children(region).find(n => has(n, 'line') && has(n, 'ip'));
    const trace = first(first(ipRow, n => has(n, 'op')), n => html(n) && n.tagName === 'a' && !!attr(n, 'href'));
    let reference;
    try { reference = new URL(attr(trace, 'href')); } catch (_) { throw failure('INVALID_RESPONSE'); }
    if (!['http:', 'https:'].includes(reference.protocol) || reference.hostname !== 'ping0.cc' || reference.port || reference.username || reference.password || reference.search || reference.hash ||
        !['/ping/', '/trace/'].some(prefix => reference.pathname.startsWith(prefix) && address(decodeURIComponent(reference.pathname.slice(prefix.length)))?.ip === target.ip)) throw failure('INVALID_RESPONSE');
    const text = node => {
      if (!node) return '';
      const skip = new Set(['script','style','iframe','object','embed','svg','math','img','video','audio','link','meta','template','form','input','button']);
      const pieces = [], stack = [node];
      while (stack.length) {
        const n = stack.pop();
        if (n.nodeName === '#text') { pieces.push(n.value); continue; }
        if (skip.has(n.tagName) || (n.namespaceURI && !html(n)) || ['fielddesc','report','ispwhy','op'].some(c => has(n,c)) || n.attrs?.some(a => a.name.startsWith('v-'))) continue;
        const c = children(n); for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
      }
      const value = pieces.join('').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\s+/g, ' ').trim();
      if (value.length > 512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw failure('INVALID_RESPONSE');
      return value;
    };
    const fields = [
      ['location', 'loc', 'location'],
      ['asn', 'asn'], ['owner', 'asnname'], ['organization', 'orgname'],
      ['type', 'line-iptype'], ['risk', 'line-risk', 'riskcurrent'],
      ['native', 'line-nativeip'], ['sharing', 'line-usecount', 'usecountbar']
    ];
    const rows = [];
    for (const [id, selector, valueSelector] of fields) {
      const row = children(region).find(n => has(n, 'line') && has(n, selector));
      if (!row) continue;
      const content = children(row).find(n => has(n, 'content'));
      const location = valueSelector === 'location' ? children(children(content).find(n => html(n) && n.tagName === 'div')).find(n => html(n) && n.tagName === 'div') : null;
      const value = text(valueSelector === 'location' ? location : valueSelector ? first(content, n => has(n, valueSelector)) : content);
      const name = text(children(row).find(n => has(n, 'name')));
      if (name && value) rows.push(Object.freeze({id, name, value}));
    }
    if (!rows.some(r => r.id === 'location') || !rows.some(r => ['type','risk','sharing'].includes(r.id))) throw failure('INVALID_RESPONSE');
    return {provider: 'ping0-public-page', ip: target.ip, ipVersion: target.version, url: qualityURL(target.ip), rows: Object.freeze(rows)};
  }
  async function runPublicReport(options = {}) {
    const url = qualityURL(options.ip);
    return request(options, {url, fresh:false, publicPage:true}, body => parsePublicReport(body, options.ip), 512 * 1024);
  }

  async function runDownload(options = {}) {
    const bytes=options.bytes===undefined?10*1024*1024:options.bytes, timeoutMs=options.timeoutMs===undefined?15000:options.timeoutMs;
    const fetchImpl=options.fetchImpl===undefined?(typeof root.fetch==='function'?root.fetch.bind(root):null):options.fetchImpl, external=options.signal;
    if(!Number.isInteger(bytes)||bytes<1||bytes>100*1024*1024||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||typeof fetchImpl!=='function'||(external&&typeof external.addEventListener!=='function')||(options.onProgress!==undefined&&typeof options.onProgress!=='function'))throw failure('BAD_OPTIONS');
    if(external?.aborted)throw failure('CANCELLED');
    let total=0,reads=0,lastProgress=-Infinity,reader=null,timer,stopped='',done=false,rejectStop;const controller=new AbortController(),start=now();
    const stopping=new Promise((_,reject)=>{rejectStop=reject;});
    const stop=code=>{if(stopped||done)return;stopped=code;controller.abort();try{reader?.cancel().catch(()=>{});}catch(_){}rejectStop(failure(code));};
    const cancel=()=>stop('CANCELLED');external?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>stop('TIMEOUT'),timeoutMs);
    const stats=partial=>{const durationMs=Math.max(1,Math.round(now()-start));return Object.freeze({provider:'Cloudflare',bytes:total,limitBytes:bytes,durationMs,mbps:total*8/(durationMs*1000),megabytesPerSecond:total/(durationMs*1000),partial,checkedAt:new Date().toISOString()});};
    const request=async()=>{while(total<bytes){const amount=Math.min(bytes-total,10*1024*1024),before=total;const url=new URL('https://speed.cloudflare.com/__down');url.searchParams.set('bytes',String(amount));url.searchParams.set('_v2r',nonce());
      const response=await fetchImpl(url.href,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
      if(!response?.ok)throw failure('HTTP');if(response.redirected||response.type==='opaque'||!response.body?.getReader)throw failure('INVALID_RESPONSE');
      const contentType=response.headers?.get?.('content-type')||'';if(/(?:text\/html|application\/(?:json|xml)|text\/xml)/i.test(contentType))throw failure('INVALID_RESPONSE');
      const declared=response.headers?.get?.('content-length');if(declared&&/^\d+$/.test(declared)&&Number(declared)>amount)throw failure('TOO_LARGE');
      reader=response.body.getReader();try{while(true){if(stopped)throw failure(stopped);const part=await reader.read();if(stopped)throw failure(stopped);if(part.done)break;if(!(part.value instanceof Uint8Array))throw failure('INVALID_RESPONSE');if(++reads>131072)throw failure('TOO_LARGE');total+=part.value.byteLength;if(total-before>amount||total>bytes)throw failure('TOO_LARGE');if(part.value.byteLength&&(total===bytes||now()-lastProgress>=100)){lastProgress=now();options.onProgress?.({bytes:total,limitBytes:bytes});}}}
      finally{try{reader.cancel().catch(()=>{});}catch(_){}try{reader.releaseLock();}catch(_){} }
      if(total===before)throw failure('INVALID_RESPONSE');if(total-before<amount)return stats(true);
      }return stats(false);
    };
    try{const value=await Promise.race([request(),stopping]);done=true;return value;}
    catch(error){if(stopped==='TIMEOUT'&&total>0&&total<=bytes){done=true;return stats(true);}if(stopped)throw failure(stopped);if(error?.name==='IPCheckError')throw failure(error.code);throw failure('NETWORK');}
    finally{clearTimeout(timer);external?.removeEventListener('abort',cancel);if(!done){controller.abort();try{reader?.cancel().catch(()=>{});}catch(_){}}}
  }
  function qualityURL(ip) {
    const parsed = address(ip);
    if (!parsed) throw failure('BAD_OPTIONS');
    return 'https://ping0.cc/ip/' + encodeURIComponent(parsed.ip);
  }
  return Object.freeze({ PROVIDERS, runCheck, runPublicReport, parsePublicReport, runDownload, qualityURL });
});
