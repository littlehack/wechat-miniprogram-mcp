/**
 * 浏览器自动打开模块
 * 在 MCP 服务器启动时自动打开 Chrome DevTools 调试链接
 * 参考 chrome-devtools-mcp 的实现方式，使用 puppeteer 启动 Chrome
 */
import puppeteer from 'puppeteer-core';
import { infoLogger, errorLogger } from './logger.js';
/** 记录已打开的 CDP 端口，避免重复打开 */
const openedPorts = new Set();
/** 保存浏览器实例引用，用于复用 */
let browserInstance = null;
/**
 * 检查指定端口是否已经有 Chrome DevTools 连接
 * @param cdpPort CDP 端口号
 * @returns 是否已有连接
 */
function hasExistingConnection(cdpPort) {
    // 检查是否已经为这个端口打开过
    if (openedPorts.has(cdpPort)) {
        return true;
    }
    // 检查端口是否被占用（可能用户手动打开了 DevTools）
    try {
        const { execSync } = require('child_process');
        const result = execSync(`netstat -ano | findstr ":${cdpPort}"`, { encoding: 'utf8' });
        // 如果端口有 LISTENING 状态，说明有服务在运行
        // 但 Chrome DevTools 是作为客户端连接的，所以这个检查主要是检测端口是否被占用
        if (result.includes('LISTENING')) {
            infoLogger(`[浏览器] 端口 ${cdpPort} 已被占用，可能已有 DevTools 连接`);
            return true;
        }
    }
    catch (e) {
        // netstat 命令失败，继续尝试打开
    }
    return false;
}
/**
 * 使用 puppeteer 启动 Chrome 并打开 DevTools 链接
 * @param url 要打开的 URL
 * @param cdpPort CDP 端口号
 */
async function openChromeDevTools(url, cdpPort) {
    try {
        // 如果已经为这个端口打开过，跳过
        if (openedPorts.has(cdpPort)) {
            infoLogger(`[浏览器] DevTools 已为端口 ${cdpPort} 打开，跳过`);
            return;
        }
        // 尝试复用已有的浏览器实例
        if (browserInstance) {
            try {
                const pages = await browserInstance.pages();
                const page = pages[0] || await browserInstance.newPage();
                await page.goto(url, { waitUntil: 'networkidle0' });
                openedPorts.add(cdpPort);
                infoLogger('[浏览器] 已复用现有 Chrome 实例打开 DevTools');
                return;
            }
            catch (e) {
                // 复用失败，关闭旧实例并重新创建
                try {
                    await browserInstance.close();
                }
                catch (closeErr) { }
                browserInstance = null;
            }
        }
        // 使用 puppeteer 启动 Chrome，参考 chrome-devtools-mcp 的方式
        browserInstance = await puppeteer.launch({
            channel: 'chrome', // 使用系统安装的稳定版 Chrome
            headless: false,
            args: [
                '--hide-crash-restore-bubble',
            ],
            defaultViewport: null,
        });
        // 获取默认页面
        const pages = await browserInstance.pages();
        const page = pages[0] || await browserInstance.newPage();
        // 导航到 devtools:// 链接
        await page.goto(url, { waitUntil: 'networkidle0' });
        // 记录已打开的端口
        openedPorts.add(cdpPort);
        infoLogger('[浏览器] 已自动打开 DevTools 调试链接');
        // 监听浏览器关闭事件
        browserInstance.on('disconnected', () => {
            browserInstance = null;
            openedPorts.delete(cdpPort);
            infoLogger('[浏览器] Chrome 实例已关闭');
        });
        // 断开连接但不关闭浏览器（保持浏览器运行）
        // 注意：这里不调用 disconnect，因为我们复用 browserInstance
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        errorLogger('[浏览器] 启动 Chrome 失败:', errMsg);
        infoLogger(`[浏览器] 请手动打开: ${url}`);
    }
}
/**
 * 自动打开 Chrome DevTools 调试链接
 * @param cdpPort CDP 端口号
 * @param delay 延迟时间（毫秒），等待服务器启动
 */
export function autoOpenDevTools(cdpPort, delay = 2000) {
    const url = `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${cdpPort}`;
    infoLogger(`[浏览器] 将在 ${delay / 1000} 秒后自动打开 DevTools...`);
    infoLogger(`[浏览器] 调试链接: ${url}`);
    setTimeout(() => {
        openChromeDevTools(url, cdpPort).catch((err) => {
            errorLogger('[浏览器] 打开 DevTools 失败:', err);
        });
    }, delay);
}
/**
 * 关闭浏览器实例
 */
export function closeBrowser() {
    if (browserInstance) {
        browserInstance.close().catch(() => { });
        browserInstance = null;
        openedPorts.clear();
    }
}
//# sourceMappingURL=browser-opener.js.map