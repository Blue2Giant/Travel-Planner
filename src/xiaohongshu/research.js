import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callXiaohongshu, normalizeXiaohongshuSourceUrl } from './mcp.js';
import { fileSlug, generateGuide } from './guide.js';
import { planQueries } from './query-planner.js';
import { flattenSearchGroups, rankCandidates, selectBalancedCandidates } from './ranking.js';
import { compressNote } from './post-compressor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SEARCH_DELAY = Number(process.env.XHS_SEARCH_DELAY_MS || 650);
const DETAIL_DELAY = Number(process.env.XHS_DETAIL_DELAY_MS || 650);
const DETAIL_TARGET = Math.min(25, Math.max(12, Number(process.env.XHS_DETAIL_TARGET || 20)));

async function save(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

async function retry(operation, attempts = 2) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); }
    catch (cause) { error = cause; if (attempt + 1 < attempts) await pause(1200 * (attempt + 1)); }
  }
  throw error;
}

function noteFromDetail(data) {
  return data?.data?.note || data?.note || data?.data?.data?.note || null;
}

function parseStoredResult(raw) {
  if (!raw?.content) return raw;
  const text = raw.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  return JSON.parse(text);
}

function inferKind(note) {
  const text = `${note.title || ''} ${note.desc || ''}`;
  if (/住宿|酒店|民宿|住哪|住在/.test(text)) return 'stay';
  if (/美食|必吃|餐厅|火锅|米线|吃了|吃完/.test(text)) return 'food';
  if (/避坑|避雷|注意|高反/.test(text)) return 'tips';
  if (/路线|行程|\d日游/.test(text)) return 'route';
  return 'overview';
}

function validationReport({ queries, candidates, selected, posts, failures }) {
  const ids = posts.map((post) => post.feedId);
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      queries: queries.length,
      searchedCandidates: candidates.length,
      selectedForDetail: selected.length,
      fetchedPosts: posts.length,
      failedDetails: failures.length
    },
    checks: {
      searchedAtLeast20: candidates.length >= 20,
      fetchedAtLeast12: posts.length >= 12,
      uniqueFeedIds: new Set(ids).size === ids.length,
      allSourcesHaveUrls: posts.every((post) => Boolean(post.sourceUrl)),
      stayAreasHaveNoImages: posts.every((post) => post.hotelAreaMentions.every((area) => !area.images?.length))
    },
    warnings: [
      ...(candidates.length < 20 ? [`搜索仅获得 ${candidates.length} 个去重候选，低于理想的 20 个。`] : []),
      ...(posts.length < 12 ? [`详情仅成功读取 ${posts.length} 篇，低于理想的 12 篇。`] : []),
      ...failures.map((item) => `${item.feedId}: ${item.error}`)
    ]
  };
}

