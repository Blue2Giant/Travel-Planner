#!/usr/bin/env node
// 仅重渲染：读取已保存的 TravelPlan JSON 并重新生成 HTML。
// 完整编排（小红书 + 携程 + 高德）一轮约 11 分钟，纯展示层改动不应触发全流程重跑。
import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderTravelPlan } from '../src/travel-plan/report.js';

const planFile = process.argv[2];
if (!planFile) throw new Error('用法：node scripts/render-plan.js <plan.json> [out.html]');
const plan = JSON.parse(await readFile(planFile, 'utf8'));
const slug = path.basename(planFile).replace(/\.json$/, '');
const htmlFile = process.argv[3] || path.join('output', `${slug}.html`);
await mkdir(path.dirname(htmlFile), { recursive: true });
await writeFile(htmlFile, renderTravelPlan(plan, {
  amapJsKey: process.env.AMAP_JSAPI_KEY || '',
  securityJsCode: process.env.AMAP_JSAPI_SECURITY_CODE || ''
}));
console.log(JSON.stringify({ htmlFile, days: plan.days?.length, complete: plan.validation?.complete }, null, 2));
