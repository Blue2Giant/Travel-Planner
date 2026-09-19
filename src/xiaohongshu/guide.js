import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildXiaohongshuUrl, normalizeXiaohongshuSourceUrl } from './mcp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data');
const OUTPUT = path.join(ROOT, 'output');

export function fileSlug(destination) {
  return destination.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'guide';
}

export { buildXiaohongshuUrl };

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
const uniqueImages = (images) => [...new Map(images.map((image) => [image.url, image])).values()];

function normalizePost(post) {
  const feedId = post.feedId || post.feed_id || post.id || '';
  const xsecToken = post.xsecToken || post.xsec_token || '';
  const metrics = post.metrics || {};
  return {
    feedId, xsecToken,
    title: post.title || '', author: post.author || post.user?.nickname || '',
    content: post.content || post.desc || '',
    metrics: { likes: metrics.likes ?? post.likes ?? null, favorites: metrics.favorites ?? post.favorites ?? null, comments: metrics.comments ?? post.comments ?? null },
    category: list(post.category),
    mentionedPlaces: list(post.mentionedPlaces), foodMentions: list(post.foodMentions),
    hotelAreaMentions: list(post.hotelAreaMentions), tips: list(post.tips),
    images: list(post.images || post.imageList).map((image) => typeof image === 'string' ? image : image.url || image.urlDefault).filter(Boolean),
    sourceUrl: normalizeXiaohongshuSourceUrl({ ...post, feedId, xsecToken }),
  };
}

function collect(posts, key, mapper) {
  const map = new Map();
  for (const post of posts) for (const entry of list(post[key])) {
    const item = typeof entry === 'string' ? { name: entry } : entry;
    const name = item.name || item.area || item.text;
    if (!name) continue;
    const old = map.get(name) || { ...mapper(item), sources: [], images: [] };
    old.sources = unique([...old.sources, post.feedId]);
    const evidence = list(item.images || item.imageEvidence).map((image) => {
      if (!image?.url || !image.caption) throw new Error(`“${name}” 的每张图片必须提供 url 与人工核对后的 caption。`);
      if (!post.images.includes(image.url)) throw new Error(`“${name}” 的图片不属于来源帖子 ${post.feedId}。`);
      return { url: image.url, caption: image.caption, sourceFeedId: post.feedId };
    });
    old.images = uniqueImages([...old.images, ...evidence]);
    map.set(name, old);
  }
  return [...map.values()];
}

