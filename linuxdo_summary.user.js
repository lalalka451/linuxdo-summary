// ==UserScript==
// @name         Linux.do 智能总结
// @namespace    http://tampermonkey.net/
// @version      7.9.7
// @description  Linux.do 帖子总结与导出，集成HTML离线导出和AI文本导出功能，支持话题列表总结，支持API配置历史管理，支持话题列表一键快速总结。
// @author       半杯无糖、WolfHolo、LD Export
// @match        https://linux.do/*
// @icon         https://linux.do/uploads/default/original/4X/c/c/d/ccd8c210609d498cbeb3d5201d4c259348447562.png
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
// @license      MIT
// @downloadURL https://cdn.jsdelivr.net/gh/lalalka451/linuxdo-summary@latest/linuxdo_summary.user.js
// @updateURL   https://cdn.jsdelivr.net/gh/lalalka451/linuxdo-summary@latest/linuxdo_summary.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================================
    // 1. 配置区 (CONFIG)
    // =================================================================================
    const CONFIG = {
        apiHistoryKey: 'ld_summary_api_history',
        lastUsedConfigKey: 'ld_summary_last_used_config',
        maxHistoryItems: 10,
        summaryCacheKey: 'ld_summary_cache',
        maxSummaryCache: 10,
    };

    // =================================================================================
    // 2. API历史管理模块 (API HISTORY)
    // =================================================================================
    const ApiHistory = {
        // 获取所有历史配置
        getAll() {
            return GM_getValue(CONFIG.apiHistoryKey, []);
        },

        // 保存当前配置到历史，返回配置ID
        save(url, key, model) {
            if (!url || !key) return null;

            const history = this.getAll();
            const timestamp = new Date().toLocaleString('zh-CN');
            const maskedKey = key.length > 8 ? key.slice(0, 4) + '****' + key.slice(-4) : '****';

            // 创建新配置项
            const newItem = {
                id: Date.now(),
                url: url,
                key: key,
                model: model,
                maskedKey: maskedKey,
                name: `${model} @ ${new URL(url).hostname}`,
                timestamp: timestamp
            };

            // 检查是否已存在相同配置（url + key + model 都相同）
            const existingIndex = history.findIndex(item =>
                item.url === url && item.key === key && item.model === model
            );

            let savedId;
            if (existingIndex !== -1) {
                // 更新时间戳
                history[existingIndex].timestamp = timestamp;
                savedId = history[existingIndex].id;
                // 移到最前面
                const item = history.splice(existingIndex, 1)[0];
                history.unshift(item);
            } else {
                // 添加新配置到最前面
                history.unshift(newItem);
                savedId = newItem.id;
                // 限制历史数量
                if (history.length > CONFIG.maxHistoryItems) {
                    history.pop();
                }
            }

            GM_setValue(CONFIG.apiHistoryKey, history);
            return savedId;
        },

        // 删除指定配置
        delete(id) {
            const history = this.getAll();
            const newHistory = history.filter(item => item.id !== id);
            GM_setValue(CONFIG.apiHistoryKey, newHistory);
            return newHistory;
        },

        // 获取指定配置
        get(id) {
            const history = this.getAll();
            return history.find(item => item.id === id);
        },

        // 获取上次使用的配置ID
        getLastUsedId() {
            return GM_getValue(CONFIG.lastUsedConfigKey, null);
        },

        // 设置上次使用的配置ID
        setLastUsedId(id) {
            GM_setValue(CONFIG.lastUsedConfigKey, id);
        },

        // 获取上次使用的配置（如果存在）
        getLastUsed() {
            const lastId = this.getLastUsedId();
            if (!lastId) return null;
            return this.get(lastId);
        }
    };

    // =================================================================================
    // 2.5 总结缓存模块 (SUMMARY CACHE)
    // =================================================================================
    const SummaryCache = {
        getAll() { return GM_getValue(CONFIG.summaryCacheKey, []); },
        get(tid) { return this.getAll().find(i => i.tid === String(tid)); },
        save(tid, title, content) {
            const list = this.getAll();
            const idx = list.findIndex(i => i.tid === String(tid));
            const item = { tid: String(tid), title, content, time: new Date().toLocaleString('zh-CN') };
            if (idx !== -1) list.splice(idx, 1);
            list.unshift(item);
            if (list.length > CONFIG.maxSummaryCache) list.pop();
            GM_setValue(CONFIG.summaryCacheKey, list);
        },
        delete(tid) {
            GM_setValue(CONFIG.summaryCacheKey, this.getAll().filter(i => i.tid !== String(tid)));
        }
    };


    // =================================================================================
    // 3. 核心逻辑模块 (CORE LOGIC)
    //    这部分代码与UI完全解耦，处理数据获取和API请求等。
    // =================================================================================
    const Core = {
        getTopicId: () => window.location.href.match(/\/topic\/(\d+)/)?.[1],

        parseThinkingContent(text) {
            if (!text) return { thinking: '', content: '' };

            let thinkingParts = [];
            let mainContent = text;

            const thinkingPatterns = [
                /<think>([\s\S]*?)<\/think>/gi,
                /<thinking>([\s\S]*?)<\/thinking>/gi,
                /<reason>([\s\S]*?)<\/reason>/gi,
                /<reasoning>([\s\S]*?)<\/reasoning>/gi,
                /<reflection>([\s\S]*?)<\/reflection>/gi,
                /<inner_thought>([\s\S]*?)<\/inner_thought>/gi,
                /<think>([\s\S]*?)<\\think>/gi,
                /<thinking>([\s\S]*?)<\\thinking>/gi,
                /<\|think\|>([\s\S]*?)<\|\/think\|>/gi,
                /<\|thinking\|>([\s\S]*?)<\|\/thinking\|>/gi,
                /\[think\]([\s\S]*?)\[\/think\]/gi,
                /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
            ];

            for (const pattern of thinkingPatterns) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(mainContent)) !== null) {
                    const thinkContent = match[1].trim();
                    if (thinkContent) {
                        thinkingParts.push(thinkContent);
                    }
                    mainContent = mainContent.replace(match[0], '');
                    pattern.lastIndex = 0;
                }
            }

            const unclosedPatterns = [
                { start: /<think>/i, end: /<\/think>|<\\think>/i, tag: '<think>' },
                { start: /<thinking>/i, end: /<\/thinking>|<\\thinking>/i, tag: '<thinking>' },
                { start: /<\|think\|>/i, end: /<\|\/think\|>/i, tag: '<|think|>' },
            ];

            for (const { start, end, tag } of unclosedPatterns) {
                const startMatch = mainContent.match(start);
                if (startMatch && !end.test(mainContent)) {
                    const startIdx = mainContent.indexOf(startMatch[0]);
                    const thinkContent = mainContent.slice(startIdx + startMatch[0].length).trim();
                    if (thinkContent) {
                        thinkingParts.push(thinkContent + ' ⏳');
                        mainContent = mainContent.slice(0, startIdx);
                    }
                    break;
                }
            }

            return {
                thinking: thinkingParts.join('\n\n'),
                content: mainContent.trim()
            };
        },

        getReplyCount: () => {
            const el = document.querySelector('.timeline-replies');
            if (!el) return 0;
            const txt = el.textContent.trim();
            return parseInt(txt.includes('/') ? txt.split('/')[1] : txt) || 0;
        },

        async fetchDialogues(building, start, end) {
            const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
            const opts = { headers: { 'x-csrf-token': csrf, 'x-requested-with': 'XMLHttpRequest' } };

            const idRes = await fetch(`https://linux.do/t/${building}/post_ids.json?post_number=0&limit=99999`, opts);
            const idData = await idRes.json();
            let pIds = idData.post_ids.slice(Math.max(0, start - 1), end);

            if (start <= 1) {
                const mainRes = await fetch(`https://linux.do/t/${building}.json`, opts);
                const mainData = await mainRes.json();
                const firstId = mainData.post_stream.posts[0].id;
                if (!pIds.includes(firstId)) pIds.unshift(firstId);
            }

            let text = "";
            const postsMap = new Map();

            for (let i = 0; i < pIds.length; i += 200) {
                const chunk = pIds.slice(i, i + 200);
                const q = chunk.map(id => `post_ids[]=${id}`).join('&');
                const res = await fetch(`https://linux.do/t/${building}/posts.json?${q}&include_suggested=false`, opts);
                const data = await res.json();

                data.post_stream.posts.forEach(p => {
                    postsMap.set(p.post_number, {
                        name: p.name || p.username,
                        username: p.username,
                        replyTo: p.reply_to_post_number,
                        replyToUser: p.reply_to_user
                    });
                });

                text += data.post_stream.posts.map(p => {
                    let content = p.cooked;
                    content = content.replace(/<div class="lightbox-wrapper">\s*<a class="lightbox" href="([^"]+)"(?:\s+data-download-href="([^"]+)")?[^>]*title="([^"]*)"[^>]*>[\s\S]*?<\/a>\s*<\/div>/gi, (match, hrefUrl, downloadHref, title) => {
                        let imgUrl = hrefUrl || `https://linux.do${downloadHref || ''}`;
                        const filename = title || '图片';
                        return `\n[图片: ${filename}](${imgUrl})\n`;
                    });
                    content = content.replace(/<a class="attachment" href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, (match, url, name) => `\n[附件: ${name.trim()}](${url})\n`);
                    content = content.replace(/<img[^>]+class="emoji[^>]*alt="([^"]*)"[^>]*>/gi, '$1 ');
                    content = content.replace(/<aside class="quote(?:-modified)?[^>]*>[\s\S]*?<blockquote>([\s\S]*?)<\/blockquote>[\s\S]*?<\/aside>/gi, (match, quoteInner) => {
                        let cleanQuote = quoteInner.replace(/<[^>]+>/g, '').trim();
                        return `\n[引用]\n${cleanQuote}\n[/引用]\n`;
                    });
                    content = content.replace(/<[^>]+>/g, '').trim();
                    const userName = p.name || p.username;
                    const userPart = `${userName}（${p.username}）`;
                    let replyPart = '';
                    if (p.reply_to_post_number && p.reply_to_user) {
                        const replyToName = p.reply_to_user.name || p.reply_to_user.username;
                        const replyToUsername = p.reply_to_user.username;
                        replyPart = `-回复[${p.reply_to_post_number}楼] ${replyToName}（${replyToUsername}）`;
                    }
                    return `[${p.post_number}楼] ${userPart}${replyPart}:\n${content}`;
                }).join('\n\n');
            }
            return text;
        },

        async streamChat(messages, onChunk, onDone, onError) {
            const key = GM_getValue('apiKey', '');
            const url = GM_getValue('apiUrl', 'https://api.openai.com/v1/chat/completions');
            const model = GM_getValue('model', 'deepseek-chat');
            const useStream = GM_getValue('useStream', true);

            if (!key) return onError("未配置 API Key，请先在设置中配置");

            let contentStarted = false;
            let thinkTagSent = false;
            let lastProcessedLength = 0;

            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                data: JSON.stringify({ model, messages, stream: useStream }),
                responseType: useStream ? 'stream' : 'json',
                onloadstart: function(res) {
                    if (useStream && res.response) {
                        const reader = res.response.getReader();
                        const decoder = new TextDecoder();
                        const read = () => {
                            reader.read().then(({ done, value }) => {
                                if (done) {
                                    if (thinkTagSent && !contentStarted) {
                                        onChunk('</think>');
                                    }
                                    onDone();
                                    return;
                                }
                                const lines = decoder.decode(value, { stream: true }).split('\n');
                                for (const line of lines) {
                                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                        try {
                                            const json = JSON.parse(line.slice(6));
                                            const delta = json.choices?.[0]?.delta;
                                            if (delta?.reasoning_content) {
                                                if (!thinkTagSent) {
                                                    onChunk('<think>');
                                                    thinkTagSent = true;
                                                }
                                                onChunk(delta.reasoning_content);
                                            }
                                            if (delta?.content) {
                                                if (thinkTagSent && !contentStarted) {
                                                    onChunk('</think>');
                                                    contentStarted = true;
                                                }
                                                onChunk(delta.content);
                                            }
                                        } catch(e){}
                                    }
                                }
                                read();
                            }).catch(e => onError(e.message));
                        };
                        read();
                    }
                },
                onprogress: function(res) {
                    if (!useStream) return;
                    if (res.response && typeof res.response === 'string') {
                        const newData = res.response.substring(lastProcessedLength);
                        lastProcessedLength = res.response.length;
                        const lines = newData.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                try {
                                    const json = JSON.parse(line.slice(6));
                                    const delta = json.choices?.[0]?.delta;
                                    if (delta?.reasoning_content) {
                                        if (!thinkTagSent) {
                                            onChunk('<think>');
                                            thinkTagSent = true;
                                        }
                                        onChunk(delta.reasoning_content);
                                    }
                                    if (delta?.content) {
                                        if (thinkTagSent && !contentStarted) {
                                            onChunk('</think>');
                                            contentStarted = true;
                                        }
                                        onChunk(delta.content);
                                    }
                                } catch(e){}
                            }
                        }
                    }
                },
                onload: function(res) {
                    if (res.status < 200 || res.status >= 300) {
                        onError(`HTTP ${res.status}`);
                        return;
                    }
                    if (!useStream) {
                        try {
                            const data = typeof res.response === 'string' ? JSON.parse(res.response) : res.response;
                            const message = data.choices?.[0]?.message;
                            let fullContent = '';
                            if (message?.reasoning_content) {
                                fullContent += `<think>${message.reasoning_content}</think>`;
                            }
                            if (message?.content) {
                                fullContent += message.content;
                            }
                            if (fullContent) onChunk(fullContent);
                            onDone();
                        } catch(e) {
                            onError(e.message);
                        }
                    } else {
                        if (thinkTagSent && !contentStarted) {
                            onChunk('</think>');
                        }
                        onDone();
                    }
                },
                onerror: function(e) {
                    onError(e.message || '网络请求失败');
                }
            });
        },

        // ========== 导出功能相关工具函数 ==========

        // 辅助函数：绝对URL转换
        absoluteUrl(src) {
            if (!src) return "";
            if (src.startsWith("http://") || src.startsWith("https://")) return src;
            if (src.startsWith("//")) return window.location.protocol + src;
            if (src.startsWith("/")) return window.location.origin + src;
            return window.location.origin + "/" + src.replace(/^\.?\//, "");
        },

        // 辅助函数：HTML转义
        escapeHtml(s) {
            return (s ?? "").toString()
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        },

        // 辅助函数：解码HTML实体
        decodeEntities(str) {
            const el = document.createElement("textarea");
            el.innerHTML = str || "";
            return el.value;
        },

        // 下载文件（优先GM_download，失败则回退到<a download>）
        downloadFile(content, filename, type) {
            const blob = new Blob([content], { type });
            const url = URL.createObjectURL(blob);

            let usedGm = false;
            try {
                if (typeof GM_download === "function") {
                    usedGm = true;
                    GM_download({
                        url,
                        name: filename,
                        saveAs: false,
                        onerror: function (err) {
                            console.warn("GM_download 失败，回退到 <a download> 方式：", err);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        },
                    });
                }
            } catch (e) {
                console.warn("调用 GM_download 异常，将使用 <a download>：", e);
                usedGm = false;
            }

            if (!usedGm) {
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }

            // 延迟释放URL
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        },

        // DOM转AI文本（用于AI文本导出）
        cookedToAiText(cookedHtml, opts) {
            const { includeImages, includeQuotes } = opts;
            const parser = new DOMParser();
            const doc = parser.parseFromString(cookedHtml || "", "text/html");
            const root = doc.body;

            function serialize(node, inPre = false) {
                if (!node) return "";
                if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
                if (node.nodeType !== Node.ELEMENT_NODE) return "";

                const el = node;
                const tag = el.tagName.toLowerCase();

                if (tag === "br") return "\n";

                if (tag === "img") {
                    if (!includeImages) return "";
                    const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
                    const full = Core.absoluteUrl(src);
                    if (!full) return "";
                    return `\n[图片] ${full}\n`;
                }

                if (tag === "a") {
                    const hasImg = el.querySelector("img");
                    const href = el.getAttribute("href") || "";
                    if (hasImg) {
                        return Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                    }
                    const text = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                    const link = Core.absoluteUrl(href);
                    if (!link) return text;
                    if (!text) return link;
                    if (text === link) return text;
                    return `${text}（${link}）`;
                }

                if (tag === "pre") {
                    const codeEl = el.querySelector("code");
                    const langClass = codeEl?.getAttribute("class") || "";
                    const lang = (langClass.match(/lang(?:uage)?-([a-z0-9_+-]+)/i) || [])[1] || "";
                    const code = (codeEl ? codeEl.textContent : el.textContent) || "";
                    return `\n\`\`\`${lang}\n${code.replace(/\n+$/g, "")}\n\`\`\`\n\n`;
                }

                if (tag === "code") {
                    if (inPre) return el.textContent || "";
                    const t = (el.textContent || "").replace(/\n/g, " ");
                    return t ? `\`${t}\`` : "";
                }

                if (tag === "blockquote") {
                    if (!includeQuotes) {
                        const inner = (el.textContent || "").trim();
                        return inner ? "\n(引用已省略)\n" : "";
                    }
                    const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                    return `\n【引用开始】\n${inner.trim()}\n【引用结束】\n\n`;
                }

                if (/^h[1-6]$/.test(tag)) {
                    const inner = (el.textContent || "").trim();
                    return inner ? `\n${inner}\n\n` : "";
                }

                if (tag === "li") {
                    const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                    return inner ? `- ${inner}\n` : "";
                }

                if (tag === "ul" || tag === "ol") {
                    const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                    return `\n${inner}\n`;
                }

                if (tag === "p") {
                    const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                    return inner ? `${inner}\n\n` : "\n";
                }

                const nextInPre = inPre || tag === "pre";
                return Array.from(el.childNodes).map((c) => serialize(c, nextInPre)).join("");
            }

            let text = Array.from(root.childNodes).map((n) => serialize(n, false)).join("");
            text = Core.decodeEntities(text);
            text = text.replace(/\r\n/g, "\n");
            text = text.replace(/[ \t]+\n/g, "\n");
            text = text.replace(/\n{3,}/g, "\n\n").trim();
            return text;
        },

        // 检查帖子是否包含图片
        postHasImage(post) {
            const cooked = post?.cooked || "";
            return cooked.includes("<img");
        },

        // ========== 话题列表功能 ==========

        // 判断当前是否在话题列表页面（首页、分类页等）
        isTopicListPage() {
            const path = window.location.pathname;
            // 排除单个话题页面
            if (/\/t\/[^\/]+\/\d+/.test(path)) return false;
            // 首页、分类页、标签页等都是话题列表页
            return path === '/' ||
                   path.startsWith('/latest') ||
                   path.startsWith('/new') ||
                   path.startsWith('/unread') ||
                   path.startsWith('/top') ||
                   path.startsWith('/categories') ||
                   path.startsWith('/c/') ||
                   path.startsWith('/tag/');
        },

        // 从页面 DOM 获取话题列表
        getTopicsFromPage() {
            const topics = [];
            // 查找话题行
            const topicRows = document.querySelectorAll('tr.topic-list-item, .topic-list-item');

            topicRows.forEach((row, index) => {
                const titleLink = row.querySelector('.title a.raw-topic-link, .topic-title a, a.title');
                const categoryLink = row.querySelector('.category-name, .badge-category__name');
                const repliesEl = row.querySelector('.posts, .replies .number, td.num.posts span');
                const viewsEl = row.querySelector('.views, td.num.views span');
                const activityEl = row.querySelector('.relative-date, .age');
                const authorEl = row.querySelector('.creator a, .posters a:first-child');

                if (titleLink) {
                    const href = titleLink.getAttribute('href') || '';
                    const topicIdMatch = href.match(/\/t\/[^\/]+\/(\d+)/);

                    topics.push({
                        index: index + 1,
                        title: titleLink.textContent.trim(),
                        url: href,
                        topicId: topicIdMatch ? topicIdMatch[1] : null,
                        category: categoryLink ? categoryLink.textContent.trim() : '',
                        replies: repliesEl ? parseInt(repliesEl.textContent) || 0 : 0,
                        views: viewsEl ? viewsEl.textContent.trim() : '',
                        activity: activityEl ? activityEl.textContent.trim() : '',
                        author: authorEl ? authorEl.textContent.trim() : ''
                    });
                }
            });

            return topics;
        },

        // 格式化话题列表为文本
        formatTopicsToText(topics, sourceName = '当前页面') {
            if (!topics || topics.length === 0) return '没有找到话题列表';

            let text = `${sourceName}话题列表（共 ${topics.length} 个话题）：\n\n`;

            topics.forEach(topic => {
                text += `【${topic.index}】${topic.title}\n`;
                if (topic.category) text += `   分类: ${topic.category}\n`;
                if (topic.author) text += `   作者: ${topic.author}\n`;
                const activity = topic.activity || topic.lastActivity || '';
                text += `   回复: ${topic.replies} | 浏览: ${topic.views}${activity ? ' | 活动: ' + activity : ''}\n`;
                // 兼容完整URL和相对URL
                const url = topic.url?.startsWith('http') ? topic.url : `https://linux.do${topic.url}`;
                text += `   链接: ${url}\n\n`;
            });

            return text;
        },

        // 获取话题的主帖内容（第一楼）
        async fetchTopicFirstPost(topicId) {
            const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
            const opts = { headers: { 'x-csrf-token': csrf, 'x-requested-with': 'XMLHttpRequest' } };

            try {
                const res = await fetch(`https://linux.do/t/${topicId}.json`, opts);

                // 检查HTTP状态码
                if (!res.ok) {
                    if (res.status === 429) throw new Error('请求过于频繁，被限流');
                    throw new Error(`HTTP ${res.status}`);
                }

                const data = await res.json();

                const firstPost = data.post_stream?.posts?.[0];
                if (!firstPost) return null;

                let content = firstPost.cooked;
                // 清理 HTML 标签
                content = content.replace(/<img[^>]+class="emoji[^>]*alt="([^"]*)"[^>]*>/gi, '$1 ');
                content = content.replace(/<[^>]+>/g, '').trim();

                return {
                    title: data.title,
                    category: data.category_id,
                    author: firstPost.name || firstPost.username,
                    username: firstPost.username,
                    content: content,
                    replyCount: data.posts_count - 1,
                    views: data.views,
                    createdAt: data.created_at
                };
            } catch (e) {
                console.error('获取话题内容失败:', topicId, e.message);
                // 429错误需要向上抛出，让调用者处理重试
                if (e.message?.includes('429') || e.message?.includes('请求过于频繁')) {
                    throw e;
                }
                return null;
            }
        },

        // 批量获取话题主帖内容（智能指数退避，动态调整并发，429自动重试）
        async fetchTopicsContent(topics, onProgress) {
            const initialConcurrency = GM_getValue('topicsConcurrency', 4);
            const results = [];
            let completed = 0;
            let totalToFetch = topics.length;

            // 自适应并发控制状态
            let currentConcurrency = initialConcurrency;
            let baseDelay = 300; // 基础延迟(ms)
            let consecutiveSuccess = 0; // 连续成功计数

            // 待处理队列（包含原始话题和429重试的话题）
            let pendingTopics = [...topics];
            let retryCount = new Map(); // 记录每个话题的重试次数
            const MAX_RETRIES = 3; // 429最大重试次数

            // 单个话题请求（不含429重试，429由外层处理）
            const fetchSingle = async (topic) => {
                if (!topic.topicId) return { result: null, is429: false, topic };

                try {
                    const detail = await Core.fetchTopicFirstPost(topic.topicId);
                    if (detail) return { result: { ...topic, ...detail }, is429: false, topic };
                    return { result: null, is429: false, topic };
                } catch (e) {
                    // 检测429限流错误
                    const is429 = e.message?.includes('429') || e.message?.includes('请求过于频繁');
                    return { result: null, is429, topic };
                }
            };

            // 分批处理
            while (pendingTopics.length > 0) {
                const batchSize = Math.min(currentConcurrency, pendingTopics.length);
                const batch = pendingTopics.splice(0, batchSize);

                // 并行请求当前批次
                const batchResults = await Promise.all(batch.map(fetchSingle));

                // 处理结果
                const retryQueue = []; // 需要重试的话题
                for (const { result, is429, topic } of batchResults) {
                    if (result) {
                        // 成功
                        results.push(result);
                        completed++;
                    } else if (is429) {
                        // 429错误，检查重试次数
                        const tries = (retryCount.get(topic.topicId) || 0) + 1;
                        retryCount.set(topic.topicId, tries);

                        if (tries < MAX_RETRIES) {
                            retryQueue.push(topic); // 加入重试队列
                            console.log(`[智能退避] 话题 ${topic.topicId} 遇到429，将重试 (${tries}/${MAX_RETRIES})`);
                        } else {
                            completed++; // 超过最大重试次数，标记完成但失败
                            console.log(`[智能退避] 话题 ${topic.topicId} 重试次数已达上限，放弃`);
                        }
                    } else {
                        // 其他错误
                        completed++;
                    }

                    if (onProgress) {
                        const statusInfo = currentConcurrency < initialConcurrency
                            ? ` [降速:${currentConcurrency}并发]` : '';
                        const retryInfo = retryQueue.length > 0 ? ` [重试队列:${retryQueue.length}]` : '';
                        onProgress(completed, totalToFetch, topic.title + statusInfo + retryInfo, totalToFetch - results.length - (pendingTopics.length + retryQueue.length));
                    }
                }

                // 检测是否有429错误
                const has429 = batchResults.some(r => r.is429);

                if (has429) {
                    // 遇到429：降低并发，增加延迟
                    currentConcurrency = Math.max(1, Math.floor(currentConcurrency / 2));
                    baseDelay = Math.min(baseDelay * 2, 3000); // 最大延迟3秒
                    consecutiveSuccess = 0;
                    console.log(`[智能退避] 检测到429限流，降低并发至 ${currentConcurrency}，延迟 ${baseDelay}ms`);

                    // 将需要重试的话题加回队列末尾
                    pendingTopics.push(...retryQueue);
                } else {
                    // 成功：尝试恢复
                    consecutiveSuccess++;
                    if (consecutiveSuccess >= 3 && currentConcurrency < initialConcurrency) {
                        currentConcurrency = Math.min(currentConcurrency + 1, initialConcurrency);
                        baseDelay = Math.max(baseDelay - 100, 300);
                        consecutiveSuccess = 0;
                        console.log(`[智能退避] 恢复并发至 ${currentConcurrency}，延迟 ${baseDelay}ms`);
                    }
                }

                // 批次之间延迟（带随机抖动）
                if (pendingTopics.length > 0) {
                    const jitter = Math.random() * 100;
                    await new Promise(r => setTimeout(r, baseDelay + jitter));
                }
            }

            // 返回结果和失败数
            results._failedCount = totalToFetch - results.length;
            return results;
        },

        // 格式化话题详情为 AI 可读文本
        formatTopicsDetailToText(topicsWithContent) {
            if (!topicsWithContent || topicsWithContent.length === 0) {
                return '没有获取到话题内容';
            }

            let text = `话题列表详情（共 ${topicsWithContent.length} 个话题）：\n\n`;
            text += '='.repeat(50) + '\n\n';

            topicsWithContent.forEach((topic, idx) => {
                text += `【话题 ${idx + 1}】${topic.title}\n`;
                text += `-`.repeat(40) + '\n';
                text += `作者: ${topic.author}（@${topic.username}）\n`;
                text += `回复数: ${topic.replyCount} | 浏览量: ${topic.views}\n`;
                text += `链接: https://linux.do${topic.url}\n\n`;
                text += `内容摘要:\n${topic.content.slice(0, 500)}${topic.content.length > 500 ? '...' : ''}\n\n`;
                text += '='.repeat(50) + '\n\n';
            });

            return text;
        },

        // ========== 远程话题获取功能 ==========

        // 分类列表缓存
        _categoriesCache: null,
        _categoriesCacheTime: 0,

        // 获取论坛分类列表（带缓存，1小时过期）
        async fetchCategories() {
            const CACHE_DURATION = 60 * 60 * 1000; // 1小时
            const now = Date.now();

            // 检查缓存
            if (this._categoriesCache && (now - this._categoriesCacheTime) < CACHE_DURATION) {
                return this._categoriesCache;
            }

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://linux.do/categories.json',
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            try {
                                const data = JSON.parse(res.responseText);
                                const categories = data.category_list?.categories || [];
                                // 过滤掉子分类，只保留主分类
                                const mainCategories = categories.filter(c => !c.parent_category_id);
                                this._categoriesCache = mainCategories;
                                this._categoriesCacheTime = now;
                                resolve(mainCategories);
                            } catch (e) {
                                reject(new Error('解析分类数据失败'));
                            }
                        } else {
                            reject(new Error(`HTTP ${res.status}`));
                        }
                    },
                    onerror: () => reject(new Error('网络请求失败'))
                });
            });
        },

        // 从远程API获取话题列表（支持分页）
        // source: 'top' | 'new' | 'latest' | 'category'
        // options: { categoryId?, categorySlug?, limit? }
        async fetchRemoteTopics(source, options = {}) {
            const limit = options.limit || 30;
            const perPage = source === 'top' ? 50 : 30; // top每页50条，其他30条
            const pagesNeeded = Math.ceil(limit / perPage);

            let baseUrl = '';
            switch (source) {
                case 'top':
                    baseUrl = 'https://linux.do/top.json';
                    break;
                case 'new':
                    baseUrl = 'https://linux.do/new.json';
                    break;
                case 'latest':
                    baseUrl = 'https://linux.do/latest.json';
                    break;
                case 'category':
                    if (!options.categorySlug || !options.categoryId) {
                        throw new Error('分类信息不完整');
                    }
                    baseUrl = `https://linux.do/c/${options.categorySlug}/${options.categoryId}.json`;
                    break;
                default:
                    throw new Error('未知的话题来源类型');
            }

            // 单页请求函数
            const fetchPage = (page) => {
                return new Promise((resolve, reject) => {
                    const url = page === 0 ? baseUrl : `${baseUrl}?page=${page}`;
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        onload: (res) => {
                            if (res.status >= 200 && res.status < 300) {
                                try {
                                    const data = JSON.parse(res.responseText);
                                    const rawTopics = data.topic_list?.topics || [];
                                    resolve(rawTopics);
                                } catch (e) {
                                    reject(new Error('解析话题数据失败'));
                                }
                            } else {
                                reject(new Error(`HTTP ${res.status}`));
                            }
                        },
                        onerror: () => reject(new Error('网络请求失败'))
                    });
                });
            };

            // 获取所有需要的页面
            const allTopics = [];
            for (let page = 0; page < pagesNeeded && allTopics.length < limit; page++) {
                try {
                    const pageTopics = await fetchPage(page);
                    if (pageTopics.length === 0) break; // 没有更多数据
                    allTopics.push(...pageTopics);
                    // 页面之间稍微延迟，避免请求过快
                    if (page < pagesNeeded - 1) {
                        await new Promise(r => setTimeout(r, 200));
                    }
                } catch (e) {
                    // 如果已经获取到一些数据，继续使用；否则抛出错误
                    if (allTopics.length === 0) throw e;
                    break;
                }
            }

            // 限制数量并格式化
            const topics = allTopics.slice(0, limit).map((t, idx) => this.formatRemoteTopic(t, idx + 1));
            return topics;
        },

        // 格式化远程话题数据为统一格式
        formatRemoteTopic(topic, index) {
            return {
                index: index,
                topicId: String(topic.id),
                title: topic.title || '',
                url: `/t/${topic.slug}/${topic.id}`,
                category: '', // 远程数据没有分类名，需要额外查询
                categoryId: topic.category_id,
                replies: topic.posts_count ? topic.posts_count - 1 : 0,
                views: this.formatNumber(topic.views || 0),
                viewsRaw: topic.views || 0,
                likes: topic.like_count || 0,
                activity: topic.last_posted_at ? this.formatRelativeTime(topic.last_posted_at) : '',
                author: '', // 远程列表API不包含作者信息
                excerpt: topic.excerpt || '',
                pinned: topic.pinned || false,
                closed: topic.closed || false,
                createdAt: topic.created_at || ''
            };
        },

        // 格式化数字（如 1234 -> 1.2k）
        formatNumber(num) {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
            return String(num);
        },

        // 格式化相对时间
        formatRelativeTime(dateStr) {
            const date = new Date(dateStr);
            const now = new Date();
            const diff = now - date;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);

            if (minutes < 1) return '刚刚';
            if (minutes < 60) return `${minutes}分钟前`;
            if (hours < 24) return `${hours}小时前`;
            if (days < 30) return `${days}天前`;
            return date.toLocaleDateString('zh-CN');
        },

        // 格式化远程话题列表为快速模式文本（仅标题+元数据）
        formatRemoteTopicsQuick(topics, sourceName) {
            if (!topics || topics.length === 0) return '没有获取到话题列表';

            let text = `${sourceName}（共 ${topics.length} 个话题）：\n\n`;

            topics.forEach(topic => {
                const pinLabel = topic.pinned ? '📌 ' : '';
                const closedLabel = topic.closed ? '🔒 ' : '';
                text += `【${topic.index}】${pinLabel}${closedLabel}${topic.title}\n`;
                text += `   👁 ${topic.views} | 💬 ${topic.replies} | ❤️ ${topic.likes} | ⏰ ${topic.activity}\n`;
                if (topic.excerpt) {
                    text += `   摘要: ${topic.excerpt.slice(0, 100)}${topic.excerpt.length > 100 ? '...' : ''}\n`;
                }
                text += `   链接: https://linux.do${topic.url}\n\n`;
            });

            return text;
        }
    };

    // =================================================================================
    // 3. UI 模块注册表 (UI REGISTRY)
    //    所有UI风格都在此注册。
    // =================================================================================
    const UIRegistry = {
        _styles: {},
        register(name, styleObject) {
            this._styles[name] = styleObject;
        },
        get(name) {
            return this._styles[name];
        },
        getAllNames() {
            return Object.keys(this._styles);
        }
    };

    // =================================================================================
    // 4. UI 风格模块 (UI STYLES)
    //    每个风格都是一个独立的对象，实现共同的接口。
    // =================================================================================

    UIRegistry.register('style2', {
        name: 'LinuxDO沉浸风格',
        ICONS: {
            brain: `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0-7a1 1 0 0 1 0 2 1 1 0 0 1 0-2zm-2 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0-7a1 1 0 0 1 0 2 1 1 0 0 1 0-2z" fill="currentColor"/></svg>`,
            summary: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
            chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
            settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
            moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
            sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
            close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
            trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
            copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
            sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
            arrowLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`,
            arrowRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`,
            arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
            arrowDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,
            send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
            robot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>`,
            check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
            topics: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
            download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
            refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`
        },

        init(uiManager) {
            this.uiManager = uiManager;
            this.isOpen = false;
            this.btnPos = GM_getValue('style2_btnPos', { side: 'right', top: '50%' });
            this.side = this.btnPos.side;
            this.sidebarWidth = GM_getValue('style2_sidebarWidth', 420);
            this.isDarkTheme = GM_getValue('style2_isDarkTheme', false);
            this.chatHistory = [];
            this.postContent = '';
            this.lastSummary = '';
            this.isGenerating = false;
            this.currentTab = 'summary';
            this.userMessageCount = 0;
            this.userScrolledUp = false;
            this.isProgrammaticScroll = false;
            this.render();
            this.restoreState();
            this.bindEvents();
            this.bindKeyboardShortcuts();
        },

        destroy() {},

        getStyles() {
            return `
            :host { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; --brand-gold: #E3A043; --brand-gold-hover: #d48f35; --primary: #222222; --primary-hover: #000000; --primary-light: #f0f0f0; --success: #2d9d78; --success-light: #d1fae5; --danger: #d93025; --danger-light: #fef2f2; --warning: #f2c04d; --bg-base: #F9FAFB; --bg-card: #FFFFFF; --bg-glass: rgba(255, 255, 255, 0.95); --bg-glass-dark: rgba(255, 255, 255, 0.98); --bg-hover: #F2F2F2; --bg-active: #E5E7EB; --bg-setting: #F9FAFB; --bg-input: #FFFFFF; --border-light: #E5E7EB; --border-medium: #D1D5DB; --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05); --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04); --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.04); --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); --shadow-glow: 0 0 0 1px rgba(0,0,0,0.05); --text-main: #111827; --text-sec: #4B5563; --text-muted: #9CA3AF; --text-inverse: #FFFFFF; --sidebar-width: 420px; --btn-size: 42px; --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px; --radius-full: 9999px; --transition-fast: 0.15s ease; --transition-normal: 0.25s ease; --transition-slow: 0.35s ease; }
            :host(.dark-theme) { --primary: #E3A043; --primary-hover: #ffb85c; --primary-light: #2D2D2D; --bg-base: #111111; --bg-card: #1E1E1E; --bg-glass: rgba(30, 30, 30, 0.95); --bg-glass-dark: rgba(20, 20, 20, 0.98); --bg-hover: #2D2D2D; --bg-active: #374151; --bg-setting: #111111; --bg-input: #2D2D2D; --border-light: #374151; --border-medium: #4B5563; --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5); --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.5); --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5); --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.5); --text-main: #F3F4F6; --text-sec: #D1D5DB; --text-muted: #6B7280; --text-inverse: #111827; }
            * { box-sizing: border-box; }
            .sidebar-panel { position: fixed; top: 0; bottom: 0; width: var(--sidebar-width); background: var(--bg-card); box-shadow: var(--shadow-xl); z-index: 9998; display: flex; flex-direction: column; transition: transform var(--transition-slow); border: 1px solid var(--border-light); }
            .panel-left { left: 0; border-left: none; transform: translateX(-100%); }
            .panel-left.open { transform: translateX(0); }
            .panel-right { right: 0; border-right: none; transform: translateX(100%); }
            .panel-right.open { transform: translateX(0); }
            #toggle-btn { position: fixed; width: var(--btn-size); height: var(--btn-size); background: var(--bg-card); color: var(--text-sec); box-shadow: var(--shadow-md); z-index: 9999; cursor: grab; display: flex; align-items: center; justify-content: center; user-select: none; transition: all var(--transition-normal); border: 1px solid var(--border-light); outline: none; }
            #toggle-btn:hover { background: var(--bg-hover); color: var(--brand-gold); transform: scale(1.05); }
            #toggle-btn:active { cursor: grabbing; transform: scale(0.96); }
            #toggle-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; }
            .btn-snap-left { border-radius: 0 var(--radius-md) var(--radius-md) 0; border-left: none; }
            .btn-snap-right { border-radius: var(--radius-md) 0 0 var(--radius-md); border-right: none; }
            .btn-floating { border-radius: 50%; box-shadow: var(--shadow-lg); }
            .resize-handle { position: absolute; top: 0; bottom: 0; width: 4px; cursor: col-resize; z-index: 10001; background: transparent; transition: background var(--transition-fast); }
            .resize-handle:hover { background: var(--brand-gold); }
            .handle-left { right: -2px; } .handle-right { left: -2px; }
            .header { padding: 16px 20px; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card); flex-shrink: 0; }
            .header-title { font-size: 16px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 10px; }
            .header-title-icon { color: var(--brand-gold); display: flex; align-items: center; justify-content: center; }
            .header-title-icon svg { width: 22px; height: 22px; }
            .header-actions { display: flex; gap: 4px; }
            .icon-btn { background: transparent; border: none; cursor: pointer; padding: 8px; border-radius: var(--radius-sm); color: var(--text-muted); transition: all var(--transition-fast); display: flex; align-items: center; justify-content: center; position: relative; }
            .icon-btn svg { width: 18px; height: 18px; }
            .icon-btn:hover { background: var(--bg-hover); color: var(--text-main); }
            .icon-btn[data-tooltip]::after { content: attr(data-tooltip); position: absolute; bottom: -30px; left: 50%; transform: translateX(-50%); background: #333; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity var(--transition-fast); z-index: 100; }
            .icon-btn[data-tooltip]:hover::after { opacity: 1; }
            .tab-bar { display: flex; padding: 0 16px; gap: 24px; border-bottom: 1px solid var(--border-light); background: var(--bg-card); flex-shrink: 0; }
            .tab-item { padding: 14px 4px; text-align: center; font-size: 14px; font-weight: 500; color: var(--text-sec); cursor: pointer; border-bottom: 2px solid transparent; transition: all var(--transition-fast); display: flex; align-items: center; gap: 6px; }
            .tab-item svg { width: 16px; height: 16px; opacity: 0.8; }
            .tab-item:hover { color: var(--text-main); }
            .tab-item.active { color: var(--brand-gold); border-bottom-color: var(--brand-gold); font-weight: 600; }
            .tab-item.active svg { opacity: 1; stroke-width: 2.5; }
            .content-area { flex: 1; overflow-y: auto; position: relative; background: var(--bg-base); }
            .view-page { padding: 20px; display: none; animation: fadeIn 0.2s ease; }
            .view-page.active { display: block; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
            .form-group { margin-bottom: 20px; }
            .form-label { display: block; font-size: 12px; color: var(--text-sec); margin-bottom: 8px; font-weight: 600; }
            input, textarea, select { width: 100%; padding: 10px 12px; border: 1px solid var(--border-medium); border-radius: var(--radius-md); font-size: 14px; font-family: inherit; background: var(--bg-input); color: var(--text-main); box-sizing: border-box; transition: all var(--transition-fast); }
            input:focus, textarea:focus { outline: none; border-color: var(--brand-gold); box-shadow: 0 0 0 2px rgba(227, 160, 67, 0.15); }
            input::placeholder, textarea::placeholder { color: var(--text-muted); }
            textarea { resize: vertical; min-height: 100px; line-height: 1.6; }
            .btn { width: 100%; padding: 10px 16px; border: none; border-radius: var(--radius-md); background: var(--primary); color: var(--text-inverse); font-weight: 600; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all var(--transition-normal); box-shadow: var(--shadow-sm); }
            .btn svg { width: 16px; height: 16px; }
            .btn:hover { background: var(--primary-hover); transform: translateY(-1px); box-shadow: var(--shadow-md); }
            .btn:active { transform: translateY(0); }
            .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
            :host(.dark-theme) .btn { color: #111; }
            .btn-xs { padding: 4px 10px; font-size: 12px; background: var(--bg-card); color: var(--text-sec); border-radius: var(--radius-sm); border: 1px solid var(--border-medium); cursor: pointer; white-space: nowrap; transition: all var(--transition-fast); }
            .btn-xs:hover { color: var(--brand-gold); border-color: var(--brand-gold); }
            .result-box { margin-top: 16px; padding: 16px; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius-lg); font-size: 14px; line-height: 1.7; color: var(--text-main); min-height: 150px; max-height: calc(100vh - 350px); overflow-y: auto; overflow-x: hidden; word-break: break-word; overflow-wrap: break-word; white-space: normal; width: 100%; box-sizing: border-box; position: relative; }
            .result-box.empty { display: flex; align-items: center; justify-content: center; background: var(--bg-base); }
            .result-actions { position: absolute; top: 10px; right: 10px; opacity: 0; transition: opacity var(--transition-fast); }
            .result-box:hover .result-actions { opacity: 1; }
            .result-action-btn { padding: 4px 10px; font-size: 12px; background: var(--bg-card); color: var(--text-sec); border: 1px solid var(--border-light); border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px; box-shadow: var(--shadow-sm); }
            .result-action-btn:hover { border-color: var(--brand-gold); color: var(--brand-gold); }
            .result-action-btn.copied { border-color: var(--success); color: var(--success); }
            .result-action-btn svg { width: 12px; height: 12px; }
            .result-box h1, .result-box h2, .result-box h3 { margin: 16px 0 8px; font-weight: 600; color: var(--text-main); }
            .result-box h1 { font-size: 1.4em; }
            .result-box h2 { font-size: 1.2em; border-bottom: 1px solid var(--border-light); padding-bottom: 6px; }
            .result-box h3 { font-size: 1.1em; color: var(--text-sec); }
            .result-box p { margin-bottom: 10px; }
            .result-box ul, .result-box ol { padding-left: 20px; margin: 10px 0; }
            .result-box li { margin-bottom: 6px; }
            .result-box li::marker { color: var(--brand-gold); }
            .result-box code, .bubble-ai code, .thinking-content code, .result-box pre code, .bubble-ai pre code, .thinking-content pre code { font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace !important; font-size: 13px !important; line-height: 1.5 !important; font-variant-ligatures: none; letter-spacing: 0; }
            .result-box code, .bubble-ai code, .thinking-content code:not(pre code) { background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; color: var(--text-main); border: 1px solid var(--border-medium); word-break: break-all; overflow-wrap: break-word; max-width: 100%; display: inline-block; margin: 0 2px; }
            :host(.dark-theme) .result-box code, :host(.dark-theme) .bubble-ai code, :host(.dark-theme) .thinking-content code:not(pre code) { background: rgba(255,255,255,0.1); color: #e0e0e0; border-color: rgba(255,255,255,0.2); }
            .result-box pre, .bubble-ai pre, .thinking-content-inner pre { background: var(--bg-card); padding: 16px !important; margin: 12px 0 !important; border-radius: var(--radius-md); border: 1px solid var(--border-medium); overflow-x: auto; overflow-y: auto; color: var(--text-main); white-space: pre-wrap !important; word-break: break-all; word-wrap: break-word; tab-size: 4; max-width: 100%; box-sizing: border-box; font-size: 13px !important; line-height: 1.5 !important; }
            :host(.dark-theme) .result-box pre, :host(.dark-theme) .bubble-ai pre, :host(.dark-theme) .thinking-content-inner pre { background: #1e1e1e; color: #d4d4d4; border-color: #404040; }
            .result-box pre::-webkit-scrollbar, .bubble-ai pre::-webkit-scrollbar, .thinking-content-inner pre::-webkit-scrollbar { width: 8px; height: 8px; }
            .result-box pre::-webkit-scrollbar-track, .bubble-ai pre::-webkit-scrollbar-track, .thinking-content-inner pre::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 4px; }
            .result-box pre::-webkit-scrollbar-thumb, .bubble-ai pre::-webkit-scrollbar-thumb, .thinking-content-inner pre::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.3); border-radius: 4px; }
            :host(.dark-theme) .result-box pre::-webkit-scrollbar-thumb, :host(.dark-theme) .bubble-ai pre::-webkit-scrollbar-thumb, :host(.dark-theme) .thinking-content-inner pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); }
            .result-box pre code { background: none; color: inherit; padding: 0; border: none; }
            .result-box blockquote { border-left: 3px solid var(--brand-gold); margin: 12px 0; padding: 6px 16px; color: var(--text-sec); background: var(--bg-hover); font-style: italic; }
            .result-box a { color: var(--brand-gold); text-decoration: none; border-bottom: 1px solid transparent; }
            .result-box a:hover { border-bottom-color: var(--brand-gold); }
            .result-box strong { color: var(--text-main); font-weight: 600; }
            .chat-container { display: flex; flex-direction: column; height: 100%; position: relative; }
            .chat-toolbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--border-light); margin-bottom: 12px; }
            .chat-toolbar-title { font-size: 13px; color: var(--text-sec); font-weight: 600; display: flex; align-items: center; gap: 8px; }
            .msg-count { background: var(--bg-active); color: var(--text-sec); font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: normal; }
            .btn-clear { padding: 6px 12px; font-size: 12px; background: transparent; color: var(--danger); border-radius: var(--radius-sm); border: none; cursor: pointer; display: flex; align-items: center; gap: 5px; }
            .btn-clear:hover { background: var(--danger-light); }
            .btn-clear svg { width: 14px; height: 14px; }
            .chat-messages-wrapper { flex: 1; position: relative; overflow: hidden; }
            .chat-messages { height: 100%; overflow-y: auto; padding: 10px 0; }
            .chat-list { display: flex; flex-direction: column; gap: 16px; }
            .bubble { padding: 12px 16px; border-radius: var(--radius-lg); font-size: 14px; line-height: 1.6; max-width: 90%; word-break: break-word; overflow-wrap: break-word; white-space: normal; overflow-x: hidden; box-shadow: var(--shadow-sm); position: relative; box-sizing: border-box; }
            .bubble-user { align-self: flex-end; background: var(--primary); color: var(--text-inverse); border-bottom-right-radius: 2px; }
            :host(.dark-theme) .bubble-user { color: #111; }
            .bubble-ai { align-self: flex-start; background: var(--bg-card); border: 1px solid var(--border-light); color: var(--text-main); border-bottom-left-radius: 2px; }
            .bubble-ai:has(.bubble-actions) { padding-top: 36px; }
            .bubble-ai h1, .bubble-ai h2 { font-size: 1.1em; margin: 8px 0; }
            .bubble-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity var(--transition-fast); }
            .bubble:hover .bubble-actions { opacity: 1; }
            .bubble-action-btn { padding: 4px 10px; font-size: 12px; background: var(--bg-card); color: var(--text-sec); border: 1px solid var(--border-light); border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px; box-shadow: var(--shadow-sm); white-space: nowrap; }
            .bubble-action-btn:hover { border-color: var(--brand-gold); color: var(--brand-gold); }
            .bubble-action-btn.copied { border-color: var(--success); color: var(--success); }
            .bubble-action-btn svg { width: 12px; height: 12px; }
            .thinking-block { margin: 4px 0 10px; border-radius: var(--radius-md); background: var(--bg-setting); border: 1px solid var(--border-light); overflow: hidden; }
            .thinking-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; user-select: none; transition: background var(--transition-fast); }
            .thinking-header:hover { background: rgba(0,0,0,0.03); }
            .thinking-header-left { display: flex; align-items: center; gap: 8px; }
            .thinking-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
            .thinking-icon svg { width: 14px; height: 14px; }
            .thinking-title { font-size: 12px; font-weight: 600; color: var(--text-sec); }
            .thinking-status { font-size: 10px; color: var(--text-muted); background: rgba(0,0,0,0.05); padding: 1px 6px; border-radius: 4px; }
            .thinking-toggle { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
            .thinking-toggle svg { width: 12px; height: 12px; transition: transform 0.2s; }
            .thinking-block.expanded .thinking-toggle svg { transform: rotate(180deg); }
            .thinking-preview { padding: 0 12px 8px; font-size: 11px; color: var(--text-muted); line-height: 1.4; max-height: 3.5em; overflow: hidden; word-break: break-word; overflow-wrap: break-word; white-space: normal; }
            .thinking-content { max-height: 0; overflow: hidden; transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
            .thinking-block.expanded .thinking-content { max-height: 5000px; }
            .thinking-content-inner { padding: 10px 12px; font-size: 12px; color: var(--text-sec); border-top: 1px dashed var(--border-medium); background: var(--bg-card); word-break: break-word; overflow-wrap: break-word; white-space: normal; overflow-x: hidden; width: 100%; box-sizing: border-box; }
            .scroll-buttons { position: absolute; right: 10px; z-index: 10; }
            .scroll-buttons.top-area { top: 10px; }
            .scroll-buttons.bottom-area { bottom: 10px; }
            .scroll-btn { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border-light); box-shadow: var(--shadow-md); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-sec); opacity: 0; transform: scale(0.8); pointer-events: none; transition: all var(--transition-fast); }
            .scroll-btn.visible { opacity: 1; transform: scale(1); pointer-events: auto; }
            .scroll-btn:hover { color: var(--brand-gold); border-color: var(--brand-gold); }
            .scroll-btn svg { width: 16px; height: 16px; }
            .chat-input-area { border-top: 1px solid var(--border-light); padding: 16px 0 0; flex-shrink: 0; }
            .chat-input-row { display: flex; gap: 10px; align-items: flex-end; }
            .chat-input { flex: 1; min-height: 44px; max-height: 120px; border-radius: 22px; padding: 10px 18px; resize: none; border: 1px solid var(--border-medium); font-size: 14px; line-height: 1.5; }
            .chat-input:focus { border-color: var(--brand-gold); }
            .send-btn { width: 44px; height: 44px; border-radius: 50%; padding: 0; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--primary); border: none; cursor: pointer; transition: all var(--transition-fast); }
            .send-btn svg { width: 20px; height: 20px; fill: none; stroke: var(--text-inverse); }
            :host(.dark-theme) .send-btn svg { stroke: #111; }
            .send-btn:hover { transform: scale(1.05); }
            .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .settings-page { background: var(--bg-setting); min-height: 100%; padding: 20px; }
            .settings-group { background: var(--bg-card); border-radius: var(--radius-lg); overflow: hidden; margin-bottom: 20px; box-shadow: var(--shadow-sm); border: 1px solid var(--border-light); }
            .settings-group-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; padding: 16px 20px 8px; font-weight: 700; letter-spacing: 0.05em; }
            .setting-item { padding: 14px 20px; border-bottom: 1px solid var(--border-light); }
            .setting-item:last-child { border-bottom: none; }
            .setting-label { font-size: 14px; font-weight: 500; color: var(--text-main); margin-bottom: 4px; display: block; }
            .setting-desc { font-size: 12px; color: var(--text-sec); margin-bottom: 10px; }
            .setting-item-row { display: flex; justify-content: space-between; align-items: center; }
            .setting-item-row .setting-info { flex: 1; margin-right: 16px; }
            .toggle-switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
            .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
            .toggle-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: var(--border-medium); border-radius: 24px; transition: .3s; }
            .toggle-slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: .3s; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
            .toggle-switch input:checked + .toggle-slider { background: var(--brand-gold); }
            .toggle-switch input:checked + .toggle-slider::before { transform: translateX(20px); }
            .spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; display: none; }
            .btn.loading .spinner { display: inline-block; }
            .btn.loading .btn-text { display: none; }
            @keyframes spin { to { transform: rotate(360deg); } }
            .thinking { display: flex; gap: 4px; padding: 4px 0; }
            .thinking-dot { width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; animation: thinking 1.4s ease-in-out infinite; }
            .thinking-dot:nth-child(2) { animation-delay: 0.2s; }
            .thinking-dot:nth-child(3) { animation-delay: 0.4s; }
            @keyframes thinking { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
            .tip-text { text-align: center; color: var(--text-muted); font-size: 13px; padding: 40px 20px; line-height: 1.8; }
            .tip-text strong { color: var(--text-main); }
            .tip-icon { display: block; margin-bottom: 12px; color: var(--border-medium); }
            .tip-icon svg { width: 40px; height: 40px; }
            .hidden { display: none !important; }
            ::-webkit-scrollbar { width: 6px; height: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
            :host(.dark-theme) ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
            input[type="number"] { -moz-appearance: textfield; }
            input[type="number"]::-webkit-outer-spin-button, input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            .range-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
            .range-buttons { display: flex; gap: 6px; }
            .range-inputs { display: flex; gap: 10px; align-items: center; }
            .range-inputs input { flex: 1; text-align: center; }
            .range-separator { color: var(--text-muted); }
            .count-input-row { display: flex; align-items: center; gap: 8px; }
            .count-input-row input { width: 80px; text-align: center; }
            .count-hint { font-size: 12px; color: var(--text-muted); }
            #btn-fetch-topics { margin-bottom: 8px; background: var(--bg-hover); border: 1px solid var(--border-medium); color: var(--text-main); }
            #btn-fetch-topics:hover { background: var(--bg-active); }
            #topics-source, #topics-category { cursor: pointer; }
            .fetch-result-preview { padding: 4px 0; }
            .fetch-result-header { font-size: 14px; margin-bottom: 12px; color: var(--text-main); }
            .fetch-result-list { font-size: 12px; line-height: 1.6; }
            .fetch-result-item { display: flex; gap: 6px; margin-bottom: 4px; }
            .fetch-result-item .item-index { color: var(--text-muted); min-width: 20px; }
            .fetch-result-item .item-title { color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .fetch-result-more { color: var(--text-muted); font-style: italic; margin-top: 4px; }
            .fetch-result-tip { margin-top: 12px; font-size: 12px; color: var(--primary); }
            .shortcut-hint { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: var(--text-muted); margin-top: 16px; }
            .kbd { display: inline-flex; padding: 2px 5px; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 4px; font-family: ui-monospace, monospace; font-size: 10px; }
            .toast { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(10px); background: #333; color: white; padding: 8px 16px; border-radius: 4px; font-size: 13px; font-weight: 500; box-shadow: var(--shadow-lg); z-index: 10000; opacity: 0; pointer-events: none; transition: all 0.2s; display: flex; align-items: center; gap: 8px; }
            .toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
            .toast.error { background: var(--danger); }
            .api-history-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; margin-bottom: 8px; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius-md); cursor: pointer; transition: all var(--transition-fast); }
            .api-history-item:hover { border-color: var(--brand-gold); background: var(--bg-hover); }
            .api-history-item.active { border-color: var(--brand-gold); background: rgba(227, 160, 67, 0.1); }
            .api-history-info { flex: 1; min-width: 0; }
            .api-history-name { font-size: 13px; font-weight: 500; color: var(--text-main); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .api-history-meta { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .api-history-actions { display: flex; gap: 4px; margin-left: 8px; }
            .api-history-btn { padding: 4px 8px; font-size: 11px; background: transparent; color: var(--text-sec); border: 1px solid var(--border-light); border-radius: var(--radius-sm); cursor: pointer; transition: all var(--transition-fast); }
            .api-history-btn:hover { border-color: var(--brand-gold); color: var(--brand-gold); }
            .api-history-btn.delete:hover { border-color: var(--danger); color: var(--danger); }
            .result-actions { display: flex; gap: 6px; }
            .summary-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s ease; }
            .summary-modal { background: var(--bg-card); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); width: 90vw; max-width: 800px; max-height: 85vh; display: flex; flex-direction: column; animation: modalIn 0.25s ease; }
            @keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            .summary-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
            .summary-modal-title { font-size: 16px; font-weight: 600; color: var(--text-main); }
            .summary-modal-close { background: none; border: none; cursor: pointer; padding: 6px; border-radius: var(--radius-sm); color: var(--text-muted); transition: all var(--transition-fast); }
            .summary-modal-close:hover { background: var(--bg-hover); color: var(--text-main); }
            .summary-modal-close svg { width: 20px; height: 20px; }
            .summary-modal-body { flex: 1; overflow-y: auto; padding: 20px; font-size: 14px; line-height: 1.7; color: var(--text-main); }
            .summary-modal-body h1, .summary-modal-body h2, .summary-modal-body h3 { margin: 16px 0 8px; font-weight: 600; }
            .summary-modal-body p { margin-bottom: 10px; }
            .summary-modal-body ul, .summary-modal-body ol { padding-left: 20px; margin: 10px 0; }
            .summary-modal-body li { margin-bottom: 6px; }
            .summary-modal-body code { background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
            .summary-modal-body pre { background: var(--bg-setting); padding: 12px; border-radius: var(--radius-md); overflow-x: auto; }
            .tab-bar { display: flex; padding: 0 16px; gap: 24px; border-bottom: 1px solid var(--border-light); background: var(--bg-card); flex-shrink: 0; }
            .tab-item { padding: 14px 4px; text-align: center; font-size: 14px; font-weight: 500; color: var(--text-sec); cursor: pointer; border-bottom: 2px solid transparent; transition: all var(--transition-fast); display: flex; align-items: center; gap: 6px; white-space: nowrap; }
            .tab-item span { display: inline; }
            .sidebar-panel.narrow .tab-bar { gap: 8px; padding: 0 8px; justify-content: space-around; }
            .sidebar-panel.narrow .tab-item span { display: none; }
            .sidebar-panel.narrow .tab-item { padding: 14px 8px; }
`;
        },

        render() {
            const html = `
                <div id="toggle-btn" title="拖动改变位置，点击展开/关闭 (Ctrl+Shift+S)">${this.ICONS.arrowLeft}</div>
                <div class="sidebar-panel" id="sidebar">
                    <div class="resize-handle" id="resizer"></div>
                    <div class="toast" id="toast"></div>
                    <div class="header">
                        <div class="header-title">
                            <div class="header-title-icon">${this.ICONS.brain}</div>
                            智能总结
                        </div>
                        <div class="header-actions">
                            <button class="icon-btn" id="btn-theme" data-tooltip="切换主题">${this.ICONS.moon}</button>
                            <button class="icon-btn" id="btn-close" data-tooltip="关闭">${this.ICONS.close}</button>
                        </div>
                    </div>
                    <div class="tab-bar">
                        <div class="tab-item active" data-tab="summary">${this.ICONS.summary}<span>帖子</span></div>
                        <div class="tab-item" data-tab="topics">${this.ICONS.topics}<span>话题</span></div>
                        <div class="tab-item" data-tab="chat">${this.ICONS.chat}<span>对话</span></div>
                        <div class="tab-item" data-tab="export">📦<span>导出</span></div>
                        <div class="tab-item" data-tab="settings">${this.ICONS.settings}<span>设置</span></div>
                    </div>
                    <div class="content-area">
                        <div id="page-summary" class="view-page active">
                             <div class="form-group">
                                 <div class="range-header">
                                     <label class="form-label" style="margin:0;">楼层范围</label>
                                     <div class="range-buttons">
                                         <button class="btn-xs" id="range-all">全部</button>
                                         <button class="btn-xs" id="range-recent">最近<span id="recent-count">50</span></button>
                                     </div>
                                 </div>
                                 <div class="range-inputs">
                                     <input type="number" id="inp-start" placeholder="起始" min="1">
                                     <span class="range-separator">→</span>
                                     <input type="number" id="inp-end" placeholder="结束" min="1">
                                 </div>
                             </div>
                             <button class="btn" id="btn-summary">
                                 <div class="spinner"></div>
                                 <span class="btn-text" style="display:flex;align-items:center;gap:6px;">${this.ICONS.sparkles} 开始智能总结</span>
                             </button>
                             <div id="summary-result" class="result-box empty">
                                 <div class="tip-text">
                                     <span class="tip-icon">${this.ICONS.robot}</span>
                                     点击「开始智能总结」后，<br>AI 将分析帖子内容并生成摘要<br><br>
                                     💡 总结完成后可切换到<strong>「对话」</strong>继续追问
                                 </div>
                             </div>
                             <div class="shortcut-hint">
                                 <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">S</span> 快速打开
                             </div>
                        </div>
                        <!-- 话题页面 -->
                        <div id="page-topics" class="view-page">
                            <div class="form-group">
                                <label class="form-label">话题来源</label>
                                <select id="topics-source">
                                    <option value="current">当前页面</option>
                                    <option value="top">最热话题</option>
                                    <option value="new">最新话题</option>
                                    <option value="latest">最近活跃</option>
                                    <option value="category">指定分类</option>
                                </select>
                            </div>
                            <div class="form-group" id="category-selector-group" style="display:none;">
                                <label class="form-label">选择分类</label>
                                <select id="topics-category">
                                    <option value="">加载中...</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">总结模式</label>
                                <select id="topics-mode">
                                    <option value="list">仅总结标题列表（快速）</option>
                                    <option value="detail">获取主帖内容后总结（详细）</option>
                                </select>
                            </div>
                            <div class="form-group" id="topics-range-group">
                                <div class="range-header">
                                    <label class="form-label" style="margin:0;">话题范围</label>
                                    <div class="range-buttons">
                                        <button class="btn-xs" id="topics-range-all">全部</button>
                                        <button class="btn-xs" id="topics-range-10">前10</button>
                                        <button class="btn-xs" id="topics-range-20">前20</button>
                                    </div>
                                </div>
                                <div class="range-inputs">
                                    <input type="number" id="topics-start" placeholder="起始" min="1" value="1">
                                    <span class="range-separator">→</span>
                                    <input type="number" id="topics-end" placeholder="结束" min="1">
                                </div>
                            </div>
                            <div class="form-group" id="remote-topics-count-group" style="display:none;">
                                <div class="range-header">
                                    <label class="form-label" style="margin:0;">获取数量</label>
                                    <div class="range-buttons">
                                        <button class="btn-xs" id="count-50">50</button>
                                        <button class="btn-xs" id="count-100">100</button>
                                        <button class="btn-xs" id="count-300">300</button>
                                        <button class="btn-xs" id="count-500">500</button>
                                    </div>
                                </div>
                                <div class="count-input-row">
                                    <input type="number" id="remote-topics-count" value="100" min="5" max="500" step="5">
                                    <span class="count-hint">条（5-500）</span>
                                </div>
                            </div>
                            <button class="btn" id="btn-fetch-topics" style="display:none;">
                                <div class="spinner"></div>
                                <span class="btn-text" style="display:flex;align-items:center;gap:6px;">${this.ICONS.refresh} 获取话题</span>
                            </button>
                            <button class="btn" id="btn-topics-summary">
                                <div class="spinner"></div>
                                <span class="btn-text" style="display:flex;align-items:center;gap:6px;">${this.ICONS.sparkles} 总结话题列表</span>
                            </button>
                            <div id="topics-result" class="result-box empty">
                                <div class="tip-text">
                                    <span class="tip-icon">${this.ICONS.robot}</span>
                                    选择话题来源开始总结<br><br>
                                    • <strong>当前页面</strong>：总结页面上显示的话题<br>
                                    • <strong>远程获取</strong>：从论坛API获取最新话题<br><br>
                                    💡 「快速模式」仅使用标题，「详细模式」会获取主帖内容
                                </div>
                            </div>
                        </div>
                        <div id="page-chat" class="view-page">
                            <div class="chat-container">
                                 <div class="chat-toolbar">
                                     <div class="chat-toolbar-title">
                                         对话记录
                                         <span class="msg-count" id="msg-count">0</span>
                                     </div>
                                     <button class="btn-clear" id="btn-clear-chat" title="清空对话">
                                         ${this.ICONS.trash} 清空
                                     </button>
                                 </div>
                                 <div class="chat-messages-wrapper">
                                     <div class="scroll-buttons top-area"><button class="scroll-btn" id="btn-scroll-top" title="滚动到顶部">${this.ICONS.arrowUp}</button></div>
                                     <div class="chat-messages" id="chat-messages">
                                         <div id="chat-list" class="chat-list"></div>
                                         <div id="chat-empty" class="tip-text">
                                             <span class="tip-icon">${this.ICONS.chat}</span>
                                             请先在<strong>「总结」</strong>页面生成内容摘要，<br>然后即可基于上下文进行对话
                                         </div>
                                     </div>
                                     <div class="scroll-buttons bottom-area"><button class="scroll-btn" id="btn-scroll-bottom" title="滚动到底部">${this.ICONS.arrowDown}</button></div>
                                 </div>
                                 <div class="chat-input-area">
                                     <div class="chat-input-row">
                                         <textarea id="chat-input" class="chat-input" placeholder="输入你的问题... (Enter 发送)" rows="1"></textarea>
                                         <button class="send-btn" id="btn-send" title="发送消息">${this.ICONS.send}</button>
                                     </div>
                                 </div>
                            </div>
                        </div>
                        <!-- 导出页面 -->
                        <div id="page-export" class="view-page">
                            <div class="form-group">
                                <label class="form-label">导出类型</label>
                                <select id="export-type">
                                    <option value="html">HTML 离线导出</option>
                                    <option value="ai-text">AI 文本导出</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <div class="range-header">
                                    <label class="form-label" style="margin:0;">导出范围</label>
                                    <div class="range-buttons">
                                        <button class="btn-xs" id="export-range-all">全部</button>
                                        <button class="btn-xs" id="export-range-recent">最近<span id="export-recent-count">50</span></button>
                                    </div>
                                </div>
                                <div class="range-inputs">
                                    <input type="number" id="export-start" placeholder="起始" min="1">
                                    <span class="range-separator">→</span>
                                    <input type="number" id="export-end" placeholder="结束" min="1">
                                </div>
                            </div>
                            <div id="html-export-options" class="form-group">
                                <label class="form-label">HTML 导出选项</label>
                                <div class="setting-item-row" style="margin-bottom:12px;">
                                    <div class="setting-info">
                                        <label class="setting-label">离线图片</label>
                                        <div class="setting-desc">将图片转为 base64 嵌入</div>
                                    </div>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="export-offline-images" checked>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <label class="setting-label" style="margin-bottom:8px;">主题选择</label>
                                <select id="export-theme">
                                    <option value="light">浅色主题</option>
                                    <option value="dark">深色主题</option>
                                </select>
                            </div>
                            <div id="ai-text-options" class="form-group" style="display:none;">
                                <label class="form-label">AI 文本选项</label>
                                <div class="setting-item-row" style="margin-bottom:12px;">
                                    <div class="setting-info">
                                        <label class="setting-label">包含头部信息</label>
                                        <div class="setting-desc">标题、作者、时间等</div>
                                    </div>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="export-ai-header" checked>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div class="setting-item-row" style="margin-bottom:12px;">
                                    <div class="setting-info">
                                        <label class="setting-label">包含图片链接</label>
                                        <div class="setting-desc">保留图片 URL</div>
                                    </div>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="export-ai-images" checked>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div class="setting-item-row">
                                    <div class="setting-info">
                                        <label class="setting-label">包含引用块</label>
                                        <div class="setting-desc">保留引用内容</div>
                                    </div>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="export-ai-quotes" checked>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                            <button class="btn" id="btn-export">
                                <div class="spinner"></div>
                                <span class="btn-text">📦 开始导出</span>
                            </button>
                            <div id="export-status" class="result-box empty" style="margin-top:16px;min-height:100px;">
                                <div class="tip-text">
                                    <span class="tip-icon">📦</span>
                                    选择导出类型和范围后，<br>点击「开始导出」即可下载文件
                                </div>
                            </div>
                        </div>
                        <div id="page-settings" class="view-page settings-page">
                             <div class="settings-group">
                                 <div class="settings-group-title">API 配置</div>
                                 <div class="setting-item"><label class="setting-label">API 地址</label><input type="text" id="cfg-url" placeholder="https://api.openai.com/v1/chat/completions"></div>
                                 <div class="setting-item"><label class="setting-label">API Key</label><input type="password" id="cfg-key" placeholder="sk-..."></div>
                                 <div class="setting-item"><label class="setting-label">模型名称</label><input type="text" id="cfg-model" placeholder="deepseek-chat"></div>
                             </div>
                             <div class="settings-group">
                                 <div class="settings-group-title">历史配置</div>
                                 <div class="setting-item">
                                     <div class="setting-desc" style="margin-bottom:10px;">保存的API配置会自动记录在这里，点击可快速切换</div>
                                     <div id="api-history-list" style="max-height:200px;overflow-y:auto;"></div>
                                     <div id="api-history-empty" class="tip-text" style="padding:15px;font-size:12px;color:var(--text-muted);">暂无历史配置<br>保存设置后会自动记录</div>
                                 </div>
                             </div>
                             <div class="settings-group">
                                 <div class="settings-group-title">提示词配置</div>
                                 <div class="setting-item"><label class="setting-label">帖子总结提示词</label><div class="setting-desc">用于生成帖子摘要时的系统指令</div><textarea id="cfg-prompt-sum" rows="4"></textarea></div>
                                 <div class="setting-item"><label class="setting-label">帖子对话提示词</label><div class="setting-desc">用于帖子总结后追问时的系统指令</div><textarea id="cfg-prompt-chat" rows="4"></textarea></div>
                                 <div class="setting-item"><label class="setting-label">话题总结提示词</label><div class="setting-desc">用于生成话题列表摘要时的系统指令</div><textarea id="cfg-prompt-topics" rows="4"></textarea></div>
                                 <div class="setting-item"><label class="setting-label">话题对话提示词</label><div class="setting-desc">用于话题总结后追问时的系统指令</div><textarea id="cfg-prompt-topics-chat" rows="4"></textarea></div>
                             </div>
                             <div class="settings-group">
                                 <div class="settings-group-title">高级设置</div>
                                 <div class="setting-item setting-item-row">
                                     <div class="setting-info"><label class="setting-label">快捷楼层数</label><div class="setting-desc">"最近N楼"按钮的楼层数量</div></div>
                                     <input type="number" id="cfg-recent-floors" min="10" max="500" style="width:80px; text-align:center; padding:6px 10px;">
                                 </div>
                                 <div class="setting-item setting-item-row">
                                     <div class="setting-info"><label class="setting-label">话题并发数</label><div class="setting-desc">获取话题时的并发数（1-10）</div></div>
                                     <input type="number" id="cfg-topics-concurrency" min="1" max="10" style="width:80px; text-align:center; padding:6px 10px;">
                                 </div>
                                 <div class="setting-item setting-item-row">
                                     <div class="setting-info"><label class="setting-label">流式输出</label><div class="setting-desc">开启后内容会逐字显示，关闭则等待完成后一次性显示</div></div>
                                     <label class="toggle-switch"><input type="checkbox" id="cfg-stream" checked><span class="toggle-slider"></span></label>
                                 </div>
                                 <div class="setting-item setting-item-row">
                                     <div class="setting-info"><label class="setting-label">自动滚动</label><div class="setting-desc">生成内容时自动滚动到最新位置</div></div>
                                     <label class="toggle-switch"><input type="checkbox" id="cfg-autoscroll" checked><span class="toggle-slider"></span></label>
                                 </div>
                             </div>
                             <button class="btn" id="btn-save">${this.ICONS.check} 保存设置</button>
                        </div>
                    </div>
                </div>`;
            this.uiManager.shadow.innerHTML += html;
        },

        bindEvents() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            Q('.tab-bar').addEventListener('click', (e) => {
                const tab = e.target.closest('.tab-item');
                if (tab) this.switchTab(tab.dataset.tab);
            });
            Q('#toggle-btn').addEventListener('click', () => this.toggleSidebar());
            Q('#btn-theme').onclick = () => this.toggleTheme();

            // thinking块折叠
            this.uiManager.shadow.addEventListener('click', (e) => {
                const toggle = e.target.closest('[data-thinking-toggle]');
                if (toggle) {
                    const block = toggle.closest('[data-thinking-block]');
                    if (block) block.classList.toggle('expanded');
                }
            });

            // 拖动
            const btn = Q('#toggle-btn');
            let isDragging = false, wasDragged = false, startY;
            btn.addEventListener('mousedown', (e) => { isDragging = true; wasDragged = false; startY = e.clientY; e.preventDefault(); });
            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                if (Math.abs(e.clientY - startY) > 5) wasDragged = true;
                let newTop = Math.max(50, Math.min(window.innerHeight - 60, e.clientY));
                btn.style.top = newTop + 'px';
                this.btnPos.top = newTop + 'px';
            });
            window.addEventListener('mouseup', (e) => {
                if (isDragging) {
                    isDragging = false;
                    if (!wasDragged) return;
                    const w = window.innerWidth;
                    if (e.clientX < w * 0.2) this.side = 'left';
                    else if (e.clientX > w * 0.8) this.side = 'right';
                    this.btnPos.side = this.side;
                    GM_setValue('style2_btnPos', this.btnPos);
                    this.applySideState();
                    if (this.isOpen) this.squeezeBody(true);
                }
            });

            // 侧边栏拖动
            let isResizing = false;
            Q('#resizer').addEventListener('mousedown', (e) => {
                isResizing = true;
                document.body.style.cursor = 'col-resize';
                Q('#sidebar').style.transition = 'none';
                document.body.style.transition = 'none';
                e.preventDefault();
            });

            window.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                let newW = this.side === 'right' ? (window.innerWidth - e.clientX) : e.clientX;
                if (newW > 320 && newW < 700) {
                    this.sidebarWidth = newW;
                    this.uiManager.host.style.setProperty('--sidebar-width', `${newW}px`);
                    Q('#sidebar').classList.toggle('narrow', newW < 380);
                    if (this.isOpen) {
                        this.squeezeBody(true);
                        this.updateButtonPosition(false);
                    }
                }
            });

            window.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.cursor = '';
                    Q('#sidebar').style.transition = '';
                    document.body.style.transition = 'margin 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
                    GM_setValue('style2_sidebarWidth', this.sidebarWidth);
                }
            });

            Q('#range-all').onclick = () => this.setRange('all');
            Q('#range-recent').onclick = () => this.setRange('recent');
            Q('#btn-summary').onclick = () => this.doSummary();
            Q('#btn-send').onclick = () => this.doChat();
            Q('#chat-input').onkeydown = (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.doChat(); }
            };
            Q('#chat-input').addEventListener('input', (e) => {
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 140) + 'px';
            });
            Q('#btn-clear-chat').onclick = () => this.clearChat();
            Q('#btn-scroll-top').onclick = () => this.scrollToTop();
            Q('#btn-scroll-bottom').onclick = () => this.forceScrollToBottom();

            const chatMessages = Q('#chat-messages');
            let lastScrollTop = 0;
            chatMessages.addEventListener('scroll', () => {
                const currentScrollTop = chatMessages.scrollTop;
                const isNearBottom = (chatMessages.scrollHeight - currentScrollTop - chatMessages.clientHeight) < 80;
                if (this.isGenerating && !this.isProgrammaticScroll) {
                    this.userScrolledUp = currentScrollTop < lastScrollTop - 10 ? true : (isNearBottom ? false : this.userScrolledUp);
                }
                lastScrollTop = currentScrollTop;
                this.updateScrollButtons();
            });

            Q('#btn-save').onclick = () => {
                if (typeof this.saveSettings === 'function') {
                    this.saveSettings();
                    this.switchTab('summary');
                    return;
                }
                GM_setValue('apiUrl', Q('#cfg-url').value.trim());
                GM_setValue('apiKey', Q('#cfg-key').value.trim());
                GM_setValue('model', Q('#cfg-model').value.trim());
                GM_setValue('prompt_sum', Q('#cfg-prompt-sum').value);
                GM_setValue('prompt_chat', Q('#cfg-prompt-chat').value);
                GM_setValue('prompt_topics', Q('#cfg-prompt-topics').value);
                GM_setValue('prompt_topics_chat', Q('#cfg-prompt-topics-chat').value);
                const recentFloors = parseInt(Q('#cfg-recent-floors').value) || 50;
                GM_setValue('recentFloors', Math.max(10, Math.min(500, recentFloors)));
                Q('#recent-count').textContent = GM_getValue('recentFloors', 50);
                Q('#export-recent-count').textContent = recentFloors;
                const topicsConcurrency = parseInt(Q('#cfg-topics-concurrency').value) || 4;
                GM_setValue('topicsConcurrency', Math.max(1, Math.min(10, topicsConcurrency)));
                GM_setValue('useStream', Q('#cfg-stream').checked);
                GM_setValue('autoScroll', Q('#cfg-autoscroll').checked);
                this.showToast('设置已保存', 'success');
                this.switchTab('summary');
            };

            Q('#export-type').onchange = (e) => {
                const isHtml = e.target.value === 'html';
                Q('#html-export-options').style.display = isHtml ? 'block' : 'none';
                Q('#ai-text-options').style.display = isHtml ? 'none' : 'block';
            };
            Q('#export-range-all').onclick = () => this.setExportRange('all');
            Q('#export-range-recent').onclick = () => this.setExportRange('recent');
            Q('#btn-export').onclick = () => this.doExport();

            Q('#topics-range-all').onclick = () => this.setTopicsRange('all');
            Q('#topics-range-10').onclick = () => this.setTopicsRange(10);
            Q('#topics-range-20').onclick = () => this.setTopicsRange(20);
            Q('#btn-topics-summary').onclick = () => this.doTopicsSummary();

            Q('#topics-source').onchange = (e) => this.onTopicsSourceChange(e.target.value);
            Q('#btn-fetch-topics').onclick = () => this.doFetchRemoteTopics();

            // 获取数量快捷按钮
            Q('#count-50').onclick = () => Q('#remote-topics-count').value = 50;
            Q('#count-100').onclick = () => Q('#remote-topics-count').value = 100;
            Q('#count-300').onclick = () => Q('#remote-topics-count').value = 300;
            Q('#count-500').onclick = () => Q('#remote-topics-count').value = 500;

            this._remoteTopicsData = null;
        },

        bindKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.toggleSidebar(); }
                if (e.key === 'Escape' && this.isOpen) { this.toggleSidebar(); }
            });
        },
        restoreState() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            this.uiManager.host.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`);
            const btn = Q('#toggle-btn');
            btn.style.top = this.btnPos.top;
            this.applySideState();
            if (this.isDarkTheme) {
                this.uiManager.host.classList.add('dark-theme');
                Q('#btn-theme').innerHTML = this.ICONS.sun;
            } else {
                Q('#btn-theme').innerHTML = this.ICONS.moon;
            }

            // 尝试加载上次使用的API配置
            const lastUsedConfig = ApiHistory.getLastUsed();
            if (lastUsedConfig) {
                Q('#cfg-url').value = lastUsedConfig.url;
                Q('#cfg-key').value = lastUsedConfig.key;
                Q('#cfg-model').value = lastUsedConfig.model;
            } else {
                Q('#cfg-url').value = GM_getValue('apiUrl', 'https://api.deepseek.com/v1/chat/completions');
                Q('#cfg-key').value = GM_getValue('apiKey', '');
                Q('#cfg-model').value = GM_getValue('model', 'deepseek-chat');
            }
            Q('#cfg-prompt-sum').value = GM_getValue('prompt_sum', '请总结以下论坛帖子内容。使用 Markdown 格式，条理清晰，重点突出主要观点、争议点和结论。适当使用标题、列表和引用来组织内容。');
            Q('#cfg-prompt-chat').value = GM_getValue('prompt_chat', '你是一个帖子阅读助手。基于上文中的帖子内容，回答用户的问题。回答要准确、简洁，必要时引用原文。');
            Q('#cfg-prompt-topics').value = GM_getValue('prompt_topics', `你是一个论坛话题分析助手。请分析以下话题列表，总结出：
