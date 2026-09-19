import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callXiaohongshu } from './mcp.js';
import { fileSlug, generateGuide } from './guide.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const asNumber = (value) => Number(String(value || '0').replace(/[^\d.]/g, '')) || 0;
const clean = (text) => String(text || '').replace(/#[^#\n]+\[话题\]#/g, '').replace(/\s+/g, ' ').trim();
const keyFor = (name) => name.replace(/[（(].*?[）)]/g, '').replace(/[的和与及、]/g, '').trim();

async function save(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}
async function retry(operation) {
  let error;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await operation(); } catch (cause) { error = cause; if (attempt === 0) await pause(1200); }
  }
  throw error;
}
function sentenceAround(content, name) {
  const sentences = clean(content).split(/[。！？]/).map((item) => item.trim()).filter(Boolean);
  return sentences.find((item) => item.includes(name)) || '原帖提及此地点；请打开原帖确认具体安排。';
}
function matches(content, pattern, limit = 5) {
  const found = []; let match;
  while ((match = pattern.exec(content)) && found.length < limit) {
    const name = keyFor(match[1]);
    if (name.length >= 2 && !found.includes(name)) found.push(name);
  }
  return found;
}
function annotate(note, kind) {
  const content = clean(note.desc);
  const places = matches(content, /(?:📍|[：:、，\s])([\u4e00-\u9fff]{2,12}(?:古城|寺|湖|雪山|峡谷|草原|公园|村|塔|广场|景区|博物馆|市场|湿地))/g);
  const foods = matches(content, /(?:推荐|必吃|美食|吃)(?:[：:、，\s]*)([\u4e00-\u9fff]{2,14}(?:餐厅|咖啡|火锅|米线|牦牛肉|酥油茶|青稞饼|藏香猪))/g);
  const areas = matches(content, /([\u4e00-\u9fff]{2,12}(?:古城|市区|县城|车站|机场|附近|周边))/g, 3);
  const source = {
    feedId: note.noteId, xsecToken: note.xsecToken, title: note.title, author: note.user?.nickname || '', content,
    metrics: { likes: asNumber(note.interactInfo?.likedCount), favorites: asNumber(note.interactInfo?.collectedCount), comments: asNumber(note.interactInfo?.commentCount) },
    images: (note.imageList || []).map((image) => image.urlDefault).filter(Boolean).slice(0, 3),
    mentionedPlaces: places.map((name) => ({ name, reason: sentenceAround(content, name) })),
    foodMentions: foods.map((name) => ({ name, category: '原帖提及美食', reason: sentenceAround(content, name) })),
    hotelAreaMentions: kind === 'stay' ? areas.map((area) => ({ area, goodFor: '以原帖住宿体验为准', pros: [sentenceAround(content, area)], cons: [] })) : [],
    tips: content ? [{ text: content.slice(0, 180) + (content.length > 180 ? '…' : '') }] : []
  };
  return source;
}
function chooseCandidates(groups) {
  const chosen = []; const seen = new Set();
  for (const { kind, data } of groups) {
    const feeds = data.feeds || [];
    for (const feed of feeds) {
      const title = feed.noteCard?.displayTitle || '';
      if (!feed.id || seen.has(feed.id) || /租车|留学|移民|跟团咨询/.test(title)) continue;
      chosen.push({ kind, feedId: feed.id, xsecToken: feed.xsecToken, score: asNumber(feed.noteCard?.interactInfo?.collectedCount) + asNumber(feed.noteCard?.interactInfo?.likedCount), title });
      seen.add(feed.id);
      if (chosen.filter((item) => item.kind === kind).length >= 2) break;
    }
  }
  return chosen.sort((a, b) => b.score - a.score).slice(0, 8);
}

export async function researchAndGenerate(destination) {
  const slug = fileSlug(destination);
  const rawDir = path.join(ROOT, 'data/raw');
  const queries = [{ kind: 'travel', keyword: `${destination} 旅游攻略` }, { kind: 'food', keyword: `${destination} 美食` }, { kind: 'stay', keyword: `${destination} 住宿` }, { kind: 'attraction', keyword: `${destination} 景点` }];
  const login = await callXiaohongshu('check_login_status');
  const loginText = JSON.stringify(login.data);
  if (!/已登录|logged in/i.test(loginText)) throw new Error('小红书 MCP 未登录，请先在本机完成登录。');
  const groups = [];
  for (const query of queries) {
    try {
      const result = await retry(() => callXiaohongshu('search_feeds', { keyword: query.keyword }));
      await save(path.join(rawDir, `${slug}-search-${query.kind}.json`), result.raw);
      groups.push({ kind: query.kind, data: result.data });
    } catch (error) {
      await save(path.join(rawDir, `${slug}-search-${query.kind}-error.json`), { keyword: query.keyword, error: error.message });
    }
    await pause(700);
  }
  const candidates = chooseCandidates(groups);
  if (!candidates.length) throw new Error('没有获得可用搜索结果，请稍后重试。');
  const posts = [];
  for (const candidate of candidates) {
    try {
      const result = await retry(() => callXiaohongshu('get_feed_detail', { feed_id: candidate.feedId, xsec_token: candidate.xsecToken, load_all_comments: false }));
      await save(path.join(rawDir, 'posts', `${candidate.feedId}.json`), result.raw);
      if (result.data.data?.note) posts.push(annotate(result.data.data.note, candidate.kind));
    } catch (error) { await save(path.join(rawDir, 'posts', `${candidate.feedId}-error.json`), { ...candidate, error: error.message }); }
    await pause(700);
  }
  if (!posts.length) throw new Error('搜索成功，但帖子详情均无法读取，请稍后重试。');
  await save(path.join(rawDir, `${slug}-posts.json`), { destination, capturedAt: new Date().toISOString(), generatedBy: 'read-only xiaohongshu MCP', posts });
  return generateGuide(destination);
}
