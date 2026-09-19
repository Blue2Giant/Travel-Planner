#!/usr/bin/env node
// Writes a previously captured MCP response from stdin. Codex should call only
// check_login_status, search_feeds and get_feed_detail before using this helper.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileSlug } from '../src/xiaohongshu/guide.js';

const [destination, kind, feedId] = process.argv.slice(2);
if (!destination || !kind) {
  console.error('用法：<destination> <search|detail> [feedId]；MCP JSON 由 stdin 输入。');
  process.exit(1);
}
let text = '';
for await (const chunk of process.stdin) text += chunk;
try { JSON.parse(text); } catch { console.error('stdin 必须是有效的 MCP JSON。'); process.exit(1); }
const slug = fileSlug(destination);
const file = kind === 'search'
  ? path.resolve('data/raw', `${slug}-search.json`)
  : path.resolve('data/raw/posts', `${feedId}.json`);
if (kind === 'detail' && !feedId) { console.error('保存 detail 需要 feedId。'); process.exit(1); }
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, text);
console.log(file);