1. 当前热门讨论主题和趋势
2. 值得关注的精华内容
3. 不同分类的话题分布
4. 简要推荐哪些话题值得阅读

重要：在提到具体话题时，请使用 Markdown 链接格式 [话题标题](链接URL) 让用户可以直接点击跳转。
使用 Markdown 格式输出，条理清晰。`);
            Q('#cfg-prompt-topics-chat').value = GM_getValue('prompt_topics_chat', '你是一个论坛话题分析助手。基于上文中的话题列表内容，回答用户的问题。回答要准确、简洁，必要时引用原文。');
            const recentFloors = GM_getValue('recentFloors', 50);
            Q('#cfg-recent-floors').value = recentFloors;
            Q('#recent-count').textContent = recentFloors;
            Q('#cfg-topics-concurrency').value = GM_getValue('topicsConcurrency', 4);
            Q('#cfg-stream').checked = GM_getValue('useStream', true);
            Q('#cfg-autoscroll').checked = GM_getValue('autoScroll', true);

            // 根据宽度设置narrow class
            Q('#sidebar').classList.toggle('narrow', this.sidebarWidth < 380);

            // 渲染API历史配置列表
            this.renderApiHistory();
        },
        applySideState() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const btn = Q('#toggle-btn');
            const sidebar = Q('#sidebar');
            const resizer = Q('#resizer');
            btn.style.left = ''; btn.style.right = '';

            if (this.side === 'left') {
                sidebar.className = 'sidebar-panel panel-left' + (this.isOpen ? ' open' : '');
                resizer.className = 'resize-handle handle-left';
                btn.className = 'btn-snap-left' + (this.isOpen ? ' arrow-flip' : '');
                btn.innerHTML = this.ICONS.arrowRight;
            } else {
                sidebar.className = 'sidebar-panel panel-right' + (this.isOpen ? ' open' : '');
                resizer.className = 'resize-handle handle-right';
                btn.className = 'btn-snap-right' + (this.isOpen ? ' arrow-flip' : '');
                btn.innerHTML = this.ICONS.arrowLeft;
            }
            this.updateButtonPosition();
        },
        updateButtonPosition(useTransition = true) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const btn = Q('#toggle-btn');
            if (!useTransition) btn.style.transition = 'none'; else btn.style.transition = '';
            if (this.side === 'left') {
                btn.style.right = 'auto';
                btn.style.left = this.isOpen ? `${this.sidebarWidth}px` : '0';
            } else {
                btn.style.left = 'auto';
                btn.style.right = this.isOpen ? `${this.sidebarWidth}px` : '0';
            }
            if (!useTransition) {
                btn.offsetHeight;
                requestAnimationFrame(() => { btn.style.transition = ''; });
            }
        },

        toggleSidebar() {
            this.isOpen = !this.isOpen;
            const Q = this.uiManager.Q.bind(this.uiManager);
            Q('#sidebar').classList.toggle('open', this.isOpen);
            Q('#toggle-btn').classList.toggle('arrow-flip', this.isOpen);
            this.squeezeBody(this.isOpen);
            if (this.isOpen) this.initRangeInputs();
            this.updateButtonPosition();
        },

        squeezeBody(active) {
            const body = document.body;
            body.style.transition = 'margin 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            if (!active) {
                body.style.marginLeft = ''; body.style.marginRight = '';
            } else {
                if (this.side === 'left') {
                    body.style.marginLeft = `${this.sidebarWidth}px`; body.style.marginRight = '';
                } else {
                    body.style.marginRight = `${this.sidebarWidth}px`; body.style.marginLeft = '';
                }
            }
        },

        switchTab(tabName) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            Q('.tab-bar').querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
            Q('.content-area').querySelectorAll('.view-page').forEach(p => p.classList.toggle('active', p.id === `page-${tabName}`));
            this.currentTab = tabName;
            if (tabName === 'chat') setTimeout(() => this.updateScrollButtons(), 100);
            if (tabName === 'topics') this.initTopicsPage();
        },
        toggleTheme() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            this.isDarkTheme = !this.isDarkTheme;
            GM_setValue('style2_isDarkTheme', this.isDarkTheme);
            this.uiManager.host.classList.toggle('dark-theme', this.isDarkTheme);
            Q('#btn-theme').innerHTML = this.isDarkTheme ? this.ICONS.sun : this.ICONS.moon;
        },
        setLoading(btnId, isLoading) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const btn = Q(btnId);
            this.isGenerating = isLoading;
            btn.disabled = isLoading;
            btn.classList.toggle('loading', isLoading);
            if (btnId === '#btn-send') {
                const input = Q('#chat-input');
                if (input) {
                    input.disabled = isLoading;
                    input.placeholder = isLoading ? '正在生成回复...' : '输入你的问题... (Enter 发送)';
                }
            }
        },

        async doSummary() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const tid = Core.getTopicId();
            const start = Q('#inp-start').value, end = Q('#inp-end').value;
            if (!tid) return this.showToast('未检测到帖子ID', 'error');
            if (!start || !end || parseInt(start) > parseInt(end)) return this.showToast('楼层范围无效', 'error');

            this.setLoading('#btn-summary', true);
            const resultBox = Q('#summary-result');
            resultBox.classList.remove('empty');
            resultBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在获取帖子内容...</div>`;

            try {
                const text = await Core.fetchDialogues(tid, parseInt(start), parseInt(end));
                if (!text) throw new Error('未获取到内容');
                this.postContent = text;
                resultBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>AI 正在分析中...</div>`;

                const messages = [
                    { role: 'system', content: GM_getValue('prompt_sum', '') },
                    { role: 'user', content: `帖子内容:\n${text}` }
                ];

                let aiText = '';
                await Core.streamChat(messages,
                    (chunk) => {
                        aiText += chunk;
                        this.updateResultBox(resultBox, aiText, true);
                    },
                    () => {
                        this.setLoading('#btn-summary', false);
                        this.updateResultBox(resultBox, aiText, false);
                        this.lastSummary = aiText;
                        this.chatHistory = [
                            { role: 'system', content: GM_getValue('prompt_chat', '') },
                            { role: 'user', content: `以下是帖子内容供你参考:\n${text}` },
                            { role: 'assistant', content: aiText }
                        ];
                        Q('#chat-list').innerHTML = '';
                        this.userMessageCount = 0;
                        this.updateMessageCount();
                        Q('#chat-empty').classList.remove('hidden');
                        Q('#chat-empty').innerHTML = '<span class="tip-icon">✅</span>总结已完成！<br>现在可以基于帖子内容进行对话';
                    },
                    (err) => {
                        resultBox.innerHTML = `<div style="color:var(--danger)">❌ 错误: ${err}</div>`;
                        this.setLoading('#btn-summary', false);
                        this.showToast('总结失败: ' + err, 'error');
                    }
                );
            } catch (e) {
                resultBox.innerHTML = `<div style="color:var(--danger)">❌ 错误: ${e.message}</div>`;
                this.setLoading('#btn-summary', false);
            }
        },

        async doChat() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            if (this.isGenerating) return;
            if (this.chatHistory.length === 0) return this.showToast('请先生成总结', 'error');

            const input = Q('#chat-input');
            const txt = input.value.trim();
            if (!txt) return;

            input.value = '';
            input.style.height = 'auto';
            Q('#chat-empty').classList.add('hidden');
            this.userScrolledUp = false;

            this.addBubble('user', txt);
            this.chatHistory.push({ role: 'user', content: txt });
            this.userMessageCount++;
            this.updateMessageCount();

            const msgDiv = this.addBubble('ai', '');
            msgDiv.innerHTML = `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>`;
            let aiText = '';

            this.setLoading('#btn-send', true);

            await Core.streamChat(this.chatHistory,
                (chunk) => {
                    aiText += chunk;
                    this.updateBubble(msgDiv, aiText, true);
                    this.scrollToBottom();
                },
                () => {
                    this.updateBubble(msgDiv, aiText, false);
                    this.chatHistory.push({ role: 'assistant', content: aiText });
                    this.setLoading('#btn-send', false);
                    this.userScrolledUp = false;
                    this.updateScrollButtons();
                },
                (err) => {
                    msgDiv.innerHTML += `<br><span style="color:var(--danger)">❌ ${err}</span>`;
                    this.setLoading('#btn-send', false);
                }
            );
        },

        initRangeInputs() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const max = Core.getReplyCount();
            const start = Q('#inp-start'), end = Q('#inp-end');
            if (!start.value) start.value = 1;
            if (max && !end.value) end.value = max;
        },

        setRange(type) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            let max = Core.getReplyCount();
            if (!max || max < 1) max = 1;
            Q('#inp-end').value = max;
            const recentFloors = GM_getValue('recentFloors', 50);
            Q('#inp-start').value = type === 'all' ? 1 : Math.max(1, max - recentFloors + 1);
        },
        updateResultBox(resultBox, text, isStreaming) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const currentBlock = resultBox.querySelector('[data-thinking-block]');
            const isExpanded = currentBlock?.classList.contains('expanded') || false;
            const contentHTML = this.renderWithThinking(text, isStreaming, isExpanded);
            resultBox.innerHTML = `
                <div class="result-actions">
                    <button class="result-action-btn" id="btn-view-summary">🔍 查看</button>
                    <button class="result-action-btn" id="btn-copy-summary">${this.ICONS.copy} 复制</button>
                </div>
            ` + contentHTML;

            // 查看按钮 - 弹窗显示
            const viewBtn = Q('#btn-view-summary');
            if (viewBtn) {
                viewBtn.onclick = () => this.showSummaryModal(text);
            }

            const copyBtn = Q('#btn-copy-summary');
            if (copyBtn) {
                copyBtn.onclick = () => {
                    this.copyToClipboard(Core.parseThinkingContent(text).content);
                    copyBtn.classList.add('copied');
                    copyBtn.innerHTML = `${this.ICONS.check} 已复制`;
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.innerHTML = `${this.ICONS.copy} 复制`;
                    }, 2000);
                };
            }
            if (GM_getValue('autoScroll', true)) {
                setTimeout(() => {
                    resultBox.scrollTop = resultBox.scrollHeight;
                    const thinkingInner = resultBox.querySelector('.thinking-content-inner');
                    if (thinkingInner && isExpanded) {
                        thinkingInner.scrollTop = thinkingInner.scrollHeight;
                    }
                }, 0);
            }
        },
        updateBubble(bubbleDiv, text, isStreaming) {
            const currentBlock = bubbleDiv.querySelector('[data-thinking-block]');
            const isExpanded = currentBlock?.classList.contains('expanded') || false;
            // 存储原始文本用于复制
            bubbleDiv.dataset.rawText = text;
            // 流式输出完成后添加操作按钮
            const actionsHtml = !isStreaming ? `
                <div class="bubble-actions">
                    <button class="bubble-action-btn bubble-view-btn">🔍 查看</button>
                    <button class="bubble-action-btn bubble-copy-btn">${this.ICONS.copy} 复制</button>
                </div>
            ` : '';
            bubbleDiv.innerHTML = actionsHtml + this.renderWithThinking(text, isStreaming, isExpanded);
            // 绑定按钮事件
            if (!isStreaming) {
                this.bindBubbleActions(bubbleDiv, text);
            }
            if (GM_getValue('autoScroll', true) && isExpanded) {
                setTimeout(() => {
                    const thinkingInner = bubbleDiv.querySelector('.thinking-content-inner');
                    if (thinkingInner) thinkingInner.scrollTop = thinkingInner.scrollHeight;
                }, 0);
            }
        },

        addBubble(role, text, isStreaming = true) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const div = document.createElement('div');
            div.className = `bubble bubble-${role}`;
            if (role === 'user') {
                div.innerHTML = text;
            } else {
                div.dataset.rawText = text;
                // AI消息：流式输出时不显示按钮，完成后才显示
                const actionsHtml = !isStreaming ? `
                    <div class="bubble-actions">
                        <button class="bubble-action-btn bubble-view-btn">🔍 查看</button>
                        <button class="bubble-action-btn bubble-copy-btn">${this.ICONS.copy} 复制</button>
                    </div>
                ` : '';
                div.innerHTML = actionsHtml + this.renderWithThinking(text);
                if (!isStreaming) {
                    this.bindBubbleActions(div, text);
                }
            }
            Q('#chat-list').appendChild(div);
            this.scrollToBottom();
            return div;
        },

        bindBubbleActions(bubbleDiv, text) {
            const viewBtn = bubbleDiv.querySelector('.bubble-view-btn');
            const copyBtn = bubbleDiv.querySelector('.bubble-copy-btn');
            if (viewBtn) {
                viewBtn.onclick = () => this.showSummaryModal(text);
            }
            if (copyBtn) {
                copyBtn.onclick = () => {
                    this.copyToClipboard(Core.parseThinkingContent(text).content);
                    copyBtn.classList.add('copied');
                    copyBtn.innerHTML = `${this.ICONS.check} 已复制`;
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.innerHTML = `${this.ICONS.copy} 复制`;
                    }, 2000);
                };
            }
        },
        renderWithThinking(text, isStreaming = false, keepExpanded = false) {
            const { thinking, content } = Core.parseThinkingContent(text);
            let html = '';
            if (thinking) {
                const charCount = thinking.length;
                const streamingClass = isStreaming ? ' streaming' : '';
                const expandedClass = keepExpanded ? ' expanded' : '';
                const statusText = isStreaming ? '思考中...' : `${charCount} 字符`;
                const previewText = thinking.split('\n').filter(l => l.trim()).slice(-4).join('\n').slice(-150);
                const thinkingHtml = DOMPurify.sanitize(marked.parse(thinking));
                const previewHtml = DOMPurify.sanitize(marked.parse(previewText));
                html += `<div class="thinking-block${streamingClass}${expandedClass}" data-thinking-block>
                             <div class="thinking-header" data-thinking-toggle>
                                 <div class="thinking-header-left">
                                     <div class="thinking-icon">${this.ICONS.brain}</div><span class="thinking-title">思考过程</span>
                                     <span class="thinking-status">${statusText}</span>
                                 </div>
                                 <div class="thinking-toggle">${this.ICONS.arrowDown}</div>
                             </div>
                             <div class="thinking-preview">${previewHtml}</div>
                             <div class="thinking-content"><div class="thinking-content-inner">${thinkingHtml}</div></div>
                         </div>`;
            }
            if (content) {
                html += DOMPurify.sanitize(marked.parse(content));
            }
            return html;
        },
        showToast(message, type = '') {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const toast = Q('#toast');
            toast.textContent = message;
            toast.className = 'toast' + (type ? ` ${type}` : '');
            requestAnimationFrame(() => toast.classList.add('show'));
            setTimeout(() => toast.classList.remove('show'), 2500);
        },

        copyToClipboard(text) {
            GM_setClipboard(text, 'text');
            this.showToast('已复制到剪贴板');
        },

        updateScrollButtons() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const el = Q('#chat-messages');
            const showTop = el.scrollTop > 50;
            const showBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) > 50;
            Q('#btn-scroll-top').classList.toggle('visible', showTop);
            Q('#btn-scroll-bottom').classList.toggle('visible', showBottom || (this.isGenerating && this.userScrolledUp));
            Q('#btn-scroll-bottom').classList.toggle('generating', this.isGenerating && this.userScrolledUp);
        },

        scrollToTop() { this.uiManager.Q('#chat-messages').scrollTo({ top: 0, behavior: 'smooth' }); },

        scrollToBottom(force = false) {
            if (!force && (!GM_getValue('autoScroll', true) || this.userScrolledUp)) return this.updateScrollButtons();
            const el = this.uiManager.Q('#chat-messages');
            this.isProgrammaticScroll = true;
            setTimeout(() => {
                el.scrollTop = el.scrollHeight;
                setTimeout(() => { this.isProgrammaticScroll = false; this.updateScrollButtons(); }, 50);
            }, 0);
        },

        forceScrollToBottom() {
            this.userScrolledUp = false;
            this.scrollToBottom(true);
        },

        clearChat() {
            if (this.chatHistory.length === 0) return;
            if (confirm('确定要清空所有对话记录吗？\n（总结上下文将保留）')) {
                if (this.chatHistory.length > 3) this.chatHistory = this.chatHistory.slice(0, 3);
                this.uiManager.Q('#chat-list').innerHTML = '';
                this.userMessageCount = 0;
                this.updateMessageCount();
                const emptyDiv = this.uiManager.Q('#chat-empty');
                emptyDiv.classList.remove('hidden');
                emptyDiv.innerHTML = '<span class="tip-icon">💬</span>对话已清空<br>可以继续基于帖子内容提问';
                this.showToast('对话已清空');
            }
        },

        updateMessageCount() {
            this.uiManager.Q('#msg-count').textContent = this.userMessageCount;
        },

        setExportRange(type) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const max = Core.getReplyCount();
            if (!max) return;
            Q('#export-end').value = max;
            const recentFloors = GM_getValue('recentFloors', 50);
            Q('#export-start').value = type === 'all' ? 1 : Math.max(1, max - recentFloors + 1);
        },

        async doExport() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const tid = Core.getTopicId();
            const exportType = Q('#export-type').value;
            const start = parseInt(Q('#export-start').value);
            const end = parseInt(Q('#export-end').value);

            if (!tid) return this.showToast('未检测到帖子ID', 'error');
            if (!start || !end || start > end) return this.showToast('楼层范围无效', 'error');

            this.setLoading('#btn-export', true);
            const statusBox = Q('#export-status');
            statusBox.classList.remove('empty');
            statusBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在获取帖子数据...</div>`;

            try {
                const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
                const opts = { headers: { 'x-csrf-token': csrf, 'x-requested-with': 'XMLHttpRequest' } };

                const topicRes = await fetch(`https://linux.do/t/${tid}.json`, opts);
                const topicData = await topicRes.json();

                const idRes = await fetch(`https://linux.do/t/${tid}/post_ids.json?post_number=0&limit=99999`, opts);
                const idData = await idRes.json();
                let pIds = idData.post_ids.slice(Math.max(0, start - 1), end);

                if (start <= 1) {
                    const firstId = topicData.post_stream.posts[0].id;
                    if (!pIds.includes(firstId)) pIds.unshift(firstId);
                }

                statusBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在处理 ${pIds.length} 条回复...</div>`;

                let allPosts = [];
                for (let i = 0; i < pIds.length; i += 200) {
                    const chunk = pIds.slice(i, i + 200);
                    const q = chunk.map(id => `post_ids[]=${id}`).join('&');
                    const res = await fetch(`https://linux.do/t/${tid}/posts.json?${q}&include_suggested=false`, opts);
                    const data = await res.json();
                    allPosts.push(...data.post_stream.posts);
                }

                allPosts.sort((a, b) => a.post_number - b.post_number);

                if (exportType === 'html') {
                    await this.exportAsHtml(topicData, allPosts, statusBox);
                } else {
                    await this.exportAsAiText(topicData, allPosts, statusBox);
                }

                this.setLoading('#btn-export', false);
            } catch (e) {
                statusBox.innerHTML = `<div style="color:var(--danger)">❌ 导出失败: ${e.message}</div>`;
                this.setLoading('#btn-export', false);
                this.showToast('导出失败: ' + e.message, 'error');
            }
        },

        async exportAsHtml(topicData, posts, statusBox) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const offlineImages = Q('#export-offline-images').checked;
            const theme = Q('#export-theme').value;

            statusBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在生成 HTML...</div>`;

            const title = Core.escapeHtml(topicData.title);
            const author = Core.escapeHtml(topicData.details?.created_by?.username || '未知');
            const createTime = new Date(topicData.created_at).toLocaleString('zh-CN');

            let postsHtml = '';
            for (const post of posts) {
                const userName = Core.escapeHtml(post.name || post.username);
                const username = Core.escapeHtml(post.username);
                const postTime = new Date(post.created_at).toLocaleString('zh-CN');
                let content = post.cooked;

                if (offlineImages && Core.postHasImage(post)) {
                    statusBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在处理第 ${post.post_number} 楼的图片...</div>`;

                    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
                    const matches = [...content.matchAll(imgRegex)];

                    for (const match of matches) {
                        try {
                            const imgUrl = Core.absoluteUrl(match[1]);
                            const response = await fetch(imgUrl);
                            const blob = await response.blob();
                            const base64 = await new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result);
                                reader.readAsDataURL(blob);
                            });
                            content = content.replace(match[1], base64);
                        } catch (e) {
                            console.warn('图片转换失败:', match[1], e);
                        }
                    }
                }

                postsHtml += `
                    <div class="post" id="post-${post.post_number}">
                        <div class="post-header">
                            <div class="post-author">
                                <strong>${userName}</strong>
                                <span class="username">@${username}</span>
                            </div>
                            <div class="post-meta">
                                <span class="post-number">#${post.post_number}</span>
                                <span class="post-time">${postTime}</span>
                            </div>
                        </div>
                        <div class="post-content">${content}</div>
                    </div>
                `;
            }

            const themeColors = theme === 'dark' ? {
                bg: '#1a1a1a', card: '#2d2d2d', text: '#e0e0e0', textSec: '#b0b0b0', border: '#404040', primary: '#E3A043'
            } : {
                bg: '#f5f5f5', card: '#ffffff', text: '#333333', textSec: '#666666', border: '#e0e0e0', primary: '#E3A043'
            };

            const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Linux.do</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: ${themeColors.bg}; color: ${themeColors.text}; line-height: 1.6; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { background: ${themeColors.card}; padding: 30px; border-radius: 8px; margin-bottom: 20px; border: 1px solid ${themeColors.border}; }
        .header h1 { font-size: 28px; margin-bottom: 15px; color: ${themeColors.text}; }
        .header-meta { color: ${themeColors.textSec}; font-size: 14px; }
        .post { background: ${themeColors.card}; padding: 20px; border-radius: 8px; margin-bottom: 15px; border: 1px solid ${themeColors.border}; }
        .post-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid ${themeColors.border}; }
        .post-author strong { color: ${themeColors.text}; font-size: 16px; }
        .username { color: ${themeColors.textSec}; font-size: 14px; margin-left: 8px; }
        .post-meta { color: ${themeColors.textSec}; font-size: 13px; }
        .post-number { color: ${themeColors.primary}; font-weight: 600; margin-right: 10px; }
        .post-content { color: ${themeColors.text}; }
        .post-content img { max-width: 100%; height: auto; border-radius: 4px; margin: 10px 0; }
        .post-content pre { background: ${theme === 'dark' ? '#1e1e1e' : '#f5f5f5'}; padding: 15px; border-radius: 4px; overflow-x: auto; }
        .post-content code { font-family: 'Courier New', monospace; }
        .post-content blockquote { border-left: 3px solid ${themeColors.primary}; padding-left: 15px; margin: 10px 0; color: ${themeColors.textSec}; }
        .footer { text-align: center; color: ${themeColors.textSec}; margin-top: 30px; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${title}</h1>
            <div class="header-meta">
                作者: ${author} | 创建时间: ${createTime} | 共 ${posts.length} 条回复
            </div>
        </div>
        ${postsHtml}
        <div class="footer">
            导出自 Linux.do | 导出时间: ${new Date().toLocaleString('zh-CN')}
        </div>
    </div>
</body>
</html>`;

            const filename = `${title.replace(/[<>:"/\\|?*]/g, '_')}_${posts[0].post_number}-${posts[posts.length-1].post_number}.html`;
            Core.downloadFile(html, filename, 'text/html');

            statusBox.innerHTML = `<div style="color:var(--success)">✅ HTML 文件已导出！<br><small>文件名: ${filename}</small></div>`;
            this.showToast('HTML 导出成功');
        },

        async exportAsAiText(topicData, posts, statusBox) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const includeHeader = Q('#export-ai-header').checked;
            const includeImages = Q('#export-ai-images').checked;
            const includeQuotes = Q('#export-ai-quotes').checked;

            statusBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在生成 AI 文本...</div>`;

            let text = '';

            if (includeHeader) {
                text += `标题: ${topicData.title}\n`;
                text += `作者: ${topicData.details?.created_by?.username || '未知'}\n`;
                text += `创建时间: ${new Date(topicData.created_at).toLocaleString('zh-CN')}\n`;
                text += `回复数: ${posts.length}\n`;
                text += `\n${'='.repeat(50)}\n\n`;
            }

            for (const post of posts) {
                const userName = post.name || post.username;
                const username = post.username;
                const postTime = new Date(post.created_at).toLocaleString('zh-CN');

                text += `[${post.post_number}楼] ${userName}（@${username}）\n`;
                text += `时间: ${postTime}\n\n`;

                const content = Core.cookedToAiText(post.cooked, { includeImages, includeQuotes });
                text += content + '\n\n';
                text += '-'.repeat(50) + '\n\n';
            }

            const filename = `${topicData.title.replace(/[<>:"/\\|?*]/g, '_')}_${posts[0].post_number}-${posts[posts.length-1].post_number}.txt`;
            Core.downloadFile(text, filename, 'text/plain');

            statusBox.innerHTML = `<div style="color:var(--success)">✅ AI 文本已导出！<br><small>文件名: ${filename}</small></div>`;
            this.showToast('AI 文本导出成功');
        },

        // 话题功能
        initTopicsPage() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const topics = Core.getTopicsFromPage();
            const endInput = Q('#topics-end');
            if (topics.length > 0 && !endInput.value) {
                endInput.value = topics.length;
            }
        },

        setTopicsRange(value) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const source = Q('#topics-source').value;

            let topics;
            if (source === 'current') {
                topics = Core.getTopicsFromPage();
            } else if (this._remoteTopicsData) {
                topics = this._remoteTopicsData;
            } else {
                topics = [];
            }
            const total = topics.length;

            if (value === 'all') {
                Q('#topics-start').value = 1;
                Q('#topics-end').value = total || '';
            } else {
                Q('#topics-start').value = 1;
                Q('#topics-end').value = Math.min(value, total) || value;
            }
        },

        async doTopicsSummary() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const source = Q('#topics-source').value;
            const mode = Q('#topics-mode').value;

            let topics;
            let sourceName;

            if (source === 'current') {
                const start = parseInt(Q('#topics-start').value) || 1;
                const end = parseInt(Q('#topics-end').value);

                const allTopics = Core.getTopicsFromPage();
                if (allTopics.length === 0) {
                    return this.showToast('当前页面没有找到话题列表，请在首页或分类页使用', 'error');
                }

                if (!end || start > end) {
                    return this.showToast('话题范围无效', 'error');
                }

                topics = allTopics.slice(start - 1, end);
                sourceName = '当前页面';
            } else {
                if (!this._remoteTopicsData || this._remoteTopicsData.length === 0) {
                    return this.showToast('请先点击「获取话题」按钮获取话题列表', 'error');
                }
                topics = this._remoteTopicsData;
                const sourceNames = { top: '最热话题', new: '最新话题', latest: '最近活跃', category: '分类话题' };
                sourceName = sourceNames[source] || '远程话题';
            }

            this.setLoading('#btn-topics-summary', true);
            const resultBox = Q('#topics-result');
            resultBox.classList.remove('empty');

            try {
                let topicsText;

                if (mode === 'list') {
                    resultBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在分析 ${topics.length} 个话题标题...</div>`;
                    topicsText = Core.formatTopicsToText(topics, sourceName);
                } else {
                    resultBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在获取话题内容 (0/${topics.length})...</div>`;

                    const topicsWithContent = await Core.fetchTopicsContent(topics, (current, total, title, failed) => {
                        const failedText = failed > 0 ? `<span style="color:var(--danger);margin-left:8px;">失败: ${failed}</span>` : '';
                        resultBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>正在获取话题内容 (${current}/${total})...${failedText}<br><small style="color:var(--text-muted);width:100%">${title.slice(0, 30)}...</small></div>`;
                    });

                    const failedCount = topicsWithContent._failedCount || 0;
                    if (failedCount > 0) {
                        this.showToast(`${failedCount} 个话题获取失败，将使用 ${topicsWithContent.length} 个成功获取的话题`, 'error');
                    }

                    topicsText = Core.formatTopicsDetailToText(topicsWithContent);
                }

                resultBox.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>AI 正在分析中...</div>`;

                const defaultTopicsPrompt = `你是一个论坛话题分析助手。请分析以下话题列表，总结出：
1. 当前热门讨论主题和趋势
2. 值得关注的精华内容
3. 不同分类的话题分布
4. 简要推荐哪些话题值得阅读

使用 Markdown 格式输出，条理清晰。`;
                const systemPrompt = GM_getValue('prompt_topics', defaultTopicsPrompt);

                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `以下是论坛话题列表:\n\n${topicsText}` }
                ];

                let aiText = '';
                await Core.streamChat(messages,
                    (chunk) => {
                        aiText += chunk;
                        this.updateResultBox(resultBox, aiText, true);
                    },
                    () => {
                        this.setLoading('#btn-topics-summary', false);
                        this.updateResultBox(resultBox, aiText, false);
                        this.postContent = topicsText;
                        this.lastSummary = aiText;
                        this.chatHistory = [
                            { role: 'system', content: GM_getValue('prompt_topics_chat', '你是一个论坛话题分析助手。基于上文中的话题列表内容，回答用户的问题。回答要准确、简洁，必要时引用原文。') },
                            { role: 'user', content: `以下是论坛话题列表供你参考:\n${topicsText}` },
                            { role: 'assistant', content: aiText }
                        ];
                        Q('#chat-list').innerHTML = '';
                        this.userMessageCount = 0;
                        this.updateMessageCount();
                        Q('#chat-empty').classList.remove('hidden');
                        Q('#chat-empty').innerHTML = '<span class="tip-icon">✅</span>话题总结已完成！<br>现在可以基于话题内容进行对话';
                        this.showToast('话题总结完成');
                    },
                    (err) => {
                        resultBox.innerHTML = `<div style="color:var(--danger)">❌ 错误: ${err}</div>`;
                        this.setLoading('#btn-topics-summary', false);
                        this.showToast('总结失败: ' + err, 'error');
                    }
                );
            } catch (e) {
                resultBox.innerHTML = `<div style="color:var(--danger)">❌ 错误: ${e.message}</div>`;
                this.setLoading('#btn-topics-summary', false);
            }
        },

        onTopicsSourceChange(source) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const isRemote = source !== 'current';
            const isCategory = source === 'category';

            Q('#category-selector-group').style.display = isCategory ? 'block' : 'none';
            Q('#topics-range-group').style.display = isRemote ? 'none' : 'block';
            Q('#remote-topics-count-group').style.display = isRemote ? 'block' : 'none';
            Q('#btn-fetch-topics').style.display = isRemote ? 'flex' : 'none';

            this._remoteTopicsData = null;

            if (isCategory) {
                this.loadCategoriesDropdown();
            }

            const tipText = Q('#topics-result .tip-text');
            if (tipText) {
                if (source === 'current') {
                    tipText.innerHTML = `
                        <span class="tip-icon">📋</span>
                        在论坛首页或分类页使用此功能，<br>可以总结当前页面显示的话题列表<br><br>
                        💡 「快速模式」仅使用标题，「详细模式」会获取主帖内容
                    `;
                } else {
                    const sourceNames = { top: '最热话题', new: '最新话题', latest: '最近活跃', category: '指定分类' };
                    tipText.innerHTML = `
                        <span class="tip-icon">📥</span>
                        点击「获取话题」从论坛获取${sourceNames[source] || '话题'}<br><br>
                        💡 获取后可选择「快速」或「详细」模式进行总结
                    `;
                }
            }
        },

        async loadCategoriesDropdown() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const select = Q('#topics-category');

            try {
                select.innerHTML = '<option value="">加载中...</option>';
                const categories = await Core.fetchCategories();

                select.innerHTML = categories.map(cat =>
                    `<option value="${cat.id}" data-slug="${cat.slug}">${cat.name}</option>`
                ).join('');
            } catch (err) {
                select.innerHTML = '<option value="">加载失败，请重试</option>';
                this.showToast('加载分类列表失败: ' + err.message, 'error');
            }
        },

        async doFetchRemoteTopics() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const source = Q('#topics-source').value;
            const count = parseInt(Q('#remote-topics-count').value) || 20;

            if (source === 'current') return;

            if (source === 'category') {
                const categorySelect = Q('#topics-category');
                const categoryId = categorySelect.value;
                if (!categoryId) {
                    return this.showToast('请选择一个分类', 'error');
                }
            }

            this.setLoading('#btn-fetch-topics', true);
            const resultBox = Q('#topics-result');

            try {
                let options = { limit: count };

                if (source === 'category') {
                    const categorySelect = Q('#topics-category');
                    const selectedOption = categorySelect.options[categorySelect.selectedIndex];
                    options.categoryId = categorySelect.value;
                    options.categorySlug = selectedOption.dataset.slug;
                }

                const topics = await Core.fetchRemoteTopics(source, options);
                this._remoteTopicsData = topics;

                const sourceNames = { top: '最热话题', new: '最新话题', latest: '最近活跃', category: '分类话题' };
                resultBox.classList.remove('empty');
                resultBox.innerHTML = `
                    <div class="fetch-result-preview">
                        <div class="fetch-result-header">
                            ✅ 已获取 <strong>${topics.length}</strong> 条${sourceNames[source]}
                        </div>
                        <div class="fetch-result-list">
                            ${topics.slice(0, 5).map((t, i) => `
                                <div class="fetch-result-item">
                                    <span class="item-index">${i + 1}.</span>
                                    <span class="item-title">${t.title}</span>
                                </div>
                            `).join('')}
                            ${topics.length > 5 ? `<div class="fetch-result-more">... 还有 ${topics.length - 5} 条</div>` : ''}
                        </div>
                        <div class="fetch-result-tip">
                            ✨ 点击上方按钮开始AI总结
                        </div>
                    </div>
                `;

                this.showToast(`成功获取 ${topics.length} 条话题`);
            } catch (err) {
                this.showToast('获取话题失败: ' + err.message, 'error');
            } finally {
                this.setLoading('#btn-fetch-topics', false);
            }
        },

        // 弹窗查看总结内容
        showSummaryModal(text) {
            const { thinking, content } = Core.parseThinkingContent(text);
            const contentHtml = DOMPurify.sanitize(marked.parse(content));

            // 创建弹窗
            const overlay = document.createElement('div');
            overlay.className = 'summary-modal-overlay';
            overlay.innerHTML = `
                <div class="summary-modal">
                    <div class="summary-modal-header">
                        <div class="summary-modal-title">📝 总结内容</div>
                        <button class="summary-modal-close">${this.ICONS.close}</button>
                    </div>
                    <div class="summary-modal-body">${contentHtml}</div>
                </div>
            `;

            // 关闭弹窗
            const closeModal = () => overlay.remove();
            overlay.querySelector('.summary-modal-close').onclick = closeModal;
            overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

            // ESC关闭
            const escHandler = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
            document.addEventListener('keydown', escHandler);

            this.uiManager.shadow.appendChild(overlay);
        },

        // API历史配置功能
        renderApiHistory() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const historyList = Q('#api-history-list');
            const emptyTip = Q('#api-history-empty');
            const history = ApiHistory.getAll();

            if (history.length === 0) {
                historyList.innerHTML = '';
                emptyTip.style.display = 'block';
                return;
            }

            emptyTip.style.display = 'none';

            const currentUrl = Q('#cfg-url').value;
            const currentKey = Q('#cfg-key').value;
            const currentModel = Q('#cfg-model').value;

            historyList.innerHTML = history.map(item => {
                const isActive = item.url === currentUrl && item.key === currentKey && item.model === currentModel;
                // 从URL中提取hostname作为标题
                let hostname = item.url;
                try {
                    hostname = new URL(item.url).hostname;
                } catch (e) {}
                return `
                    <div class="api-history-item${isActive ? ' active' : ''}" data-id="${item.id}">
                        <div class="api-history-info">
                            <div class="api-history-name">${hostname}</div>
                            <div class="api-history-meta">${item.model} · ${item.maskedKey} · ${item.timestamp}</div>
                        </div>
                        <div class="api-history-actions">
                            <button class="api-history-btn load-btn" data-id="${item.id}">加载</button>
                            <button class="api-history-btn delete" data-id="${item.id}">删除</button>
                        </div>
                    </div>
                `;
            }).join('');

            // 绑定事件
            historyList.querySelectorAll('.load-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.loadApiConfig(parseInt(btn.dataset.id));
                });
            });

            historyList.querySelectorAll('.delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteApiConfig(parseInt(btn.dataset.id));
                });
            });

            // 点击整个item也加载配置
            historyList.querySelectorAll('.api-history-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.loadApiConfig(parseInt(item.dataset.id));
                });
            });
        },

        loadApiConfig(id) {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const config = ApiHistory.get(id);
            if (!config) {
                this.showToast('配置不存在', 'error');
                return;
            }

            // 更新UI表单
            Q('#cfg-url').value = config.url;
            Q('#cfg-key').value = config.key;
            Q('#cfg-model').value = config.model;

            // 同时保存到GM存储，确保实际调用时使用新配置
            GM_setValue('apiUrl', config.url);
            GM_setValue('apiKey', config.key);
            GM_setValue('model', config.model);

            // 记录上次使用的配置ID
            ApiHistory.setLastUsedId(id);

            this.renderApiHistory();
            this.showToast('已加载配置: ' + config.model);
        },

        deleteApiConfig(id) {
            const config = ApiHistory.get(id);
            if (!config) return;

            if (confirm(`确定要删除配置 "${config.name}" 吗？`)) {
                ApiHistory.delete(id);
                this.renderApiHistory();
                this.showToast('已删除配置');
            }
        },

        saveSettings() {
            const Q = this.uiManager.Q.bind(this.uiManager);
            const url = Q('#cfg-url').value.trim();
            const key = Q('#cfg-key').value.trim();
            const model = Q('#cfg-model').value.trim();

            GM_setValue('apiUrl', url);
            GM_setValue('apiKey', key);
            GM_setValue('model', model);
            GM_setValue('prompt_sum', Q('#cfg-prompt-sum').value);
            GM_setValue('prompt_chat', Q('#cfg-prompt-chat').value);
            GM_setValue('prompt_topics', Q('#cfg-prompt-topics').value);
            GM_setValue('prompt_topics_chat', Q('#cfg-prompt-topics-chat').value);
            const recentFloors = parseInt(Q('#cfg-recent-floors').value) || 50;
            GM_setValue('recentFloors', recentFloors);
            Q('#recent-count').textContent = recentFloors;
            Q('#export-recent-count').textContent = recentFloors;
            GM_setValue('topicsConcurrency', parseInt(Q('#cfg-topics-concurrency').value) || 4);
            GM_setValue('useStream', Q('#cfg-stream').checked);
            GM_setValue('autoScroll', Q('#cfg-autoscroll').checked);

            // 保存到API历史，并记录为上次使用的配置
            if (url && key) {
                const savedId = ApiHistory.save(url, key, model);
                if (savedId) {
                    ApiHistory.setLastUsedId(savedId);
                }
                this.renderApiHistory();
            }

            this.showToast('设置已保存');
        }
    });


    // =================================================================================
    // 3.5 话题列表快速总结模块 (QUICK SUMMARY)
    //     在话题列表页面为每个帖子添加一键总结按钮
    // =================================================================================
    const QuickSummary = {
        _observer: null,
        _styleInjected: false,

        _isDark() {
            if (document.querySelector('meta[name="darkreader"]') || document.querySelector('.darkreader')) return true;
            if (window.matchMedia('(prefers-color-scheme:dark)').matches) return true;
            const bg = getComputedStyle(document.querySelector('.d-header') || document.body).backgroundColor;
            const m = bg.match(/\d+/g);
            if (m) { const [r,g,b] = m.map(Number); return (r*299+g*587+b*114)/1000 < 128; }
            return false;
        },

        init() {
            this.injectStyles();
            this.addButtons();
            this._observer = new MutationObserver(() => this.addButtons());
            this._observer.observe(document.body, { childList: true, subtree: true });
        },

        injectStyles() {
            if (this._styleInjected) return;
            this._styleInjected = true;
            const css = document.createElement('style');
            css.textContent = `
                .ld-qs-btn{position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:4px 10px;font-size:12px;background:#e3a043;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;z-index:10;}
                .ld-qs-btn.ld-qs-cached{background:#5b9a5b;}
                .ld-qs-btn:hover,.ld-qs-btn:active{background:#d4912e;}
                .ld-qs-btn.ld-qs-cached:hover,.ld-qs-btn.ld-qs-cached:active{background:#4a8a4a;}
                .ld-qs-history-float{position:fixed;bottom:20px;right:20px;padding:8px 14px;font-size:13px;background:#e3a043;color:#fff;border:none;border-radius:8px;cursor:pointer;z-index:100000;box-shadow:0 2px 10px rgba(0,0,0,.3);}
                .ld-qs-history-float:hover,.ld-qs-history-float:active{background:#d4912e;}
                .ld-qs-regen{background:none;border:1px solid #e3a043;color:#e3a043;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;}
                .ld-qs-regen:hover,.ld-qs-regen:active{background:#e3a043;color:#fff;}
                .ld-qs-hist-item{display:flex;align-items:center;justify-content:space-between;padding:10px;margin-bottom:6px;border:1px solid #eee;border-radius:8px;cursor:pointer;transition:background .15s;}
                .ld-qs-hist-item:hover,.ld-qs-hist-item:active{background:rgba(227,160,67,.08);}
                .ld-qs-hist-info{flex:1;min-width:0;margin-right:8px;}
                .ld-qs-hist-title{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
                .ld-qs-hist-meta{font-size:11px;color:#888;margin-top:2px;}
                .ld-qs-hist-actions{display:flex;gap:6px;}
                .ld-qs-hist-view,.ld-qs-hist-del{padding:4px 10px;font-size:11px;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:none;color:#666;}
                .ld-qs-hist-view:hover,.ld-qs-hist-view:active{border-color:#e3a043;color:#e3a043;}
                .ld-qs-hist-del:hover,.ld-qs-hist-del:active{border-color:#e74c3c;color:#e74c3c;}
                .ld-qs-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;animation:ldqsFadeIn .2s ease;}
                @keyframes ldqsFadeIn{from{opacity:0}to{opacity:1}}
                @keyframes ldqsSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
                .ld-qs-modal{background:#fff;border-radius:12px;width:92vw;max-width:720px;max-height:80vh;display:flex;flex-direction:column;animation:ldqsSlideUp .25s ease;box-shadow:0 8px 32px rgba(0,0,0,.2);}
                .ld-qs-header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #eee;gap:8px;}
                .ld-qs-title{font-size:15px;font-weight:600;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}
                .ld-qs-close{background:none;border:none;font-size:22px;cursor:pointer;color:#999;padding:4px 8px;flex-shrink:0;}
                .ld-qs-close:hover,.ld-qs-close:active{color:#333;}
                .ld-qs-body{flex:1;overflow-y:auto;padding:18px;font-size:14px;line-height:1.75;color:#333;-webkit-overflow-scrolling:touch;}
                .ld-qs-body h1,.ld-qs-body h2,.ld-qs-body h3{margin:14px 0 6px;font-weight:600;}
                .ld-qs-body p{margin-bottom:8px;}
                .ld-qs-body ul,.ld-qs-body ol{padding-left:18px;margin:8px 0;}
                .ld-qs-body li{margin-bottom:4px;}
                .ld-qs-body code{background:#f5f5f5;padding:1px 5px;border-radius:3px;font-family:monospace;word-break:break-all;}
                .ld-qs-body pre{background:#f5f5f5;padding:10px;border-radius:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;}
                .ld-qs-body blockquote{margin:12px 0;padding:12px 14px;border-left:4px solid #e3a043;border-radius:0 10px 10px 0;background:rgba(227,160,67,.08);color:#4b5563;box-shadow:inset 0 0 0 1px rgba(227,160,67,.12);}
                .ld-qs-body blockquote p:last-child{margin-bottom:0;}
                .ld-qs-loading{display:flex;align-items:center;gap:8px;color:#888;}
                .ld-qs-dot{width:6px;height:6px;border-radius:50%;background:#e3a043;animation:ldqsBounce .6s infinite alternate;}
                .ld-qs-dot:nth-child(2){animation-delay:.2s;}.ld-qs-dot:nth-child(3){animation-delay:.4s;}
                @keyframes ldqsBounce{from{opacity:.3;transform:translateY(0)}to{opacity:1;transform:translateY(-4px)}}
                .ld-qs-footer{display:none;padding:10px 14px;border-top:1px solid #eee;flex-shrink:0;}
                .ld-qs-footer.active{display:flex;gap:8px;align-items:flex-end;}
                .ld-qs-input{flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 12px;font-size:14px;resize:none;outline:none;max-height:80px;font-family:inherit;background:transparent;color:inherit;}
                .ld-qs-input:focus{border-color:#e3a043;}
                .ld-qs-send{background:#e3a043;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;white-space:nowrap;flex-shrink:0;}
                .ld-qs-send:hover,.ld-qs-send:active{background:#d4912e;}
                .ld-qs-send:disabled{opacity:.5;cursor:not-allowed;}
                .ld-qs-msg{margin-bottom:14px;padding:10px 14px;border-radius:10px;}
                .ld-qs-msg-user{background:rgba(227,160,67,.1);border:1px solid rgba(227,160,67,.2);margin-left:20%;}
                .ld-qs-msg-ai{background:rgba(100,100,100,.05);border:1px solid rgba(100,100,100,.1);}
                .ld-qs-msg-label{font-size:11px;font-weight:600;color:#e3a043;margin-bottom:4px;}
                .ld-qs-msg-ai .ld-qs-msg-label{color:#888;}
                @media(max-width:768px){
                    .ld-qs-btn{position:static;transform:none;display:inline-block;margin:4px 0 4px 6px;padding:6px 14px;font-size:13px;vertical-align:middle;border-radius:6px;-webkit-tap-highlight-color:transparent;}
                    .ld-qs-btn:active{transform:scale(.95);opacity:.85;}
                    .ld-qs-modal{width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0;}
                    .ld-qs-header{padding:env(safe-area-inset-top,12px) 14px 12px;position:sticky;top:0;background:inherit;z-index:2;}
                    .ld-qs-title{font-size:14px;}
                    .ld-qs-close{font-size:26px;padding:8px 12px;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;}
                    .ld-qs-regen{padding:8px 14px;font-size:13px;min-height:44px;}
                    .ld-qs-body{padding:14px;font-size:15px;line-height:1.8;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
                    .ld-qs-body pre{font-size:12px;padding:10px;max-width:calc(100vw - 28px);white-space:pre-wrap;word-break:break-all;}
                    .ld-qs-body code{font-size:13px;word-break:break-all;}
                    .ld-qs-body blockquote{padding:10px 12px;margin:10px 0;}
                    .ld-qs-body img{max-width:100%;height:auto;}
                    .ld-qs-body table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;}
                    .ld-qs-footer{padding:10px 14px env(safe-area-inset-bottom,10px);position:sticky;bottom:0;background:inherit;z-index:2;}
                    .ld-qs-input{font-size:16px;padding:10px 14px;min-height:44px;border-radius:10px;}
                    .ld-qs-send{padding:10px 18px;font-size:14px;min-height:44px;border-radius:10px;-webkit-tap-highlight-color:transparent;}
                    .ld-qs-send:active{transform:scale(.95);}
                    .ld-qs-msg{padding:10px 12px;font-size:14px;line-height:1.7;}
                    .ld-qs-msg-user{margin-left:10%;}
                    .ld-qs-msg-label{font-size:12px;}
                    .ld-qs-history-float{bottom:env(safe-area-inset-bottom,20px);right:14px;padding:12px 18px;font-size:14px;border-radius:24px;min-height:48px;-webkit-tap-highlight-color:transparent;}
                    .ld-qs-history-float:active{transform:scale(.95);}
                    .ld-qs-hist-item{padding:14px;flex-wrap:wrap;-webkit-tap-highlight-color:transparent;}
                    .ld-qs-hist-item:active{background:rgba(227,160,67,.12);}
                    .ld-qs-hist-info{width:100%;margin-right:0;margin-bottom:8px;}
                    .ld-qs-hist-title{white-space:normal;font-size:14px;line-height:1.5;}
                    .ld-qs-hist-meta{font-size:12px;}
                    .ld-qs-hist-actions{width:100%;justify-content:flex-end;}
                    .ld-qs-hist-view,.ld-qs-hist-del{padding:8px 18px;font-size:13px;min-height:40px;border-radius:6px;-webkit-tap-highlight-color:transparent;}
                }
                .ld-qs-dark .ld-qs-modal{background:#282a36;box-shadow:0 8px 32px rgba(0,0,0,.5);}
                .ld-qs-dark .ld-qs-header{border-color:rgba(255,255,255,.08);}
                .ld-qs-dark .ld-qs-title{color:#f8f8f2;}
                .ld-qs-dark .ld-qs-close{color:#6272a4;}.ld-qs-dark .ld-qs-close:hover,.ld-qs-dark .ld-qs-close:active{color:#f8f8f2;}
                .ld-qs-dark .ld-qs-body{color:#f8f8f2;}
                .ld-qs-dark .ld-qs-body blockquote{background:linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.08));border-left-color:#ffb454;color:#e8edf7;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}
                .ld-qs-dark .ld-qs-body code{background:rgba(255,255,255,.08);color:#f1fa8c;}
                .ld-qs-dark .ld-qs-body pre{background:#1e1f29;border:1px solid rgba(255,255,255,.06);}
                .ld-qs-dark .ld-qs-body a{color:#8be9fd;}
                .ld-qs-dark .ld-qs-body h1,.ld-qs-dark .ld-qs-body h2,.ld-qs-dark .ld-qs-body h3{color:#bd93f9;}
                .ld-qs-dark .ld-qs-body strong{color:#ffb86c;}
                .ld-qs-dark .ld-qs-footer{border-color:rgba(255,255,255,.08);}
                .ld-qs-dark .ld-qs-input{background:#1e1f29;border-color:rgba(255,255,255,.1);color:#f8f8f2;}
                .ld-qs-dark .ld-qs-input::placeholder{color:#6272a4;}
                .ld-qs-dark .ld-qs-msg-user{background:rgba(227,160,67,.12);border-color:rgba(227,160,67,.25);}
                .ld-qs-dark .ld-qs-msg-ai{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08);}
                .ld-qs-dark .ld-qs-msg-ai .ld-qs-msg-label{color:#6272a4;}
                .ld-qs-dark .ld-qs-hist-item{background:#2f3144;border-color:rgba(255,255,255,.06);}
                .ld-qs-dark .ld-qs-hist-title{color:#f8f8f2;}
                .ld-qs-dark .ld-qs-hist-meta{color:#6272a4;}
                .ld-qs-dark .ld-qs-hist-view,.ld-qs-dark .ld-qs-hist-del{background:#383a4e;border-color:rgba(255,255,255,.1);color:#ccc;}
                .ld-qs-dark .ld-qs-hist-view:hover,.ld-qs-dark .ld-qs-hist-view:active{border-color:#e3a043;color:#e3a043;}
                .ld-qs-dark .ld-qs-hist-del:hover,.ld-qs-dark .ld-qs-hist-del:active{border-color:#ff5555;color:#ff5555;}
                .ld-qs-dark .ld-qs-regen{color:#6272a4;}.ld-qs-dark .ld-qs-regen:hover{color:#f8f8f2;}
                .ld-qs-dark .ld-qs-loading span{color:#6272a4;}
            `;
            document.head.appendChild(css);
        },

        addButtons() {
            if (!/^\/(latest|top|new|unread|categories|c\/|$)/.test(location.pathname) && location.pathname !== '/') return;
            document.querySelectorAll('tr.topic-list-item, .topic-list-item').forEach(row => {
                if (row.querySelector('.ld-qs-btn')) return;
                const link = row.querySelector('a.title.raw-link, a.raw-topic-link');
                if (!link) return;
                const href = link.getAttribute('href') || '';
                const tid = href.match(/\/t\/[^/]+\/(\d+)/)?.[1];
                if (!tid) return;
                const title = link.textContent.trim();
                const mainCell = row.querySelector('td.main-link, .main-link') || row;
                mainCell.style.position = 'relative';
                const cached = SummaryCache.get(tid);
                const btn = document.createElement('button');
                btn.className = 'ld-qs-btn' + (cached ? ' ld-qs-cached' : '');
                btn.textContent = cached ? '📄回看' : '✨总结';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showModal(tid, title);
                });
                mainCell.appendChild(btn);
            });
            this._addHistoryBtn();
        },

        _addHistoryBtn() {
            if (document.querySelector('.ld-qs-history-float')) return;
            const btn = document.createElement('button');
            btn.className = 'ld-qs-history-float';
            btn.textContent = '📋 总结历史';
            btn.onclick = () => this.showHistoryPanel();
            document.body.appendChild(btn);
        },

        showHistoryPanel() {
            const list = SummaryCache.getAll();
            const overlay = document.createElement('div');
            overlay.className = 'ld-qs-overlay' + (this._isDark() ? ' ld-qs-dark' : '');
            const items = list.length ? list.map(i => `
                <div class="ld-qs-hist-item" data-tid="${i.tid}">
                    <div class="ld-qs-hist-info">
                        <div class="ld-qs-hist-title">${i.title}</div>
                        <div class="ld-qs-hist-meta">${i.time}</div>
                    </div>
                    <div class="ld-qs-hist-actions">
                        <button class="ld-qs-hist-view" data-tid="${i.tid}">查看</button>
                        <button class="ld-qs-hist-del" data-tid="${i.tid}">删除</button>
                    </div>
                </div>`).join('') : '<div style="padding:30px;text-align:center;color:#888;">暂无总结历史</div>';
            overlay.innerHTML = `
                <div class="ld-qs-modal">
                    <div class="ld-qs-header">
                        <div class="ld-qs-title">总结历史（最近${CONFIG.maxSummaryCache}条）</div>
                        <button class="ld-qs-close">&times;</button>
                    </div>
                    <div class="ld-qs-body" style="padding:12px;">${items}</div>
                </div>`;
            document.body.appendChild(overlay);
            const close = () => overlay.remove();
            overlay.querySelector('.ld-qs-close').onclick = close;
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            overlay.querySelectorAll('.ld-qs-hist-view').forEach(b => {
                b.onclick = (e) => {
                    e.stopPropagation();
                    const c = SummaryCache.get(b.dataset.tid);
                    if (c) { close(); this.showCachedModal(c); }
                };
            });
            overlay.querySelectorAll('.ld-qs-hist-del').forEach(b => {
                b.onclick = (e) => {
                    e.stopPropagation();
                    SummaryCache.delete(b.dataset.tid);
                    b.closest('.ld-qs-hist-item').remove();
                    this.refreshButtons();
                };
            });
            overlay.querySelectorAll('.ld-qs-hist-item').forEach(item => {
                item.onclick = () => {
                    const c = SummaryCache.get(item.dataset.tid);
                    if (c) { close(); this.showCachedModal(c); }
                };
            });
        },

        showCachedModal(cached) {
            const overlay = document.createElement('div');
            overlay.className = 'ld-qs-overlay' + (this._isDark() ? ' ld-qs-dark' : '');
            const parsed = Core.parseThinkingContent(cached.content);
            let html = '';
            if (parsed.thinking) {
                html += '<details style="margin-bottom:10px;"><summary style="cursor:pointer;color:#e3a043;font-weight:500;">💭 思考过程</summary><div style="padding:8px 12px;color:#888;font-size:13px;border-left:2px solid #e3a043;margin-top:4px;">' + DOMPurify.sanitize(marked.parse(parsed.thinking)) + '</div></details>';
            }
            html += DOMPurify.sanitize(marked.parse(parsed.content || ''));
            overlay.innerHTML = `
                <div class="ld-qs-modal">
                    <div class="ld-qs-header">
                        <div class="ld-qs-title">${cached.title}</div>
                        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                            <button class="ld-qs-regen">🔄</button>
                            <button class="ld-qs-close">&times;</button>
                        </div>
                    </div>
                    <div class="ld-qs-body">${html}</div>
                    <div class="ld-qs-footer active">
                        <textarea class="ld-qs-input" rows="1" placeholder="追问..."></textarea>
                        <button class="ld-qs-send">发送</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const close = () => overlay.remove();
            overlay.querySelector('.ld-qs-close').onclick = close;
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            const escH = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); } };
            document.addEventListener('keydown', escH);
            overlay.querySelector('.ld-qs-regen').onclick = () => {
                close();
                this.showModal(cached.tid, cached.title, true);
            };
            const chatPrompt = GM_getValue('prompt_chat', '你是一个帖子阅读助手。基于上文中的帖子内容，回答用户的问题。回答要准确、简洁，必要时引用原文。');
            const messages = [
                { role: 'system', content: chatPrompt },
                { role: 'assistant', content: parsed.content || cached.content }
            ];
            this._bindChat(overlay, messages);
        },

        _bindChat(overlay, messages) {
            const body = overlay.querySelector('.ld-qs-body');
            const input = overlay.querySelector('.ld-qs-input');
            const sendBtn = overlay.querySelector('.ld-qs-send');
            const doSend = () => {
                const q = input.value.trim();
                if (!q || sendBtn.disabled) return;
                input.value = '';
                input.style.height = 'auto';
                sendBtn.disabled = true;
                messages.push({ role: 'user', content: q });
                body.innerHTML += `<div class="ld-qs-msg ld-qs-msg-user"><div class="ld-qs-msg-label">你</div>${DOMPurify.sanitize(marked.parse(q))}</div>`;
                body.innerHTML += `<div class="ld-qs-msg ld-qs-msg-ai" id="ld-qs-ai-reply"><div class="ld-qs-msg-label">AI</div><div class="ld-qs-loading"><div class="ld-qs-dot"></div><div class="ld-qs-dot"></div><div class="ld-qs-dot"></div></div></div>`;
                body.scrollTop = body.scrollHeight;
                let replyText = '';
                Core.streamChat(
                    messages,
                    (chunk) => {
                        replyText += chunk;
                        const p = Core.parseThinkingContent(replyText);
                        const el = body.querySelector('#ld-qs-ai-reply');
                        if (!el) return;
                        let h = '<div class="ld-qs-msg-label">AI</div>';
                        if (p.thinking) h += '<details style="margin-bottom:6px;"><summary style="cursor:pointer;color:#e3a043;font-size:12px;">💭 思考</summary><div style="color:#888;font-size:12px;">' + DOMPurify.sanitize(marked.parse(p.thinking)) + '</div></details>';
                        h += DOMPurify.sanitize(marked.parse(p.content || ''));
                        el.innerHTML = h;
                        body.scrollTop = body.scrollHeight;
                    },
                    () => {
                        const p = Core.parseThinkingContent(replyText);
                        const el = body.querySelector('#ld-qs-ai-reply');
                        if (el) {
                            let h = '<div class="ld-qs-msg-label">AI</div>';
                            if (p.thinking) h += '<details style="margin-bottom:6px;"><summary style="cursor:pointer;color:#e3a043;font-size:12px;">💭 思考</summary><div style="color:#888;font-size:12px;">' + DOMPurify.sanitize(marked.parse(p.thinking)) + '</div></details>';
                            h += DOMPurify.sanitize(marked.parse(p.content || ''));
                            el.innerHTML = h;
                            el.removeAttribute('id');
                        }
                        messages.push({ role: 'assistant', content: p.content || replyText });
                        sendBtn.disabled = false;
                        input.focus();
                        body.scrollTop = body.scrollHeight;
                    },
                    (err) => {
                        const el = body.querySelector('#ld-qs-ai-reply');
                        if (el) { el.innerHTML = `<div class="ld-qs-msg-label">AI</div><p style="color:#e74c3c;">错误: ${err}</p>`; el.removeAttribute('id'); }
                        sendBtn.disabled = false;
                    }
                );
            };
            sendBtn.onclick = doSend;
            input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } };
            input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 80) + 'px'; };
        },

        refreshButtons() {
            document.querySelectorAll('.ld-qs-btn').forEach(b => b.remove());
            this.addButtons();
        },

        async showModal(tid, title, forceRefresh) {
            if (!forceRefresh) {
                const cached = SummaryCache.get(tid);
                if (cached) { this.showCachedModal(cached); return; }
            }
            const overlay = document.createElement('div');
            overlay.className = 'ld-qs-overlay' + (this._isDark() ? ' ld-qs-dark' : '');
            overlay.innerHTML = `
                <div class="ld-qs-modal">
                    <div class="ld-qs-header">
                        <div class="ld-qs-title">${title}</div>
                        <button class="ld-qs-close">&times;</button>
                    </div>
                    <div class="ld-qs-body">
                        <div class="ld-qs-loading"><div class="ld-qs-dot"></div><div class="ld-qs-dot"></div><div class="ld-qs-dot"></div><span>正在获取帖子内容...</span></div>
                    </div>
                    <div class="ld-qs-footer">
                        <textarea class="ld-qs-input" rows="1" placeholder="追问..."></textarea>
                        <button class="ld-qs-send">发送</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const body = overlay.querySelector('.ld-qs-body');
            const footer = overlay.querySelector('.ld-qs-footer');
            const close = () => { overlay.remove(); };
            overlay.querySelector('.ld-qs-close').onclick = close;
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
            document.addEventListener('keydown', escHandler);

            try {
                const text = await Core.fetchDialogues(tid, 1, 50);
                if (!text) { body.innerHTML = '<p style="color:#e74c3c;">未获取到帖子内容</p>'; return; }
                body.querySelector('.ld-qs-loading span').textContent = 'AI 正在总结...';
                const prompt = GM_getValue('prompt_sum', '请总结以下论坛帖子内容。使用 Markdown 格式，条理清晰，重点突出主要观点、争议点和结论。');
                let fullText = '';
                Core.streamChat(
                    [{ role: 'system', content: prompt }, { role: 'user', content: text }],
                    (chunk) => {
                        fullText += chunk;
                        const parsed = Core.parseThinkingContent(fullText);
                        let html = '';
                        if (parsed.thinking) {
                            html += '<details style="margin-bottom:10px;"><summary style="cursor:pointer;color:#e3a043;font-weight:500;">💭 思考过程</summary><div style="padding:8px 12px;color:#888;font-size:13px;border-left:2px solid #e3a043;margin-top:4px;">' + DOMPurify.sanitize(marked.parse(parsed.thinking)) + '</div></details>';
                        }
                        if (parsed.content) {
                            html += DOMPurify.sanitize(marked.parse(parsed.content));
                        }
                        body.innerHTML = html || '<div class="ld-qs-loading"><div class="ld-qs-dot"></div><div class="ld-qs-dot"></div><div class="ld-qs-dot"></div><span>AI 正在思考...</span></div>';
                    },
                    () => {
                        const parsed = Core.parseThinkingContent(fullText);
                        let html = '';
                        if (parsed.thinking) {
                            html += '<details style="margin-bottom:10px;"><summary style="cursor:pointer;color:#e3a043;font-weight:500;">💭 思考过程</summary><div style="padding:8px 12px;color:#888;font-size:13px;border-left:2px solid #e3a043;margin-top:4px;">' + DOMPurify.sanitize(marked.parse(parsed.thinking)) + '</div></details>';
                        }
                        html += DOMPurify.sanitize(marked.parse(parsed.content || '总结完成'));
                        body.innerHTML = html;
                        SummaryCache.save(tid, title, fullText);
                        this.refreshButtons();
                        footer.classList.add('active');
                        const chatPrompt = GM_getValue('prompt_chat', '你是一个帖子阅读助手。基于上文中的帖子内容，回答用户的问题。回答要准确、简洁，必要时引用原文。');
                        const messages = [
                            { role: 'system', content: chatPrompt },
                            { role: 'user', content: text },
                            { role: 'assistant', content: parsed.content || fullText }
                        ];
                        this._bindChat(overlay, messages);
                    },
                    (err) => { body.innerHTML = `<p style="color:#e74c3c;">API 错误: ${err}</p>`; }
                );
            } catch(e) {
                body.innerHTML = `<p style="color:#e74c3c;">获取失败: ${e.message}</p>`;
            }
        }
    };

    // =================================================================================
    // 4. UI 管理器 (UI MANAGER)
    //    负责UI初始化和与核心逻辑的交互。
    // =================================================================================
    class UIManager {
        constructor() {
            this.currentUI = null;
            this.host = null;
            this.shadow = null;
            this.init();
        }

        init() {
            // 直接加载style2（沉浸式风格）
            this.loadUI();
        }

        loadUI() {
            if (this.currentUI && typeof this.currentUI.destroy === 'function') {
                this.currentUI.destroy();
            }
            if (this.host) {
                document.body.removeChild(this.host);
            }

            const uiObject = UIRegistry.get('style2');
            if (!uiObject) {
                console.error('UI Style "style2" not found.');
                return;
            }

            // 创建 Shadow DOM host
            this.host = document.createElement('div');
            this.host.id = 'ld-summary-pro';
            document.body.appendChild(this.host);
            this.shadow = this.host.attachShadow({ mode: 'open' });

            this.currentUI = uiObject;

            // 注入样式并初始化UI
            const styleEl = document.createElement('style');
            styleEl.textContent = this.currentUI.getStyles();
            this.shadow.appendChild(styleEl);

            // 将管理器实例传递给UI模块，以便UI可以调用管理器的公共方法
            this.currentUI.init(this);
        }

        // 公共方法，供UI模块调用
        Q(selector) {
            return this.shadow.querySelector(selector);
        }
    }


    // =================================================================================
    // 5. 主执行入口 (MAIN ENTRY POINT)
    // =================================================================================
    window.addEventListener('load', () => {
        new UIManager();
        QuickSummary.init();
    });

})();
