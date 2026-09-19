import 'dotenv/config';
import express from 'express';
import { resolvePlace } from './src/amap/poi.js';
import { getDrivingRoute } from './src/amap/driving.js';
import { getTransitRoute } from './src/amap/transit.js';
import { publicPlace } from './src/amap/normalize.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileSlug, generateGuide } from './src/xiaohongshu/guide.js';
import { writeDemoPosts } from './src/xiaohongshu/demo.js';
import { researchAndGenerate } from './src/xiaohongshu/research.js';
import { flights, trains, hotels } from './src/ctrip/service.js';
import { opencliError } from './src/ctrip/opencli.js';
import { writeCtripReport } from './src/ctrip/report.js';
import { z } from 'zod';
import { generateTravelPlan } from './src/travel-plan/orchestrator.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.get('/api/config', (_req, res) => res.json({ amapJsKey: process.env.AMAP_JSAPI_KEY || '', securityJsCode: process.env.AMAP_JSAPI_SECURITY_CODE || '' }));
app.post('/api/routes', async (req, res) => {
  const { origin, destination } = req.body || {};
  if (!origin?.trim() || !destination?.trim()) return res.status(400).json({ error: '请填写起点和终点。' });
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'AMAP_WEB_SERVICE_KEY is not configured. Please configure it in .env.' });
  try {
    const [from, to] = await Promise.all([resolvePlace(origin.trim(), key), resolvePlace(destination.trim(), key)]);
    const [driving, transit] = await Promise.allSettled([getDrivingRoute(from, to, key), getTransitRoute(from, to, key)]);
    if (driving.status === 'rejected' && transit.status === 'rejected') throw driving.reason;
    res.json({ origin: publicPlace(from), destination: publicPlace(to), driving: driving.status === 'fulfilled' ? driving.value : null, transit: transit.status === 'fulfilled' ? transit.value : null, warnings: [driving, transit].filter((item) => item.status === 'rejected').map((item) => item.reason.message) });
  } catch (error) {
    const status = error.status || (error.message === 'PLACE_NOT_FOUND' ? 400 : 502);
    res.status(status).json({ error: error.message || '请求路线时发生错误。' });
  }
});
app.post('/api/guides', async (req, res) => {
  const { destination, posts, demo = false } = req.body || {};
  if (!destination?.trim()) return res.status(400).json({ error: '请填写目的地。' });
  try {
    if (demo) await writeDemoPosts(destination);
    if (posts) {
      if (!Array.isArray(posts)) return res.status(400).json({ error: 'posts 必须是帖子数组。' });
      const file = path.resolve('data/raw', `${fileSlug(destination)}-posts.json`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ posts }, null, 2));
    }
    const result = await generateGuide(destination, { demo });
    res.status(201).json({ ...result, htmlUrl: `/guides/${encodeURIComponent(path.basename(result.htmlFile))}` });
  } catch (error) { res.status(400).json({ error: error.message || '生成攻略失败。' }); }
});
app.post('/api/xiaohongshu/guides', async (req, res) => {
  const { destination } = req.body || {};
  if (!destination?.trim()) return res.status(400).json({ error: '请填写目的地。' });
  try {
    const result = await researchAndGenerate(destination.trim());
    res.status(201).json({ ...result, htmlUrl: `/guides/${encodeURIComponent(path.basename(result.htmlFile))}` });
  } catch (error) { res.status(502).json({ error: error.message || '生成小红书攻略失败。' }); }
});
app.post('/api/ctrip/search', async (req, res) => {
  const { kind, ...input } = req.body || {};
  const search = { flights, trains, hotels }[kind];
  if (!search) return res.status(400).json({ error: 'kind 必须是 flights、trains 或 hotels。' });
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const commonLimit = z.number().int().min(1).max(20).optional();
  const schemas = {
    flights: z.object({ origin: z.string().trim().min(1), destination: z.string().trim().min(1), date, max_price: z.number().positive().optional(), limit: commonLimit, sort_by: z.enum(['price']).optional() }),
    trains: z.object({ origin: z.string().trim().min(1), destination: z.string().trim().min(1), date, train_types: z.array(z.enum(['G', 'D', 'C', 'Z', 'T', 'K'])).optional(), limit: commonLimit }),
    hotels: z.object({ city: z.string().trim().min(1), checkin: date, checkout: date, keyword: z.string().trim().max(80).optional(), min_star: z.number().min(1).max(5).optional(), min_score: z.number().min(0).max(5).optional(), max_price: z.number().positive().optional(), limit: commonLimit })
  };
  try { res.json(await search(schemas[kind].parse(input))); }
  catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: '输入参数无效。', details: error.issues });
    const issue = opencliError(error); res.status(issue.code === 'INVALID_CITY' ? 400 : 502).json({ error: issue.message, code: issue.code });
  }
});
app.post('/api/ctrip/report', async (req, res) => {
  const { kind, data } = req.body || {};
  if (!['flights', 'trains', 'hotels'].includes(kind) || !data?.results) return res.status(400).json({ error: '缺少可生成报告的查询结果。' });
  const result = await writeCtripReport(kind, data);
  res.status(201).json({ ...result, htmlUrl: '/guides/ctrip-report.html' });
});
app.post('/api/travel-plans', async (req, res) => {
  const input = req.body || {};
  if (!input.destination && !input.destinations) return res.status(400).json({ error: '请填写目的地。' });
  if (!input.start_date || !input.end_date) return res.status(400).json({ error: '请填写开始和结束日期。' });
  try {
    const result = await generateTravelPlan(input);
    res.status(201).json({ ...result.plan, htmlUrl: `/guides/${encodeURIComponent(path.basename(result.htmlFile))}`, files: { request: result.requestFile, plan: result.planFile, html: result.htmlFile } });
  } catch (error) { res.status(400).json({ error: error.message || '生成旅游规划失败。' }); }
});
app.use('/guides', express.static('output'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Travel Planner Demos: http://localhost:${port}`));
