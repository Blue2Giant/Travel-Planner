import test from 'node:test';
import assert from 'node:assert/strict';
import { planQueries } from '../src/xiaohongshu/query-planner.js';
import { dedupeCandidates, rankCandidates, titleSimilarity } from '../src/xiaohongshu/ranking.js';
import { compressNote } from '../src/xiaohongshu/post-compressor.js';

test('query planner covers the required travel intents', () => {
  const queries = planQueries('香格里拉', { days: 3, season: '秋季' });
  assert.equal(queries.length, 10);
  assert.deepEqual(new Set(queries.map((item) => item.kind)), new Set([
    'overview', 'attraction', 'must_visit', 'itinerary', 'route', 'food', 'stay', 'pitfall', 'tips', 'season'
  ]));
});

test('candidate ranking favors useful engagement and deduplicates near-identical titles', () => {
  const base = {
    destination: '香格里拉', authorId: '', author: '', sourceUrl: '', cover: 'cover',
    occurrences: [{ kind: 'overview', rank: 0 }]
  };
  const ranked = rankCandidates([
    { ...base, feedId: 'a', title: '香格里拉三日游完整攻略', metrics: { likes: 100, collects: 500, comments: 20, shares: 3 } },
    { ...base, feedId: 'b', title: '香格里拉三日游完整攻略！', metrics: { likes: 90, collects: 450, comments: 18, shares: 2 } },
    { ...base, feedId: 'c', title: '随手拍香格里拉', metrics: { likes: 1000, collects: 2, comments: 1, shares: 0 } }
  ], '香格里拉');
  assert.equal(ranked[0].feedId, 'a');
  assert.ok(titleSimilarity(ranked[0].title, ranked[1].title) > 0.8);
  assert.equal(dedupeCandidates(ranked).length, 2);
});

test('post compressor rejects sentence fragments and extracts explicit entities', () => {
  const compact = compressNote({
    noteId: 'note-1', title: '香格里拉攻略',
    desc: '个人建议住独克宗古城里面，也离古城不远。Day1：独克宗古城➡️松赞林寺➡️纳帕海。第1站：📍独克宗古城 茶马古道上的千年古城。第2站：📍松赞林寺 依山而建宏伟藏传佛教寺。特色美食：牦牛肉火锅、酥油茶。⚠️刚到不要剧烈跑跳，注意高反。',
    user: { nickname: '作者' }, interactInfo: {}, imageList: []
  }, { kind: 'stay' });
  const places = compact.mentionedPlaces.map((item) => item.name);
  assert.ok(places.includes('独克宗古城'));
  assert.ok(places.includes('噶丹·松赞林寺'));
  assert.ok(!places.some((name) => name.includes('也离') || name.includes('依山而建')));
  assert.deepEqual(compact.hotelAreaMentions.map((item) => item.area), ['独克宗古城']);
  assert.ok(compact.foodMentions.some((item) => item.name === '牦牛肉火锅'));
});
