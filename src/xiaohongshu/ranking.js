const EXCLUDED = /租车|留学|移民|跟团咨询|招聘|房产|婚纱摄影/;
const DENSE_TERMS = /路线|行程|交通|门票|预约|住宿|美食|避坑|注意|地图|徒步|必去|景点/g;

export const metricNumber = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  const number = Number(text.replace(/[^\d.]/g, '')) || 0;
  return /[万w]/i.test(text) ? number * 10000 : number;
};

const cleanTitle = (value) => String(value || '')
  .toLowerCase().replace(/#[^#\n]+\[话题\]#/g, '').replace(/[^\p{L}\p{N}]/gu, '');

function bigrams(value) {
  const text = cleanTitle(value);
  if (text.length < 2) return new Set([text]);
  return new Set([...text].slice(0, -1).map((character, index) => character + [...text][index + 1]));
}

export function titleSimilarity(left, right) {
  const a = bigrams(left); const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / (a.size + b.size - intersection);
}

function normalizedLogs(candidates, field) {
  const values = candidates.map((item) => Math.log1p(item.metrics[field] || 0));
  const maximum = Math.max(...values, 0);
  return values.map((value) => maximum ? value / maximum : null);
}

export function flattenSearchGroups(groups, destination) {
  const candidates = new Map();
  for (const group of groups) {
    const feeds = Array.isArray(group.data?.feeds) ? group.data.feeds : [];
    feeds.forEach((feed, rank) => {
      const card = feed.noteCard || {};
      const feedId = feed.id || feed.feedId || feed.noteId;
      if (!feedId || card.type === 'video') return;
      const info = card.interactInfo || {};
      const previous = candidates.get(feedId);
      const occurrence = { kind: group.kind, keyword: group.keyword, rank };
      if (previous) {
        previous.occurrences.push(occurrence);
        if (!previous.xsecToken && feed.xsecToken) previous.xsecToken = feed.xsecToken;
        return;
      }
      candidates.set(feedId, {
        feedId,
        xsecToken: feed.xsecToken || feed.xsec_token || '',
        title: card.displayTitle || card.title || '',
        authorId: card.user?.userId || '',
        author: card.user?.nickname || card.user?.nickName || '',
        sourceUrl: feed.url || feed.sourceUrl || card.url || '',
        cover: card.cover?.urlDefault || card.cover?.urlPre || '',
        metrics: {
          likes: metricNumber(info.likedCount),
          collects: metricNumber(info.collectedCount),
          comments: metricNumber(info.commentCount),
          shares: metricNumber(info.sharedCount)
        },
        occurrences: [occurrence],
        destination
      });
    });
  }
  return [...candidates.values()];
}

export function rankCandidates(input, destination) {
  const candidates = input.filter((item) => item.feedId && !EXCLUDED.test(item.title));
  const normalized = {
    likes: normalizedLogs(candidates, 'likes'), collects: normalizedLogs(candidates, 'collects'),
    comments: normalizedLogs(candidates, 'comments'), shares: normalizedLogs(candidates, 'shares')
  };
  return candidates.map((candidate, index) => {
    const available = ['likes', 'collects', 'comments', 'shares'].filter((key) => normalized[key][index] !== null);
    const baseWeights = { likes: 0.45, collects: 0.35, comments: 0.15, shares: 0.05 };
    const weightTotal = available.reduce((sum, key) => sum + baseWeights[key], 0) || 1;
    const engagementScore = available.reduce((sum, key) => sum + normalized[key][index] * baseWeights[key] / weightTotal, 0);
    const title = candidate.title || '';
    const destinationHit = cleanTitle(title).includes(cleanTitle(destination)) ? 0.55 : 0;
    const queryCoverage = Math.min(0.3, new Set(candidate.occurrences.map((item) => item.kind)).size * 0.1);
    const bestRank = Math.min(...candidate.occurrences.map((item) => item.rank ?? 99));
    const searchRank = Math.max(0, 0.15 * (1 - bestRank / 20));
    const relevanceScore = destinationHit + queryCoverage + searchRank;
    const denseMatches = title.match(DENSE_TERMS)?.length || 0;
    const informationDensity = Math.min(1, denseMatches * 0.22 + (candidate.cover ? 0.15 : 0) + (title.length >= 10 ? 0.15 : 0));
    return {
      ...candidate,
      score: Number((0.6 * engagementScore + 0.3 * relevanceScore + 0.1 * informationDensity).toFixed(6)),
      ranking: {
        engagementScore: Number(engagementScore.toFixed(6)),
        relevanceScore: Number(relevanceScore.toFixed(6)),
        informationDensity: Number(informationDensity.toFixed(6)),
        metricMissing: available.length ? ['likes', 'collects', 'comments', 'shares'].filter((key) => !candidate.metrics[key]) : ['likes', 'collects', 'comments', 'shares']
      }
    };
  }).sort((a, b) => b.score - a.score);
}

export function dedupeCandidates(ranked, { limit = 20, maxPerAuthor = 2, titleThreshold = 0.82 } = {}) {
  const selected = []; const authors = new Map(); const urls = new Set();
  for (const candidate of ranked) {
    if (candidate.sourceUrl && urls.has(candidate.sourceUrl)) continue;
    if (selected.some((item) => titleSimilarity(item.title, candidate.title) >= titleThreshold)) continue;
    const authorKey = candidate.authorId || candidate.author;
    if (authorKey && (authors.get(authorKey) || 0) >= maxPerAuthor) continue;
    selected.push(candidate);
    if (candidate.sourceUrl) urls.add(candidate.sourceUrl);
    if (authorKey) authors.set(authorKey, (authors.get(authorKey) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function selectBalancedCandidates(ranked, { limit = 20 } = {}) {
  const buckets = [
    { kinds: ['overview'], quota: 3 },
    { kinds: ['attraction', 'must_visit'], quota: 4 },
    { kinds: ['itinerary', 'route'], quota: 4 },
    { kinds: ['food'], quota: 3 },
    { kinds: ['stay'], quota: 3 },
    { kinds: ['pitfall', 'tips'], quota: 3 }
  ];
  let selected = [];
  const hasCandidate = (candidate) => selected.some((item) => item.feedId === candidate.feedId);
  const tryAdd = (candidate, selectedKind) => {
    const entry = { ...candidate, selectedKind: selectedKind || candidate.occurrences[0]?.kind || 'overview' };
    const next = dedupeCandidates([...selected, entry], { limit: selected.length + 1 });
    if (next.length === selected.length) return false;
    selected = next;
    return true;
  };
  for (const bucket of buckets) {
    let added = 0;
    for (const candidate of ranked) {
      if (hasCandidate(candidate)) continue;
      const kinds = new Set(candidate.occurrences.map((item) => item.kind));
      const selectedKind = bucket.kinds.find((kind) => kinds.has(kind));
      if (!selectedKind) continue;
      if (tryAdd(candidate, selectedKind) && ++added >= bucket.quota) break;
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (!hasCandidate(candidate)) tryAdd(candidate);
  }
  return selected.slice(0, limit);
}
