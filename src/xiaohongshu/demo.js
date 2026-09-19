import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSlug } from './guide.js';

export async function writeDemoPosts(destination) {
  const slug = fileSlug(destination);
  const posts = [
    { feedId: 'demo-001', title: `${destination}三日慢游示例`, author: '示例旅行者 A', mentionedPlaces: [{ name: '核心景点', reason: '安排在上午，预留步行与休息时间。' }], tips: ['热门地点建议提前确认开放时间。'] },
    { feedId: 'demo-002', title: `${destination}景点动线示例`, author: '示例旅行者 B', mentionedPlaces: [{ name: '核心景点', reason: '与周边街区可安排为同一天。' }], hotelAreaMentions: [{ area: '交通枢纽附近', goodFor: '首次到访、行程紧凑的旅客', pros: ['换乘方便'], cons: ['高峰时段较嘈杂'] }] },
    { feedId: 'demo-003', title: `${destination}吃喝示例`, author: '示例旅行者 C', foodMentions: [{ name: '当地特色小吃', category: '特色类别', reason: '适合作为步行途中补给。' }], tips: ['餐厅高峰可能需要排队，尽量错峰。'] }
  ];
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/raw', `${slug}-posts.json`);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ posts }, null, 2));
  return file;
}
