const READ_ONLY_TOOLS = new Set(['check_login_status', 'search_feeds', 'get_feed_detail']);
const endpoint = process.env.XIAOHONGSHU_MCP_URL || 'http://127.0.0.1:18060/mcp';
let requestId = 0;

function parseContent(result) {
  const text = (result.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  if (!text) throw new Error('小红书 MCP 返回了空数据。');
  try { return JSON.parse(text); } catch { return text; }
}

export async function callXiaohongshu(tool, args = {}) {
  if (!READ_ONLY_TOOLS.has(tool)) throw new Error(`禁止调用非只读小红书工具：${tool}`);
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error(`小红书 MCP 请求失败（HTTP ${response.status}）。`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || '小红书 MCP 调用失败。');
  return { raw: body.result, data: parseContent(body.result) };
}
