/**
 * Frida 注入模块
 * 负责将 hook 脚本注入到微信小程序进程
 * 基于 WMPFDebugger 的实现
 */

import {promises as fsPromises} from 'node:fs';
import path from 'node:path';

import {debugLogger, errorLogger, infoLogger} from './logger.js';

// Frida 可选依赖（延迟加载，避免顶层 await 阻塞）
let frida: any = null;
let fridaLoaded = false;

async function loadFrida(): Promise<any> {
  if (fridaLoaded) return frida;
  try {
    frida = await import('frida');
    infoLogger('[Frida] 模块加载成功');
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    errorLogger('[Frida] 模块加载失败:', errMsg);
    errorLogger('[Frida] 请确保 frida 已正确安装: npm install frida@17.3.2');
  }
  fridaLoaded = true;
  return frida;
}

/**
 * 查找并注入到微信小程序进程
 * @param projectRoot 项目根目录
 * @param debugFrida 是否输出 Frida 调试信息
 */
export async function fridaServer(
  projectRoot: string,
  debugFrida: boolean,
): Promise<void> {
  const fridaModule = await loadFrida();
  if (!fridaModule) {
    infoLogger('[Frida] Frida 模块不可用，跳过注入');
    return;
  }

  try {
    // 获取本地设备
    const localDevice = await fridaModule.getLocalDevice();

    // 枚举所有进程
    const processes = await localDevice.enumerateProcesses({
      scope: fridaModule.Scope.Metadata,
    });

    // 查找 WeChatAppEx.exe 进程（微信小程序运行时）
    const wmpfProcesses = processes.filter(
      (proc: any) => proc.name === 'WeChatAppEx.exe',
    );

    if (wmpfProcesses.length === 0) {
      throw new Error(
        '[Frida] 未找到 WeChatAppEx.exe 进程，请先打开微信小程序',
      );
    }

    // 获取父进程 PID
    const wmpfPids = wmpfProcesses.map((p: any) =>
      p.parameters.ppid ? p.parameters.ppid : 0,
    );

    // 找到主进程（出现次数最多的父进程 PID）
    const wmpfPid = wmpfPids
      .sort(
        (a: number, b: number) =>
          wmpfPids.filter((v: number) => v === a).length -
          wmpfPids.filter((v: number) => v === b).length,
      )
      .pop();

    if (wmpfPid === undefined) {
      throw new Error('[Frida] 无法确定微信小程序主进程');
    }

    const wmpfProcess = processes.filter(
      (proc: any) => proc.pid === wmpfPid,
    )[0];

    // 获取 WMPF 版本号
    const wmpfProcessPath = wmpfProcess.parameters.path as string | undefined;
    const wmpfVersionMatch = wmpfProcessPath
      ? wmpfProcessPath.match(/\d+/g)
      : '';
    const wmpfVersion = wmpfVersionMatch
      ? new Number(wmpfVersionMatch.pop())
      : 0;

    if (wmpfVersion === 0) {
      throw new Error('[Frida] 无法识别 WMPF 版本号');
    }

    infoLogger(`[Frida] 找到微信小程序进程 PID: ${wmpfPid}, WMPF 版本: ${wmpfVersion}`);

    // 附加到进程
    const session = await localDevice.attach(Number(wmpfPid));
    infoLogger('[Frida] 已附加到微信小程序进程');

    // 加载 hook 脚本
    let scriptContent: string | null = null;
    try {
      scriptContent = (
        await fsPromises.readFile(path.join(projectRoot, 'frida/hook.js'))
      ).toString();
    } catch (e) {
      throw new Error('[Frida] 未找到 hook 脚本文件');
    }

    // 加载版本配置
    let configContent: string | null = null;
    try {
      configContent = (
        await fsPromises.readFile(
          path.join(
            projectRoot,
            'frida/config',
            `addresses.${wmpfVersion}.json`,
          ),
        )
      ).toString();
      configContent = JSON.stringify(JSON.parse(configContent));
    } catch (e) {
      // 列出所有可用的配置文件
      const configDir = path.join(projectRoot, 'frida/config');
      const availableConfigs = await fsPromises.readdir(configDir);
      const supportedVersions = availableConfigs
        .filter(f => f.startsWith('addresses.') && f.endsWith('.json'))
        .map(f => f.replace('addresses.', '').replace('.json', ''));
      
      throw new Error(
        `[Frida] 未找到版本配置文件: ${wmpfVersion}。支持的版本: ${supportedVersions.join(', ')}`
      );
    }

    if (scriptContent === null) {
      throw new Error('[Frida] 无法加载 hook 脚本');
    }

    // 注入脚本
    const script = await session.createScript(
      scriptContent.replace('@@CONFIG@@', configContent),
    );

    script.message.connect((message: any) => {
      if (message.type === 'error') {
        errorLogger('[Frida]', message);
        return;
      }

      if (debugFrida) {
        debugLogger('[Frida]', message.payload);
      }
    });

    await script.load();
    infoLogger('[Frida] Hook 脚本已注入，现在可以打开小程序进行调试');
  } catch (error) {
    errorLogger('[Frida] 注入失败:', error);
    throw error;
  }
}
