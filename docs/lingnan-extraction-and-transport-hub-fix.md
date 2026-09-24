# 岭南目的地：实体抽取与交通枢纽归一

## 背景

用编排器生成「深圳 → 顺德 2026-10-02—10-07」规划时，实时链路本身是健康的：

- 小红书只读检索：10 个查询、113 个去重候选、抓取 25 篇详情、0 失败，`08_validation_report.json` 全部检查通过。
- 高德、携程均可正常调用。

但流程在 `planner.js` 的「没有找到同时满足多帖共识和高德 POI 可验证的景点」处直接抛错。根因有两个，都不在检索侧，而在归一化与查询口径。

## 问题一：抽取词表只覆盖滇西北

`src/xiaohongshu/post-compressor.js` 的后缀与菜名词表是按香格里拉 / 丽江调的：

- `PLACE_SUFFIX` 只认 `古城|寺|湖|雪山|峡谷|草原|公园|村|塔|广场|景区|博物馆|市场|湿地|江|山|海`。顺德的「清晖园」「渔人码头」「华盖路步行街」「逢简水乡」都不匹配。
- `CANONICAL_FOODS` 全是「牦牛肉火锅 / 酥油茶 / 青稞饼」这类滇西北菜名，粤菜的「双皮奶 / 鱼生 / 陈村粉」完全识别不到。
- `stayAreas` 的后缀同样只认 `古城|市区|县城|车站|机场`，抓不到「住清晖园附近」这种说法。

结果是 25 篇帖子只抽出 23 个 `mentionedPlaces`，且多为噪声（如「捕捉灯塔」），没有任何地点出现在 ≥2 篇帖子中，共识景点为 0。

### 修复

1. **地标白名单 `CANONICAL_PLACES`**：岭南地标没有统一后缀（园 / 街 / 码头 / 水乡 / PLUS），依赖后缀正则既漏召回又会把「岭南四大名园」当成地点。因此改为按全名精确匹配，与既有的 `CANONICAL_FOODS` 同一思路。
2. **别名归一**：`顺峰山 → 顺峰山公园`、`华盖路 → 华盖路步行街`、`欢乐海岸 → 欢乐海岸PLUS`，避免同一地点被拆成两个候选而各自达不到多帖共识。
3. **粤菜词表**：扩充 `FOOD_SUFFIX` 与 `CANONICAL_FOODS`。
4. **菜名归一 `normalizeFoodName`**：正文里菜名常与描述黏在一起（「品尝最地道的双皮奶」）。命中标准菜名时直接归一，否则去掉前缀动词；仍像整句的候选丢弃。
5. **住宿范围**：`stayAreas` 增加 `园|街|路|广场|商圈|海岸|码头` 后缀与 `住宿建议|住宿推荐` 等前缀，并把「清晖园附近」归一到「清晖园」，避免同片区被拆散。
6. **后缀「园」的护栏**：把 `名园|园林|花园|乐园|庄园|家园` 与 `前往|抵达|位于|推荐去` 加入 `BAD_ENTITY_PATTERNS`。
7. **注意事项切分**：小红书正文常用「1️⃣2️⃣3️⃣」或「1. 2.」罗列注意事项。原来只按句号切分，整段列表会挤成一条长句再被截断成读不通的碎片（例如「但建议只拍照不吃饭，那里餐饮性价比低 - 8️⃣顺峰山公园是意外惊喜」）。现在 `tips()` 也会在序号处断开，并剥离序号与 `⚠️` 等前缀。

修复后同一批已保存帖子（`regenerateFromSavedDetails`，不重新抓取）产出：7 个共识景点（清晖园 13 帖、华盖路步行街 8 帖、渔人码头 7 帖、金榜上街 6 帖、欢乐海岸PLUS 5 帖、顺峰山公园 5 帖、逢简水乡 3 帖）、21 个规范菜名、1 个住宿范围。

## 问题二：区级目的地没有直达铁路

顺德的铁路枢纽是广珠城际的顺德站，深圳没有直达车次。`planTransport` 直接用 `深圳 → 顺德` 查询，携程返回「卡片已渲染但找不到车次锚点」，去程 / 返程都被判为不可用，校验标记 `complete: false`。

### 修复

新增 `src/ctrip/airport-codes.js` 的 `TRANSPORT_CITY_ALIASES` 与 `resolveTransportCity()`：把市辖区 / 县级市归一到最近的枢纽城市（顺德 → 佛山），并补上 `佛山: 'FUO'` 机场映射。

`planTransport` 用归一后的城市查询航班与列车，同时保留用户输入的原始地名用于展示，并通过 `describeTransportCity()` 生成一段说明，渲染在交通区块（`.hub-note`）。车站名仍取自携程返回值，因此页面显示的是真实的「深圳北 → 佛山西」。

## 问题三：酒店候选散布全市

携程 `hotel-search` 只接受城市 ID。顺德属于佛山（cityId 251），首屏候选覆盖禅城、南海、三水等区，`keyword` 过滤又因为 `district` 字段其实是地标描述而无法命中。

`planHotels` 改为：请求 20 条候选，用高德把「小红书推荐住宿范围」解析成坐标，按到该范围的距离重排，并把距离写进 `advantages`（`distance_km`）。

**仍未解决的上游限制**：佛山首屏候选里没有大良的酒店，最近的一家在北滘（距清晖园约 11.6 km），其余 21—37 km。这是携程首屏覆盖面的问题，不是排序问题；如需住在清晖园步行范围，应在携程按「大良」直接检索。

## 问题四：携程持久浏览器会话被反爬状态污染

反复探测后，`opencli ctrip hotel-search`（随后连 `train` 也）持续返回 `Navigation rejected`，而 `opencli doctor` 显示 daemon 与扩展连接正常。`opencli daemon restart` 只能恢复一部分命令，酒店搜索仍然失败。

原因是反爬状态黏在**持久浏览器会话**上，此后每次导航都被拒绝。实测 `--site-session ephemeral`（一次性会话）可以立刻恢复。

`runOpencli` 原本就会对 `Navigation rejected` 重试，现在把重试升级为一次性会话：

```js
if (retries > 0 && /Navigation rejected/i.test(message)) {
  return resolve(runOpencli(command, args, { timeoutMs, retries: retries - 1, siteSession: 'ephemeral' }));
}
```

这样不需要人工干预就能自愈，同时保留原有的失败留痕（`--trace retain-on-failure`）。

## 影响范围

- `src/xiaohongshu/post-compressor.js`：抽取词表、地标白名单、别名、菜名与住宿范围归一。
- `src/ctrip/airport-codes.js`：新增区级 → 枢纽城市映射。
- `src/ctrip/opencli.js`：导航被拒时用一次性会话重试。
- `src/travel-plan/planner.js`：交通查询走枢纽城市；酒店按住宿范围距离重排。
- `src/travel-plan/report.js`：渲染 `hub_note`。

`npm run check` 与 9 项单测全部通过。
