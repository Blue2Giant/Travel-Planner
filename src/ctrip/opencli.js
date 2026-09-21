import { spawn } from 'node:child_process';

const READ_ONLY = new Set(['search', 'hotel-suggest', 'hotel-search', 'hotel', 'flight', 'flight-round', 'train']);

function classify(message, fallback = 'UPSTREAM_PARSE_ERROR') {
  if (/ENOENT|not found/i.test(message)) return 'OPENCLI_NOT_INSTALLED';
  if (/captcha|验证码|滑块/i.test(message)) return 'CTRIP_CAPTCHA_REQUIRED';
  if (/login|auth|required|登录/i.test(message)) return 'CTRIP_AUTH_REQUIRED';
  if (/timed out|timeout/i.test(message)) return 'TIMEOUT';
  if (/bridge|chrome|browser/i.test(message)) return 'BROWSER_BRIDGE_UNAVAILABLE';
  return fallback;
}

export async function runOpencli(command, args, { timeoutMs = 60_000, retries = 2 } = {}) {
  if (!READ_ONLY.has(command)) throw new Error('只允许已登记的只读携程命令。');
  const binary = process.env.OPENCLI_BIN || 'opencli';
  // Retaining a trace only on failure makes intermittent browser-navigation
  // failures diagnosable, while successful read-only responses remain plain JSON.
  const fullArgs = ['ctrip', command, ...args, '-f', 'json', '--trace', 'retain-on-failure'];
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderr = ''; let didTimeout = false;
    const child = spawn(binary, fullArgs, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { didTimeout = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (cause) => {
      clearTimeout(timer);
      const error = new Error(cause.message); error.code = classify(cause.message); reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (didTimeout) { const error = new Error('携程查询超时，请稍后重试。'); error.code = 'TIMEOUT'; return reject(error); }
      if (code !== 0) {
        const message = (stderr || stdout || `OpenCLI 退出码 ${code}`).trim();
        if (retries > 0 && /Navigation rejected/i.test(message)) return resolve(runOpencli(command, args, { timeoutMs, retries: retries - 1 }));
        const error = new Error(message); error.code = classify(message); return reject(error);
      }
      try { resolve(JSON.parse(stdout)); }
      catch { const error = new Error('OpenCLI 没有返回可解析的 JSON。'); error.code = 'UPSTREAM_PARSE_ERROR'; reject(error); }
    });
  });
}

function runBrowserCommand(session, command, args = [], { timeoutMs = 30_000, json = false } = {}) {
  const binary = process.env.OPENCLI_BIN || 'opencli';
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderr = ''; let didTimeout = false;
    const child = spawn(binary, ['browser', session, command, ...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { didTimeout = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (cause) => { clearTimeout(timer); const error = new Error(cause.message); error.code = classify(cause.message); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (didTimeout) { const error = new Error(`OpenCLI browser ${command} 超时。`); error.code = 'TIMEOUT'; return reject(error); }
      if (code !== 0) { const message = (stderr || stdout || `OpenCLI browser 退出码 ${code}`).trim(); const error = new Error(message); error.code = classify(message); return reject(error); }
      if (!json) return resolve(stdout.trim());
      try { return resolve(JSON.parse(stdout)); }
      catch { const error = new Error(`OpenCLI browser ${command} 没有返回可解析的 JSON。`); error.code = 'UPSTREAM_PARSE_ERROR'; return reject(error); }
    });
  });
}

// The dedicated flight adapter can remain in Ctrip's SPA skeleton while the
// connected Chrome tab renders the same read-only result page correctly. Keep
// this as a narrow fallback and return only card text for parsing by our adapter.
export async function readFlightCardsWithBrowser(searchUrl, limit = 10) {
  const session = `ctrip-flight-${process.pid}-${Date.now()}`;
  const selector = '.flight-item.domestic';
  try {
    await runBrowserCommand(session, 'open', [searchUrl, '--window', 'background']);
    await runBrowserCommand(session, 'wait', ['selector', selector, '--timeout', '15000'], { timeoutMs: 20_000 });
    const js = `(() => Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0, ${Math.min(Number(limit) || 10, 20)}).map(card => card.innerText))()`;
    return await runBrowserCommand(session, 'eval', [js], { json: true });
  } finally {
    await runBrowserCommand(session, 'close', [], { timeoutMs: 10_000 }).catch(() => {});
  }
}

export function opencliError(error) {
  const code = error.code || classify(error.message || '');
  const hints = {
    OPENCLI_NOT_INSTALLED: '未找到 opencli。请先安装 @jackwener/opencli。',
    BROWSER_BRIDGE_UNAVAILABLE: 'Browser Bridge 不可用。请确认 Chrome 扩展和 OpenCLI daemon 已就绪。',
    CTRIP_AUTH_REQUIRED: '携程当前需要登录。请在本机 Chrome 中完成登录后重试。',
    CTRIP_CAPTCHA_REQUIRED: '携程当前要求浏览器验证。请在本机 Chrome 完成验证码/滑块后重试。',
    TIMEOUT: '携程查询超时，请稍后重试。'
  };
  return { code, message: hints[code] || error.message || '携程查询失败。' };
}
