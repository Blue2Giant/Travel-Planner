const READ_ONLY_TOOLS = new Set(['check_login_status', 'search_feeds', 'get_feed_detail']);
const endpoint = process.env.XIAOHONGSHU_MCP_URL || 'http://127.0.0.1:18060/mcp';
let requestId = 0;

export function buildXiaohongshuUrl(feedId, xsecToken) {
  if (!feedId) return '';
  const base = `https://www.xiaohongshu.com/explore/${encodeURIComponent(feedId)}`;
  return xsecToken
    ? `${base}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_feed`
    : base;
}

export function normalizeXiaohongshuSourceUrl(post = {}) {
  return post.sourceUrl || post.source_url || post.url || post.noteUrl || post.note_url || post.share_url
    || buildXiaohongshuUrl(post.feedId || post.feed_id || post.noteId || post.id, post.xsecToken || post.xsec_token);
}

function parseContent(result) {
  const text = (result.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  if (!text) throw new Error('小红书 MCP 返回了空数据。');
  try { return JSON.parse(text); } catch { return text; }
}

export async function callXiaohongshu(tool, args = {}, { timeoutMs = 90000 } = {}) {
  if (!READ_ONLY_TOOLS.has(tool)) throw new Error(`禁止调用非只读小红书工具：${tool}`);
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`小红书 MCP 请求失败（HTTP ${response.status}）。`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || '小红书 MCP 调用失败。');
  if (body.result?.isError) {
    const message = (body.result.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    throw new Error(message || '小红书 MCP 工具返回错误。');
  }
  return { raw: body.result, data: parseContent(body.result) };
}