function esc(value) { return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function citation(ids, sources) {
  return ids.map((id) => sources.find((s) => s.feedId === id)).filter(Boolean).map((s) => `<span>${esc(s.title || s.feedId)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">查看小红书原帖</a>` : ''}</span>`).join(' · ');
}
function photos(images, alt) {
  return images.length ? `<div class="photos">${images.map((image) => `<figure><img src="${esc(image.url)}" alt="${esc(`${alt}：${image.caption}`)}" loading="lazy"><figcaption>${esc(image.caption)}</figcaption></figure>`).join('')}</div>` : '';
}

export function renderGuide(guide) {
  const card = (title, rows, render) => `<section><h2>${title}</h2>${rows.length ? rows.map(render).join('') : '<p class="empty">暂无从原始帖子提取到的信息。</p>'}</section>`;
  const label = (ids) => ids.length >= 2 ? '🔥 多帖共同提及' : '💡 单帖经验';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(guide.destination)}旅行攻略</title><style>body{font:16px/1.65 system-ui,-apple-system,sans-serif;max-width:880px;margin:0 auto;padding:32px 20px;background:#fff8f7;color:#302726}header,section{background:#fff;border-radius:14px;padding:24px;margin:16px 0;box-shadow:0 2px 12px #4b272012}h1{margin:0;color:#d44d65}h2{font-size:1.2rem;border-bottom:1px solid #f1dddd;padding-bottom:8px}.item{padding:12px 0;border-bottom:1px solid #f5eeee}.item:last-child{border:0}.tag{font-size:.78rem;color:#b04455}.sources{font-size:.85rem;color:#786b69}a{color:#bf3852}.photos{display:flex;gap:8px;overflow:auto;margin:10px 0}.photos figure{width:190px;margin:0;flex:0 0 190px}.photos img{width:190px;height:142px;object-fit:cover;border-radius:9px;background:#f4eeee}.photos figcaption{font-size:.76rem;color:#786b69}.empty{color:#786b69}</style></head><body><header><h1>${esc(guide.destination)}旅行攻略</h1><p>${esc(guide.summary)}</p><p class="tag">${guide.demo ? '离线演示数据：替换为 MCP 原始结果后可重新生成。' : '基于已保存的小红书原始帖子生成。'}</p></header>${card('景点与体验', guide.highlights, (x) => `<article class="item"><strong>${esc(x.name)}</strong>${photos(x.images, x.name)}<p>${esc(x.description)}</p><div class="tag">${label(x.sources)}</div><div class="sources">来源：${citation(x.sources, guide.sources)}</div></article>`)}${card('特色美食', guide.food, (x) => `<article class="item"><strong>${esc(x.name)}</strong> · ${esc(x.type)}${photos(x.images, x.name)}<p>${esc(x.reason)}</p><div class="sources">来源：${citation(x.sources, guide.sources)}</div></article>`)}${card('住宿区域', guide.stayAreas, (x) => `<article class="item"><strong>${esc(x.name)}</strong>${photos(x.images, x.name)}<p>适合：${esc(x.goodFor || '—')}<br>优点：${esc(x.pros.join('；') || '—')}<br>注意：${esc(x.cons.join('；') || '—')}</p><div class="sources">来源：${citation(x.sources, guide.sources)}</div></article>`)}${card('实用 Tips', guide.tips, (x) => `<article class="item">${esc(x.text)}${photos(x.images, x.text)}<div class="sources">来源：${citation(x.sources, guide.sources)}</div></article>`)}${card('原始参考帖子', guide.sources, (x) => `<article class="item"><strong>${esc(x.title || x.feedId)}</strong> ${x.author ? `— ${esc(x.author)}` : ''}<br>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">查看小红书原帖</a>` : '<span class="tag">MCP 未提供可验证的原帖链接</span>'}</article>`)}</body></html>`;
  return html;
}

export async function generateGuide(destination, { demo = false, researchMeta = {} } = {}) {
  if (!destination?.trim()) throw new Error('请提供目的地。');
  const slug = fileSlug(destination);
  const rawFile = path.join(DATA, 'raw', `${slug}-posts.json`);
  let raw;
  try { raw = JSON.parse(await readFile(rawFile, 'utf8')); } catch { throw new Error(`未找到原始数据：${rawFile}。请先导入 MCP 帖子结果，或使用 demo 模式。`); }
  const posts = (Array.isArray(raw) ? raw : raw.posts || []).map(normalizePost).filter((x) => x.feedId);
  if (!posts.length) throw new Error('原始数据中没有可用帖子。');
  const sources = posts.map((p) => ({ feedId: p.feedId, noteId: p.feedId, xsecToken: p.xsecToken, title: p.title, author: p.author, url: p.sourceUrl, sourceUrl: p.sourceUrl, images: p.images, likes: p.metrics.likes, favorites: p.metrics.favorites }));
  const highlights = collect(posts, 'mentionedPlaces', (x) => ({ name: x.name, description: x.reason || x.description || '帖子中提及的地点或体验' }))
    .filter((item) => item.sources.length >= 2);
  const food = collect(posts, 'foodMentions', (x) => ({ name: x.name, type: x.category || x.type || '美食', reason: x.reason || '帖子中提及' }));
  const stayAreas = collect(posts, 'hotelAreaMentions', (x) => ({ name: x.area || x.name, goodFor: x.goodFor || '', pros: list(x.pros), cons: list(x.cons) }))
    .filter((item) => item.sources.length >= 2)
    .slice(0, 5);
  const tips = collect(posts, 'tips', (x) => ({ text: x.text || x.name }))
    .filter((item) => item.sources.length >= 2)
    .slice(0, 12);
  const recommendationImages = [...highlights, ...food, ...stayAreas, ...tips].flatMap((item) => item.images);
  if (new Set(recommendationImages.map((image) => image.url)).size !== recommendationImages.length) throw new Error('同一图片不能被用于多个推荐条目。');
  const rawMeta = raw.meta || {};
  const meta = {
    searchedPostCount: researchMeta.searchedPostCount ?? rawMeta.searchedPostCount ?? posts.length,
    fetchedPostCount: researchMeta.fetchedPostCount ?? rawMeta.fetchedPostCount ?? posts.length,
    usedPostCount: sources.length,
    queryCount: researchMeta.queryCount ?? rawMeta.queryCount ?? null,
    generatedAt: new Date().toISOString()
  };
  const guide = { destination: destination.trim(), meta, summary: `检索 ${meta.searchedPostCount} 篇候选，读取并整理 ${posts.length} 篇帖子；每项均保留来源。`, highlights, food, stayAreas, tips, sources, demo };
  await mkdir(path.join(DATA, 'processed'), { recursive: true }); await mkdir(OUTPUT, { recursive: true });
  await writeFile(path.join(DATA, 'processed', `${slug}-sources.json`), JSON.stringify(posts, null, 2));
  await writeFile(path.join(DATA, 'processed', `${slug}-guide.json`), JSON.stringify(guide, null, 2));
  const htmlFile = path.join(OUTPUT, `${slug}.html`); await writeFile(htmlFile, renderGuide(guide));
  return { slug, htmlFile, guideFile: path.join(DATA, 'processed', `${slug}-guide.json`), sourceFile: path.join(DATA, 'processed', `${slug}-sources.json`), posts: posts.length, demo };
}