export async function researchAndGenerate(destination, options = {}) {
  const slug = fileSlug(destination);
  const rawDir = path.join(ROOT, 'data/raw');
  const debugDir = path.join(ROOT, 'data/processed/debug', slug);
  const queries = planQueries(destination, options);
  const login = await callXiaohongshu('check_login_status');
  await save(path.join(rawDir, `${slug}-login.json`), login.raw);
  if (!/已登录|logged in/i.test(JSON.stringify(login.data))) throw new Error('小红书 MCP 未登录，请先在本机完成登录。');

  const groups = []; const searchFailures = [];
  for (const [index, query] of queries.entries()) {
    const rawFile = path.join(rawDir, `${slug}-search-${String(index + 1).padStart(2, '0')}-${query.kind}.json`);
    try {
      const result = await retry(() => callXiaohongshu('search_feeds', { keyword: query.keyword }));
      await save(rawFile, result.raw);
      groups.push({ ...query, data: result.data });
    } catch (error) {
      const failure = { ...query, error: error.message };
      searchFailures.push(failure);
      await save(rawFile.replace(/\.json$/, '-error.json'), failure);
    }
    if (index + 1 < queries.length) await pause(SEARCH_DELAY);
  }
  await save(path.join(debugDir, '01_search_results.json'), {
    destination, queries, successfulQueries: groups.length, failedQueries: searchFailures
  });

  const candidates = flattenSearchGroups(groups, destination);
  const ranked = rankCandidates(candidates, destination);
  const selected = selectBalancedCandidates(ranked, { limit: DETAIL_TARGET });
  await save(path.join(debugDir, '02_ranked_candidates.json'), { candidates: ranked, selectedFeedIds: selected.map((item) => item.feedId) });
  if (!selected.length) throw new Error('没有获得可用搜索结果，请稍后重试。');

  const posts = []; const failures = []; const fetchedCandidates = [];
  const fetchCandidate = async (candidate, forcedKind) => {
    const detailFile = path.join(rawDir, 'posts', `${candidate.feedId}.json`);
    try {
      const result = await retry(() => callXiaohongshu('get_feed_detail', {
        feed_id: candidate.feedId,
        xsec_token: candidate.xsecToken,
        load_all_comments: false
      }));
      await save(detailFile, result.raw);
      const note = noteFromDetail(result.data);
      if (!note) throw new Error('详情响应中缺少 note');
      const primaryKind = forcedKind || candidate.selectedKind || candidate.occurrences[0]?.kind || 'overview';
      const sourceUrl = normalizeXiaohongshuSourceUrl({ ...candidate, ...note, feedId: candidate.feedId, xsecToken: candidate.xsecToken });
      posts.push(compressNote(note, { kind: primaryKind, sourceUrl }));
      fetchedCandidates.push({ ...candidate, selectedKind: primaryKind });
      return true;
    } catch (error) {
      const failure = { feedId: candidate.feedId, title: candidate.title, error: error.message };
      failures.push(failure);
      await save(detailFile.replace(/\.json$/, '-error.json'), failure);
      return false;
    }
  };
  for (const [index, candidate] of selected.entries()) {
    await fetchCandidate(candidate);
    if (index + 1 < selected.length) await pause(DETAIL_DELAY);
  }
  if (!posts.length) throw new Error('搜索成功，但帖子详情均无法读取，请稍后重试。');

  const enrichments = [
    { kind: 'food', hasEvidence: () => posts.some((post) => post.foodMentions.length) },
    { kind: 'stay', hasEvidence: () => posts.some((post) => post.hotelAreaMentions.length) }
  ];
  for (const enrichment of enrichments) {
    let attempts = 0;
    for (const candidate of ranked) {
      if (enrichment.hasEvidence() || posts.length >= 25 || attempts >= 5) break;
      if (fetchedCandidates.some((item) => item.feedId === candidate.feedId)) continue;
      if (!candidate.occurrences.some((item) => item.kind === enrichment.kind)) continue;
      attempts += 1;
      await fetchCandidate(candidate, enrichment.kind);
      await pause(DETAIL_DELAY);
    }
  }

  const capturedAt = new Date().toISOString();
  await save(path.join(debugDir, '03_fetched_posts.json'), { selected: fetchedCandidates, failures, fetchedFeedIds: posts.map((post) => post.feedId) });
  await save(path.join(debugDir, '04_compact_posts.json'), posts);
  await save(path.join(rawDir, `${slug}-posts.json`), {
    destination,
    capturedAt,
    generatedBy: 'read-only xiaohongshu MCP',
    meta: { searchedPostCount: candidates.length, selectedPostCount: fetchedCandidates.length, fetchedPostCount: posts.length, queryCount: queries.length },
    posts
  });
  await save(path.join(debugDir, '08_validation_report.json'), validationReport({ queries, candidates, selected: fetchedCandidates, posts, failures }));
  return generateGuide(destination, { researchMeta: { searchedPostCount: candidates.length, fetchedPostCount: posts.length, queryCount: queries.length } });
}

export async function regenerateFromSavedDetails(destination) {
  const slug = fileSlug(destination);
  const rawDir = path.join(ROOT, 'data/raw');
  const debugDir = path.join(ROOT, 'data/processed/debug', slug);
  const fetched = JSON.parse(await readFile(path.join(debugDir, '03_fetched_posts.json'), 'utf8'));
  const report = JSON.parse(await readFile(path.join(debugDir, '08_validation_report.json'), 'utf8'));
  const posts = [];
  for (const candidate of fetched.selected || []) {
    const stored = JSON.parse(await readFile(path.join(rawDir, 'posts', `${candidate.feedId}.json`), 'utf8'));
    const note = noteFromDetail(parseStoredResult(stored));
    if (!note) continue;
    const sourceUrl = normalizeXiaohongshuSourceUrl({ ...candidate, ...note, feedId: candidate.feedId, xsecToken: candidate.xsecToken });
    posts.push(compressNote(note, { kind: inferKind(note), sourceUrl }));
  }
  await save(path.join(debugDir, '04_compact_posts.json'), posts);
  await save(path.join(rawDir, `${slug}-posts.json`), {
    destination,
    capturedAt: new Date().toISOString(),
    generatedBy: 'saved read-only xiaohongshu MCP details',
    meta: {
      searchedPostCount: report.counts.searchedCandidates,
      selectedPostCount: fetched.selected?.length || posts.length,
      fetchedPostCount: posts.length,
      queryCount: report.counts.queries
    },
    posts
  });
  return generateGuide(destination);
}
