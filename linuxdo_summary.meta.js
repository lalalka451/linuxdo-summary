// ==UserScript==
// @name         Linux.do 智能总结
// @namespace    http://tampermonkey.net/
// @version      7.9.10
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
// @downloadURL https://monkey.12121232.xyz/scripts/linuxdo_summary.user.js
// @updateURL   https://monkey.12121232.xyz/scripts/linuxdo_summary.meta.js
// ==/UserScript==
