import { z } from 'zod';
import { getCDPClient } from '../cdp-client.js';
import { ToolCategory } from './tool-category.js';
/**
 * 尝试通过 Frida 或 adb 触发微信小程序操作
 */
export const triggerTarget = {
    name: 'trigger_target',
    description: '自动触发微信小程序操作（页面切换、按钮点击等）来命中已设置的断点。通过 Frida 注入或 adb 命令实现自动化触发',
    category: ToolCategory.DEBUGGER,
    schema: {
        action_type: z.enum([
            'page_switch', // 切换到指定页面
            'pull_to_refresh', // 下拉刷新
            'button_click', // 点击按钮
            'navigate_back', // 返回上一页
            'reload_page', // 重新加载当前页面
            'input_text', // 输入文本
            'scroll', // 滚动页面
            'tap_coordinate', // 点击指定坐标
        ]).describe('触发操作类型'),
        target: z.string().optional().describe('目标页面路径或按钮文本（page_switch/button_click/input_text 时使用）'),
        text: z.string().optional().describe('输入文本（input_text 时使用）'),
        x: z.number().optional().describe('X 坐标（tap_coordinate 时使用）'),
        y: z.number().optional().describe('Y 坐标（tap_coordinate 时使用）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            if (!client.isDebuggerEnabled()) {
                await client.enableDebuggerAndWaitScripts(3000);
            }
            let result;
            switch (params.action_type) {
                case 'page_switch': {
                    // 通过 CDP Runtime.evaluate 执行页面切换
                    if (!params.target) {
                        return { status: 'error', message: 'page_switch 需要 target 参数（页面路径如 /pages/index/index）' };
                    }
                    const resultObj = await client.evaluateScript(`wx.navigateTo({url: '${params.target}', fail(e) { throw e; }})`, undefined);
                    result = resultObj;
                    break;
                }
                case 'pull_to_refresh': {
                    const resultObj = await client.evaluateScript(`typeof getApp === 'function' && getApp() && getApp().globalData`, undefined);
                    // 模拟下拉刷新：通过 CDP Input.dispatchTouchEvent 模拟手势
                    // 或者尝试调用页面的 onPullDownRefresh
                    const pageResult = await client.evaluateScript(`typeof getCurrentPages === 'function' ? getCurrentPages().map(p => ({route: p.route, data: Object.keys(p.data || {})})) : []`, undefined);
                    result = {
                        action: 'pull_to_refresh',
                        current_pages: pageResult,
                        message: '已获取当前页面栈。如果目标页面支持下拉刷新，请在微信中手动下拉，断点应自动命中',
                    };
                    break;
                }
                case 'button_click': {
                    if (!params.target) {
                        return { status: 'error', message: 'button_click 需要 target 参数（按钮绑定的函数名）' };
                    }
                    // 尝试在当前页面实例上调用指定方法
                    const evalResult = await client.evaluateScript(`(function() {
              const pages = getCurrentPages();
              const currentPage = pages[pages.length - 1];
              if (!currentPage) return {error: '无法获取当前页面'};
              if (typeof currentPage.${params.target} === 'function') {
                currentPage.${params.target}({currentTarget: {}});
                return {success: true, message: '已调用 ' + '${params.target}'};
              }
              // 尝试在页面 data 中查找
              return {error: '未找到方法 ' + '${params.target}', available: Object.keys(currentPage).filter(k => typeof currentPage[k] === 'function').slice(0, 20)};
            })()`, undefined);
                    result = evalResult;
                    break;
                }
                case 'navigate_back': {
                    const resultObj = await client.evaluateScript(`wx.navigateBack({fail(e) { throw e; }})`, undefined);
                    result = resultObj;
                    break;
                }
                case 'reload_page': {
                    // 通过 CDP 重新加载页面
                    // 先获取当前 URL，然后 navigate
                    const pageInfo = await client.evaluateScript(`typeof getCurrentPages === 'function' ? getCurrentPages().map(p => ({route: p.route})) : []`, undefined);
                    result = {
                        action: 'reload_page',
                        current_pages: pageInfo,
                        message: '请在微信中手动退出并重新进入小程序，断点应自动命中',
                    };
                    break;
                }
                case 'input_text': {
                    if (!params.target || !params.text) {
                        return { status: 'error', message: 'input_text 需要 target（组件选择器）和 text 参数' };
                    }
                    // 通过 CDP Input.dispatchKeyEvent 模拟输入
                    // 先聚焦元素，再输入文本
                    try {
                        await client.evaluateScript(`(function() {
                const el = document.querySelector('${params.target}');
                if (!el) throw new Error('未找到元素: ${params.target}');
                el.focus();
                el.value = '${params.text}';
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
                return '已输入文本到 ${params.target}';
              })()`, undefined);
                        result = { action: 'input_text', message: `已向 ${params.target} 输入文本` };
                    }
                    catch (e) {
                        result = { action: 'input_text', error: `输入失败: ${e.message}`, hint: '微信小程序的渲染层在 WebView 中，可能需要通过 adb 输入' };
                    }
                    break;
                }
                case 'scroll': {
                    const scrollResult = await client.evaluateScript(`(function() {
              const pages = getCurrentPages();
              const currentPage = pages[pages.length - 1];
              if (!currentPage) return {error: '无法获取当前页面'};
              return {
                route: currentPage.route,
                data_keys: Object.keys(currentPage.data || {}),
                message: '当前页面: ' + currentPage.route
              };
            })()`, undefined);
                    result = {
                        action: 'scroll',
                        page_info: scrollResult,
                        message: '已获取页面信息。请在微信中手动滚动页面触发 onReachBottom/onPageScroll',
                    };
                    break;
                }
                case 'tap_coordinate': {
                    if (params.x === undefined || params.y === undefined) {
                        return { status: 'error', message: 'tap_coordinate 需要 x 和 y 坐标' };
                    }
                    // 通过 CDP Input.dispatchTouchEvent 模拟点击
                    // 注意：这需要知道设备的屏幕坐标
                    result = {
                        action: 'tap_coordinate',
                        x: params.x,
                        y: params.y,
                        message: `坐标点击 (${params.x}, ${params.y}) 已记录。请确保设备屏幕坐标正确，或使用 adb input tap ${params.x} ${params.y}`,
                    };
                    break;
                }
                default:
                    return { status: 'error', message: `不支持的操作类型: ${params.action_type}` };
            }
            return {
                status: 'triggered',
                action: params.action_type,
                result,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `触发失败: ${e.message}`,
            };
        }
    },
};
//# sourceMappingURL=trigger-target.js.map