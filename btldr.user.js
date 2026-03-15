// ==UserScript==
// @name         Bilibili/YouTube AI Helper
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  AI-powered video analysis for Bilibili and YouTube - subtitles, comments, danmaku
// @author       btldr
// @match        *://*.bilibili.com/video/*
// @match        *://*.youtube.com/watch*
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────
    const DEFAULTS = {
        apiUrl: 'https://newapirn.12121232.xyz/v1/chat/completions',
        apiKey: '',
        model: 'gemini-3-flash-preview',
    };
    const cfg = {
        get: (k, d) => GM_getValue(`btldr_${k}`, d),
        set: (k, v) => GM_setValue(`btldr_${k}`, v),
    };

    // ── Prompts ─────────────────────────────────────────────
    const PROMPTS = {
        biliTldr: (title, url, subtitle) =>
            `请总结这个B站视频：\n标题: ${title}\n链接: ${url}\n\n字幕：\n${subtitle}`,
        biliComments: (title, url, comments) =>
            `请分析B站评论区：\n视频: ${title}\n链接: ${url}\n\n评论内容：\n${comments}\n\n请总结：1.主要观点 2.观众态度 3.有价值见解 4.争议话题`,
        biliDanmaku: (title, url, danmaku) =>
            `请分析B站视频弹幕：\n视频: ${title}\n链接: ${url}\n\n弹幕内容：\n${danmaku}\n\n请总结：1.观众主要关注点 2.弹幕高频词汇 3.观众整体情绪 4.有趣弹幕`,
        ytSummary: (title, url) =>
            `Analyze this YouTube video: ${url}\nTitle: ${title}\n\n请使用中文回答，总结视频主要内容。`,
        ytComments: (title, url, comments) =>
            `请分析YouTube视频评论区：\n视频标题: ${title}\n链接: ${url}\n\n评论内容：\n${comments}\n\n请总结：1.主要观点 2.观众态度 3.有价值见解 4.争议话题`,
    };

    // ── Helpers ───────────────────────────────────────────
    function gmGet(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                onload: r => {
                    if (r.status >= 200 && r.status < 300) {
                        try { resolve(JSON.parse(r.responseText)); }
                        catch { resolve(r.responseText); }
                    } else reject(new Error(`HTTP ${r.status}`));
                },
                onerror: () => reject(new Error('网络请求失败')),
            });
        });
    }

    // ── MD5 (Bilibili WBI signing) ───────────────────────
    function md5Hex(str) {
        const K=[0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
            0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
            0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
            0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
            0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
            0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
            0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
            0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
        const S=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
            4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
        const bytes=[];
        for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6),128|(c&63))}else{bytes.push(224|(c>>12),128|((c>>6)&63),128|(c&63))}}
        const origLen=bytes.length*8;bytes.push(0x80);while(bytes.length%64!==56)bytes.push(0);
        bytes.push(origLen&0xff,(origLen>>>8)&0xff,(origLen>>>16)&0xff,(origLen>>>24)&0xff,0,0,0,0);
        let[a0,b0,c0,d0]=[0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476];
        for(let i=0;i<bytes.length;i+=64){
            const M=[];for(let j=0;j<16;j++)M[j]=bytes[i+j*4]|(bytes[i+j*4+1]<<8)|(bytes[i+j*4+2]<<16)|(bytes[i+j*4+3]<<24);
            let[A,B,C,D]=[a0,b0,c0,d0];
            for(let j=0;j<64;j++){let F,g;if(j<16){F=(B&C)|(~B&D);g=j}else if(j<32){F=(D&B)|(~D&C);g=(5*j+1)%16}else if(j<48){F=B^C^D;g=(3*j+5)%16}else{F=C^(B|~D);g=(7*j)%16}F=(F+A+K[j]+M[g])|0;A=D;D=C;C=B;B=(B+((F<<S[j])|(F>>>(32-S[j]))))|0}
            a0=(a0+A)|0;b0=(b0+B)|0;c0=(c0+C)|0;d0=(d0+D)|0;
        }
        const hex=x=>{let r='';for(let i=0;i<4;i++)r+=((x>>>(i*8))&0xFF).toString(16).padStart(2,'0');return r};
        return hex(a0)+hex(b0)+hex(c0)+hex(d0);
    }

    // ── WBI Encryption (Bilibili comment API) ────────────
    const WBI_TAB=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
    let _wbiCache = { img: '', sub: '', ts: 0 };

    async function wbiKeys() {
        if (_wbiCache.img && Date.now() - _wbiCache.ts < 600000) return _wbiCache;
        const d = await gmGet('https://api.bilibili.com/x/web-interface/nav');
        _wbiCache.img = (d?.data?.wbi_img?.img_url || '').split('/').pop().split('.')[0];
        _wbiCache.sub = (d?.data?.wbi_img?.sub_url || '').split('/').pop().split('.')[0];
        _wbiCache.ts = Date.now();
        return _wbiCache;
    }

    async function wbiSign(params) {
        const { img, sub } = await wbiKeys();
        if (!img || !sub) return params;
        const raw = img + sub;
        let mk = ''; for (const i of WBI_TAB) if (i < raw.length) mk += raw[i]; mk = mk.slice(0, 32);
        params.wts = Math.floor(Date.now() / 1000);
        const qs = Object.keys(params).sort().map(k =>
            `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ''))}`
        ).join('&');
        params.w_rid = md5Hex(qs + mk);
        return params;
    }

    // ── Client-side Data Extraction ──────────────────────
    const Backend = {
        _viewCache: {},

        async _biliView(bvid) {
            if (this._viewCache[bvid]) return this._viewCache[bvid];
            const d = await gmGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
            if (d.code !== 0) throw new Error(d.message || 'API Error');
            this._viewCache[bvid] = d.data;
            return d.data;
        },

        async biliSubtitles(bvid) {
            const { cid, aid } = await this._biliView(bvid);
            const p = await gmGet(`https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`);
            const subs = p.data?.subtitle?.subtitles || [];
            if (!subs.length) throw new Error('该视频没有字幕');
            const sub = subs.find(s => s.lan === 'ai-zh') || subs.find(s => s.lan === 'zh-CN') || subs[0];
            let url = sub.subtitle_url;
            if (url.startsWith('//')) url = 'https:' + url;
            const raw = await gmGet(url);
            const body = (typeof raw === 'object' && raw.body) ? raw.body : [];
            return body.map(item => item.content).join('\n');
        },

        async biliComments(bvid) {
            const { aid } = await this._biliView(bvid);
            const lines = [];
            let offsetStr = '';
            for (let page = 0; page < 3 && lines.length < 200; page++) {
                const params = await wbiSign({
                    oid: aid, type: '1', mode: '3', plat: '1',
                    web_location: '1315875',
                    pagination_str: JSON.stringify({ offset: offsetStr })
                });
                const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
                const d = await gmGet(`https://api.bilibili.com/x/v2/reply/wbi/main?${qs}`);
                if (d.code !== 0) { if (!page) throw new Error(d.message || '评论获取失败'); break; }
                for (const r of [...(d.data?.top_replies || []), ...(d.data?.replies || [])]) {
                    const name = r.member?.uname || '', text = r.content?.message || '';
                    const likes = r.like ? `(👍${r.like})` : '';
                    lines.push(`@${name}${likes}: ${text}`);
                    for (const sub of (r.replies || []).slice(0, 3))
                        lines.push(`  ↳ @${sub.member?.uname || ''}: ${sub.content?.message || ''}`);
                }
                const cur = d.data?.cursor;
                if (cur?.is_end || !cur?.pagination_reply?.next_offset) break;
                offsetStr = cur.pagination_reply.next_offset;
            }
            if (!lines.length) throw new Error('未找到评论');
            return lines.join('\n');
        },

        async biliDanmaku(bvid) {
            const { cid } = await this._biliView(bvid);
            const xml = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url: `https://comment.bilibili.com/${cid}.xml`,
                    onload: r => resolve(r.responseText),
                    onerror: () => reject(new Error('弹幕获取失败')),
                });
            });
            const doc = new DOMParser().parseFromString(xml, 'text/xml');
            const items = [...doc.querySelectorAll('d')].map(d => d.textContent);
            if (!items.length) throw new Error('该视频没有弹幕');
            return items.join('\n');
        },

        async ytComments() {
            const ytcfg = typeof unsafeWindow !== 'undefined' && unsafeWindow?.ytcfg?.data_;
            if (!ytcfg?.INNERTUBE_API_KEY) throw new Error('无法获取YouTube配置，请刷新页面');
            const videoId = new URLSearchParams(location.search).get('v');
            if (!videoId) throw new Error('无法获取视频ID');

            function* searchDict(obj, key) {
                const stack = [obj];
                while (stack.length) {
                    const item = stack.pop();
                    if (item && typeof item === 'object') {
                        if (Array.isArray(item)) stack.push(...item);
                        else for (const [k, v] of Object.entries(item)) { if (k === key) yield v; else stack.push(v); }
                    }
                }
            }

            const nextResp = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${ytcfg.INNERTUBE_API_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: ytcfg.INNERTUBE_CONTEXT, videoId })
            }).then(r => r.json());

            let contEp = null;
            for (const s of searchDict(nextResp, 'itemSectionRenderer')) {
                for (const item of (s?.contents || [])) {
                    const ce = item?.continuationItemRenderer?.continuationEndpoint;
                    if (ce?.continuationCommand?.token) { contEp = ce; break; }
                }
                if (contEp) break;
            }
            if (!contEp) for (const ep of searchDict(nextResp, 'continuationEndpoint'))
                if (ep?.continuationCommand?.token) { contEp = ep; break; }
            if (!contEp) throw new Error('无法获取评论区');

            async function ytApi(ep) {
                const path = ep?.commandMetadata?.webCommandMetadata?.apiUrl;
                if (!path) return null;
                const r = await fetch(`https://www.youtube.com${path}?key=${ytcfg.INNERTUBE_API_KEY}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ context: ytcfg.INNERTUBE_CONTEXT, continuation: ep.continuationCommand?.token })
                });
                return r.ok ? r.json() : null;
            }

            const first = await ytApi(contEp);
            if (!first) throw new Error('评论请求失败');
            const sortEp = [...searchDict(first, 'sortFilterSubMenuRenderer')][0]?.subMenuItems?.[0]?.serviceEndpoint || contEp;

            const comments = [];
            const queue = [sortEp];
            let pages = 0;
            while (queue.length && pages < 10 && comments.length < 200) {
                const resp = await ytApi(queue.shift());
                if (!resp) continue;
                pages++;
                for (const c of searchDict(resp, 'commentEntityPayload')) {
                    const t = c.properties?.content?.content || '';
                    if (t) comments.push({ author: c.author?.displayName || '', text: t, votes: c.toolbar?.likeCountNotliked?.trim() || '0', isReply: (c.properties?.commentId || '').includes('.') });
                }
                for (const r of searchDict(resp, 'commentRenderer')) {
                    const t = r.contentText?.runs?.map(x => x.text).join('') || '';
                    if (t) comments.push({ author: r.authorText?.simpleText || '', text: t, votes: r.voteCount?.simpleText || '0', isReply: (r.commentId || '').includes('.') });
                }
                for (const a of [...searchDict(resp, 'appendContinuationItemsAction'), ...searchDict(resp, 'reloadContinuationItemsCommand')])
                    for (const item of (a.continuationItems || []))
                        for (const ep of searchDict(item, 'continuationEndpoint'))
                            if (comments.length < 200) queue.push(ep);
                await new Promise(r => setTimeout(r, 200));
            }
            if (!comments.length) throw new Error('未找到评论');
            const main = comments.filter(c => !c.isReply).slice(0, 100);
            const reps = comments.filter(c => c.isReply).slice(0, 50);
            const lines = main.map(c => `@${c.author}${c.votes !== '0' ? `(👍${c.votes})` : ''}: ${c.text}`);
            if (reps.length) { lines.push('', `--- 回复 (${reps.length}条) ---`); lines.push(...reps.map(r => `  ↳ @${r.author}: ${r.text}`)); }
            return lines.join('\n');
        },
    };

    // ── AI Streaming ────────────────────────────────────────
    const AI = {
        streamChat(messages, onChunk, onDone, onError) {
            const url = cfg.get('apiUrl', DEFAULTS.apiUrl);
            const key = cfg.get('apiKey', DEFAULTS.apiKey);
            const model = cfg.get('model', DEFAULTS.model);
            let lastLen = 0;
            let thinkTagSent = false;
            let contentStarted = false;
            let lineBuf = '';

            const processLines = (raw) => {
                lineBuf += raw;
                const lines = lineBuf.split(/\r?\n/);
                lineBuf = lines.pop();
                for (let line of lines) {
                    line = line.trim();
                    if (!line.startsWith('data:') || line === 'data: [DONE]' || line === 'data:[DONE]') continue;
                    const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
                    try {
                        const d = JSON.parse(payload);
                        const delta = d.choices?.[0]?.delta;
                        if (delta?.reasoning_content) {
                            if (!thinkTagSent) { onChunk('<think>'); thinkTagSent = true; }
                            onChunk(delta.reasoning_content);
                        }
                        if (delta?.content) {
                            if (thinkTagSent && !contentStarted) { onChunk('</think>'); contentStarted = true; }
                            onChunk(delta.content);
                        }
                    } catch {}
                }
            };

            return GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                data: JSON.stringify({ model, messages, stream: true }),
                onprogress(res) {
                    if (typeof res.responseText !== 'string') return;
                    const chunk = res.responseText.substring(lastLen);
                    lastLen = res.responseText.length;
                    processLines(chunk);
                },
                onload(res) {
                    if (res.status < 200 || res.status >= 300) {
                        onError(`HTTP ${res.status}`);
                        return;
                    }
                    if (lineBuf) processLines('\n');
                    onDone();
                },
                onerror: () => onError('网络请求失败'),
            });
        },
    };

    // ── Thinking parser ─────────────────────────────────────
    function parseThinking(text) {
        if (!text) return { thinking: '', content: '' };
        let thinking = [], main = text;
        const closed = [/<think>([\s\S]*?)<\/think>/gi, /<thinking>([\s\S]*?)<\/thinking>/gi];
        for (const p of closed) {
            p.lastIndex = 0;
            let m;
            while ((m = p.exec(main)) !== null) {
                if (m[1].trim()) thinking.push(m[1].trim());
                main = main.replace(m[0], '');
                p.lastIndex = 0;
            }
        }
        const unclosed = /<think>/i;
        const sm = main.match(unclosed);
        if (sm && !/<\/think>/i.test(main)) {
            const idx = main.indexOf(sm[0]);
            const tail = main.slice(idx + sm[0].length).trim();
            if (tail) { thinking.push(tail + ' ⏳'); main = main.slice(0, idx); }
        }
        return { thinking: thinking.join('\n\n'), content: main.trim() };
    }

    function renderMd(text, isStreaming = false) {
        const { thinking, content } = parseThinking(text);
        let html = '';
        if (thinking) {
            const thinkHtml = DOMPurify.sanitize(marked.parse(thinking));
            const status = isStreaming ? '思考中...' : `${thinking.length} 字符`;
            html += `<div class="btldr-think ${isStreaming ? 'streaming' : ''}">
                <div class="btldr-think-hd" data-think-toggle>
                    <span>💭 思考过程 <small>${status}</small></span>
                    <span class="btldr-think-arrow">▶</span>
                </div>
                <div class="btldr-think-body">${thinkHtml}</div>
            </div>`;
        }
        if (content) html += DOMPurify.sanitize(marked.parse(content));
        return html;
    }

    // ── Site detection ──────────────────────────────────────
    const Site = {
        isBilibili: () => location.hostname.includes('bilibili.com'),
        isYouTube: () => location.hostname.includes('youtube.com'),
        getBvid() {
            const m = location.pathname.match(/\/video\/(BV[\w]+)/i);
            return m ? m[1] : null;
        },
        getYtId() {
            return new URLSearchParams(location.search).get('v');
        },
        getTitle() {
            if (this.isBilibili()) {
                const el = document.querySelector('h1.video-title, .video-title .tit');
                return el?.textContent?.trim() || document.title.replace(/_哔哩哔哩.*/, '').trim();
            }
            const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title');
            return el?.textContent?.trim() || document.title.replace(/ - YouTube$/, '').trim();
        },
    };

    // ── CSS ──────────────────────────────────────────────────
    const STYLES = `
:host {
    --gold: #E3A043;
    --gold-h: #d48f35;
    --bg: #FFFFFF;
    --bg2: #F9FAFB;
    --bg-h: #F2F2F2;
    --fg: #111827;
    --fg2: #4B5563;
    --fg3: #9CA3AF;
    --border: #E5E7EB;
    --shadow: 0 4px 12px rgba(0,0,0,0.08);
    --radius: 8px;
    --sidebar-w: 420px;
    --btn-sz: 42px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
@media(prefers-color-scheme:dark){
:host {
    --bg: #1E1E1E;
    --bg2: #111111;
    --bg-h: #2D2D2D;
    --fg: #F3F4F6;
    --fg2: #D1D5DB;
    --fg3: #6B7280;
    --border: #374151;
    --shadow: 0 4px 12px rgba(0,0,0,0.4);
}}
* { box-sizing: border-box; margin: 0; padding: 0; }

.btldr-btn {
    position: fixed; z-index: 99999;
    width: var(--btn-sz); height: var(--btn-sz);
    background: var(--bg); color: var(--fg2);
    border: 1px solid var(--border); border-right: none;
    border-radius: var(--radius) 0 0 var(--radius);
    box-shadow: var(--shadow);
    cursor: grab; display: flex; align-items: center; justify-content: center;
    user-select: none; transition: all .2s;
    right: 0; top: 50%;
    font-size: 18px;
}
.btldr-btn:hover { color: var(--gold); transform: scale(1.05); }
.btldr-btn:active { cursor: grabbing; transform: scale(0.96); }

.btldr-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: var(--sidebar-w); max-width: 90vw;
    background: var(--bg); border-left: 1px solid var(--border);
    box-shadow: var(--shadow); z-index: 99998;
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform .3s cubic-bezier(.4,0,.2,1);
}
.btldr-panel.open { transform: translateX(0); }

.btldr-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; border-bottom: 1px solid var(--border);
    font-weight: 600; font-size: 15px; color: var(--fg);
}
.btldr-hd-close {
    background: none; border: none; cursor: pointer;
    font-size: 18px; color: var(--fg3); padding: 4px;
}
.btldr-hd-close:hover { color: var(--fg); }

.btldr-tabs {
    display: flex; border-bottom: 1px solid var(--border);
}
.btldr-tab {
    flex: 1; padding: 10px; text-align: center;
    cursor: pointer; font-size: 13px; color: var(--fg2);
    border-bottom: 2px solid transparent;
    transition: all .15s;
}
.btldr-tab:hover { background: var(--bg-h); }
.btldr-tab.active { color: var(--gold); border-bottom-color: var(--gold); font-weight: 600; }

.btldr-page { display: none; flex: 1; overflow-y: auto; padding: 16px; }
.btldr-page.active { display: flex; flex-direction: column; gap: 12px; }

.btldr-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.btldr-act {
    padding: 8px 14px; border-radius: 6px;
    border: 1px solid var(--border); background: var(--bg2);
    cursor: pointer; font-size: 13px; color: var(--fg);
    transition: all .15s; display: flex; align-items: center; gap: 6px;
}
.btldr-act:hover { border-color: var(--gold); color: var(--gold); }
.btldr-act:disabled { opacity: .5; cursor: not-allowed; }
.btldr-act.loading { position: relative; color: var(--fg3); }

.btldr-result {
    flex: 1; overflow-y: auto; font-size: 14px; line-height: 1.7; color: var(--fg);
}
.btldr-result h1,.btldr-result h2,.btldr-result h3 { margin: 12px 0 6px; color: var(--fg); }
.btldr-result p { margin: 6px 0; }
.btldr-result ul,.btldr-result ol { padding-left: 20px; margin: 6px 0; }
.btldr-result code { background: var(--bg2); padding: 2px 5px; border-radius: 3px; font-size: 13px; }
.btldr-result pre { background: var(--bg2); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 8px 0; }
.btldr-result blockquote { border-left: 3px solid var(--gold); padding-left: 12px; color: var(--fg2); margin: 8px 0; }

.btldr-loading {
    display: flex; align-items: center; gap: 8px; color: var(--fg3); font-size: 13px;
}
.btldr-dots { display: flex; gap: 4px; }
.btldr-dots span {
    width: 6px; height: 6px; border-radius: 50%; background: var(--gold);
    animation: btldr-bounce .6s infinite alternate;
}
.btldr-dots span:nth-child(2) { animation-delay: .2s; }
.btldr-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes btldr-bounce { to { opacity: .3; transform: translateY(-4px); } }

.btldr-think {
    margin-bottom: 12px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
}
.btldr-think-hd {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: var(--bg2); cursor: pointer;
    font-size: 13px; color: var(--fg2);
}
.btldr-think-hd small { color: var(--fg3); margin-left: 8px; }
.btldr-think-arrow { transition: transform .2s; font-size: 10px; }
.btldr-think.expanded .btldr-think-arrow { transform: rotate(90deg); }
.btldr-think-body {
    max-height: 0; overflow: hidden; transition: max-height .3s;
    padding: 0 12px; font-size: 13px; color: var(--fg3);
}
.btldr-think.expanded .btldr-think-body { max-height: 2000px; padding: 10px 12px; }
.btldr-think.streaming .btldr-think-hd { color: var(--gold); }

/* Settings */
.btldr-field { display: flex; flex-direction: column; gap: 4px; }
.btldr-label { font-size: 12px; font-weight: 600; color: var(--fg2); }
.btldr-input {
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg2); color: var(--fg); font-size: 13px;
    outline: none; transition: border-color .15s;
}
.btldr-input:focus { border-color: var(--gold); }
.btldr-save {
    padding: 10px; border: none; border-radius: 6px;
    background: var(--gold); color: #fff; font-weight: 600;
    cursor: pointer; font-size: 14px; transition: background .15s;
}
.btldr-save:hover { background: var(--gold-h); }
.btldr-toast {
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: var(--gold); color: #fff; padding: 8px 20px;
    border-radius: 6px; font-size: 13px; z-index: 100000;
    opacity: 0; transition: opacity .3s; pointer-events: none;
}
.btldr-toast.show { opacity: 1; }
`;

    // ── UI ───────────────────────────────────────────────────
    class UI {
        constructor() {
            this.isOpen = false;
            this.aiText = '';
            this.busy = false;
            this.requestId = 0;
            this.streamReq = null;
            this.lastUrl = location.href;
            this._createHost();
            this._render();
            this._bind();
            this._watchNav();
        }

        _createHost() {
            this.host = document.createElement('div');
            this.host.id = 'btldr-host';
            document.body.appendChild(this.host);
            this.shadow = this.host.attachShadow({ mode: 'closed' });
            const s = document.createElement('style');
            s.textContent = STYLES;
            this.shadow.appendChild(s);
        }

        Q(sel) { return this.shadow.querySelector(sel); }

        _render() {
            const wrap = document.createElement('div');
            wrap.innerHTML = `
                <div class="btldr-btn" id="btn">✦</div>
                <div class="btldr-panel" id="panel">
                    <div class="btldr-hd">
                        <span>✦ AI Helper</span>
                        <button class="btldr-hd-close" id="close">✕</button>
                    </div>
                    <div class="btldr-tabs">
                        <div class="btldr-tab active" data-tab="result">📋 结果</div>
                        <div class="btldr-tab" data-tab="settings">⚙ 设置</div>
                    </div>
                    <div class="btldr-page active" id="page-result">
                        <div class="btldr-actions" id="actions"></div>
                        <div class="btldr-result" id="result"></div>
                    </div>
                    <div class="btldr-page" id="page-settings">
                        <div class="btldr-field">
                            <label class="btldr-label">API 地址</label>
                            <input class="btldr-input" id="s-url" type="text">
                        </div>
                        <div class="btldr-field">
                            <label class="btldr-label">API Key</label>
                            <input class="btldr-input" id="s-key" type="password">
                        </div>
                        <div class="btldr-field">
                            <label class="btldr-label">模型名称</label>
                            <input class="btldr-input" id="s-model" type="text">
                        </div>
                        <button class="btldr-save" id="s-save">💾 保存设置</button>
                    </div>
                </div>
                <div class="btldr-toast" id="toast"></div>`;
            this.shadow.appendChild(wrap);
            this._loadSettings();
            this._buildActions();
        }

        _loadSettings() {
            this.Q('#s-url').value = cfg.get('apiUrl', DEFAULTS.apiUrl);
            this.Q('#s-key').value = '';
            this.Q('#s-key').placeholder = cfg.get('apiKey', DEFAULTS.apiKey) ? '••••••••' : '输入 API Key';
            this.Q('#s-model').value = cfg.get('model', DEFAULTS.model);
        }

        _buildActions() {
            const box = this.Q('#actions');
            box.innerHTML = '';
            if (Site.isBilibili() && Site.getBvid()) {
                box.innerHTML = `
                    <button class="btldr-act" data-action="bili-tldr">📝 AI TLDR</button>
                    <button class="btldr-act" data-action="bili-comments">💬 评论分析</button>
                    <button class="btldr-act" data-action="bili-danmaku">🎯 弹幕分析</button>`;
            } else if (Site.isYouTube() && Site.getYtId()) {
                box.innerHTML = `
                    <button class="btldr-act" data-action="yt-summary">📝 AI Summary</button>
                    <button class="btldr-act" data-action="yt-comments">💬 评论分析</button>`;
            } else {
                box.innerHTML = '<span style="color:var(--fg3);font-size:13px">请在视频页面使用</span>';
            }
        }

        _bind() {
            const btn = this.Q('#btn');
            const panel = this.Q('#panel');

            // Drag (pointer events for touch compatibility)
            let dragging = false, dragged = false, startY = 0;
            btn.addEventListener('pointerdown', e => {
                dragging = true; dragged = false; startY = e.clientY;
                btn.setPointerCapture(e.pointerId);
                e.preventDefault();
            });
            btn.addEventListener('pointermove', e => {
                if (!dragging) return;
                if (Math.abs(e.clientY - startY) > 5) dragged = true;
                btn.style.top = Math.max(50, Math.min(window.innerHeight - 60, e.clientY)) + 'px';
            });
            btn.addEventListener('pointerup', () => {
                if (dragging) { dragging = false; if (!dragged) this._toggle(); }
            });

            // Close
            this.Q('#close').addEventListener('click', () => this._toggle(false));

            // Tabs
            this.shadow.querySelectorAll('.btldr-tab').forEach(t => {
                t.addEventListener('click', () => {
                    this.shadow.querySelectorAll('.btldr-tab').forEach(x => x.classList.toggle('active', x === t));
                    this.shadow.querySelectorAll('.btldr-page').forEach(p => p.classList.toggle('active', p.id === `page-${t.dataset.tab}`));
                });
            });

            // Save settings
            this.Q('#s-save').addEventListener('click', () => {
                cfg.set('apiUrl', this.Q('#s-url').value.trim());
                const newKey = this.Q('#s-key').value.trim();
                if (newKey) cfg.set('apiKey', newKey);
                cfg.set('model', this.Q('#s-model').value.trim());
                this.Q('#s-key').value = '';
                this.Q('#s-key').placeholder = '••••••••';
                this._toast('设置已保存');
            });

            // Actions
            this.Q('#actions').addEventListener('click', e => {
                const act = e.target.closest('[data-action]');
                if (!act || this.busy) return;
                this._runAction(act.dataset.action);
            });

            // Thinking block toggle (event delegation)
            this.Q('#result').addEventListener('click', e => {
                const toggle = e.target.closest('[data-think-toggle]');
                if (toggle) toggle.parentElement.classList.toggle('expanded');
            });
        }

        _toggle(force) {
            this.isOpen = force !== undefined ? force : !this.isOpen;
            this.Q('#panel').classList.toggle('open', this.isOpen);
            document.body.style.transition = 'margin .3s cubic-bezier(.4,0,.2,1)';
            document.body.style.marginRight = this.isOpen ? '420px' : '';
        }

        _toast(msg) {
            const t = this.Q('#toast');
            t.textContent = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2000);
        }

        _showLoading(msg = '加载中...') {
            this.Q('#result').innerHTML = `<div class="btldr-loading">
                <div class="btldr-dots"><span></span><span></span><span></span></div>${msg}</div>`;
        }

        _showError(msg) {
            const el = this.Q('#result');
            el.textContent = '';
            const div = document.createElement('div');
            div.style.cssText = 'color:#d93025;font-size:13px';
            div.textContent = '❌ ' + msg;
            el.appendChild(div);
        }

        _setActionsDisabled(disabled) {
            this.shadow.querySelectorAll('.btldr-act').forEach(b => b.disabled = disabled);
        }

        async _runAction(action) {
            this.busy = true;
            this._setActionsDisabled(true);
            this.aiText = '';
            const rid = ++this.requestId;
            const title = Site.getTitle();
            const url = location.href;

            try {
                let prompt;
                switch (action) {
                    case 'bili-tldr': {
                        const bvid = Site.getBvid();
                        this._showLoading('获取字幕...');
                        const res = await Backend.biliSubtitles(bvid);
                        const subtitle = typeof res === 'string' ? res : (res.data || res.subtitles || JSON.stringify(res));
                        prompt = PROMPTS.biliTldr(title, url, subtitle);
                        break;
                    }
                    case 'bili-comments': {
                        const bvid = Site.getBvid();
                        this._showLoading('获取评论...');
                        const res = await Backend.biliComments(bvid);
                        const comments = typeof res === 'string' ? res : (res.data || res.comments || JSON.stringify(res));
                        prompt = PROMPTS.biliComments(title, url, comments);
                        break;
                    }
                    case 'bili-danmaku': {
                        const bvid = Site.getBvid();
                        this._showLoading('获取弹幕...');
                        const res = await Backend.biliDanmaku(bvid);
                        const danmaku = typeof res === 'string' ? res : (res.data || res.danmaku || JSON.stringify(res));
                        prompt = PROMPTS.biliDanmaku(title, url, danmaku);
                        break;
                    }
                    case 'yt-summary': {
                        prompt = PROMPTS.ytSummary(title, url);
                        break;
                    }
                    case 'yt-comments': {
                        this._showLoading('获取评论...');
                        const res = await Backend.ytComments();
                        const comments = typeof res === 'string' ? res : (res.data || res.comments || JSON.stringify(res));
                        prompt = PROMPTS.ytComments(title, url, comments);
                        break;
                    }
                }

                this._showLoading('AI 分析中...');
                const resultBox = this.Q('#result');
                this.streamReq = AI.streamChat(
                    [{ role: 'user', content: prompt }],
                    chunk => {
                        if (this.requestId !== rid) return;
                        this.aiText += chunk;
                        resultBox.innerHTML = renderMd(this.aiText, true);
                        resultBox.scrollTop = resultBox.scrollHeight;
                    },
                    () => {
                        if (this.requestId !== rid) return;
                        this.streamReq = null;
                        resultBox.innerHTML = renderMd(this.aiText, false);
                        this.busy = false;
                        this._setActionsDisabled(false);
                    },
                    err => {
                        if (this.requestId !== rid) return;
                        this.streamReq = null;
                        this._showError(err);
                        this.busy = false;
                        this._setActionsDisabled(false);
                    },
                );
            } catch (err) {
                this._showError(err.message);
                this.busy = false;
                this._setActionsDisabled(false);
            }
        }

        _watchNav() {
            setInterval(() => {
                if (location.href !== this.lastUrl) {
                    this.lastUrl = location.href;
                    if (this.streamReq) { try { this.streamReq.abort(); } catch {} this.streamReq = null; }
                    this.requestId++;
                    this.busy = false;
                    this._setActionsDisabled(false);
                    this._buildActions();
                    this.Q('#result').innerHTML = '';
                    this.aiText = '';
                }
            }, 1000);
        }
    }

    // ── Init ─────────────────────────────────────────────────
    let _ui;
    GM_registerMenuCommand('打开 AI Helper', () => {
        if (_ui) _ui._toggle(true);
    });

    if (document.readyState === 'complete') _ui = new UI();
    else window.addEventListener('load', () => { _ui = new UI(); });
})();
