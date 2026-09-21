# Travel-Planner 多 Agent / 多 Loop 优化实施计划

> 适用仓库：`Blue2Giant/Travel-Planner`
>
> 目标：解决当前 HTML 的图片缺失、每日高德路线节点错误、地图 Marker 过重、景点/美食缺少可追溯原帖、来源区过长，以及单 Agent 一次性生成整份攻略导致质量不稳定的问题。
>
> 最重要的架构原则：
>
> **Agent 负责研究与生成结构化 JSON；确定性代码负责地图、图片缓存、链接、HTML 渲染和校验。**
>
> 不允许多个 Agent 直接同时修改同一个最终 HTML。

---

## 1. 当前问题定位

当前问题不是单纯的 CSS / UI 问题，而是数据模型和生成链路混在了一起。

### 1.1 每日地图把酒店 / 抵达 / 休息节点也当作路线节点

当前 `timeline` 内同时存在：

```text
hotel
attraction
transport
rest
```

但地图生成逻辑直接使用 `day.map.points` / `day.map.legs`。

因此容易生成：

```text
酒店 → 景点 A → 景点 B
机场 / 市中心 → 景点
酒店 → 单个景点
```

而实际需求应该是：

```text
只显示当天规划的景点之间的路线
```

即：

```text
attraction A → attraction B → attraction C
```

以下节点全部禁止进入每日景点路线图：

```text
hotel
transport
rest
free_time
meal
arrival
departure
```

---

### 1.2 地图 Marker 承担了太多职责

当前 Marker 同时显示：

```text
图片
起 / 终
景点名称
点击放大
```

地图应该只负责：

```text
位置
顺序
路线
```

景点图片应放回 timeline / attraction card。

---

### 1.3 小红书图片直接依赖远程 CDN

当前 HTML 直接引用：

```text
sns-webpic-*.xhscdn.com
```

此类 URL 可能因为：

```text
URL 时效
防盗链
登录态
请求失败
资源迁移
```

导致图片消失。

并且当前前端在图片加载失败后会直接删除图片节点，因此页面会变成：

```text
暂无图片
```

解决办法不是继续修 `<img>`，而是：

```text
XHS image URL
      ↓
download
      ↓
local cache
      ↓
vision verify
      ↓
thumbnail
      ↓
HTML 使用本地相对路径
```

---

### 1.4 景点 / 美食和原始证据没有一一绑定

目前的逻辑更接近：

```text
景点卡片
美食卡片

...

页面最下面：
几十篇小红书来源
```

用户无法知道：

```text
这段推荐来自哪篇帖子？
这张图片来自哪篇帖子？
这个美食是谁推荐的？
```

必须改成：

```text
Attraction / Food
        ↓
source_refs[]
        ↓
XHS Source Registry
        ↓
原帖 URL
```

---

# 2. 推荐的总体架构

建议把项目变成一个 **Orchestrator + 多个 Section Agent Loop + 确定性 Renderer** 的结构。

```text
                         User Request
                              │
                              ▼
                      Trip Orchestrator
                              │
      ┌───────────────┬───────┼────────┬──────────────┐
      ▼               ▼       ▼        ▼              ▼
 XHS Research     Transport  Hotel    Itinerary      Pitfall
 Agent Loop       Agent      Agent     Agent           Agent
      │               │       │        │              │
      └───────────────┴───────┴────────┴──────────────┘
                              │
                              ▼
                    Structured Trip Store
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
  Attraction Agent       Food Agent         Media Agent
       Loop                 Loop             + Vision QA
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                       Daily Route Agent
                              │
                              ▼
                     Cross-section Validator
                              │
                              ▼
                   Deterministic HTML Renderer
                              │
                              ▼
                     Browser / Visual QA Agent
                              │
                         FAIL │ PASS
                              ▼
                    targeted repair loop
```

---

# 3. 最重要的设计原则

## 原则 A：Agent 不直接写最终 HTML

Agent 输出：

```json
{
  "section": "attractions",
  "data": [...]
}
```

最终：

```text
JSON
 ↓
renderer
 ↓
HTML
```

这样可以避免：

```text
Agent A 改地图时破坏美食
Agent B 改图片时破坏来源
Agent C 重写 HTML 时丢掉 JS
```

---

## 原则 B：每一个 Section 都能单独执行

要求支持：

```bash
npm run pipeline -- --section attractions
npm run pipeline -- --section food
npm run pipeline -- --section media
npm run pipeline -- --section route --day 2
npm run pipeline -- --section hotel
npm run pipeline -- --section transport
npm run pipeline -- --section render
npm run pipeline -- --section qa
```

也支持：

```bash
npm run pipeline -- --all
```

---

## 原则 C：每个 Loop 都有 Validator

Agent 不应该：

```text
生成一次 → 直接使用
```

而应该：

```text
generate
   ↓
validate
   ↓
critic
   ↓
PASS → save
FAIL → targeted retry
```

每个 loop 最多：

```text
2 次修复
```

超过次数：

```text
标记 unresolved
继续生成其他板块
不要让整个旅行报告失败
```

---

# 4. 推荐目录重构

保持你现在的：

```text
server.js
src/
public/
data/
output/
```

建议增加：

```text
src/
├── agents/
│   ├── orchestrator.js
│   ├── xhs-research-agent.js
│   ├── itinerary-agent.js
│   ├── attraction-agent.js
│   ├── food-agent.js
│   ├── hotel-agent.js
│   ├── transport-agent.js
│   ├── pitfall-agent.js
│   ├── route-agent.js
│   ├── media-agent.js
│   └── qa-agent.js
│
├── pipelines/
│   ├── run-all.js
│   ├── run-section.js
│   ├── run-attractions.js
│   ├── run-food.js
│   ├── run-media.js
│   ├── run-routes.js
│   ├── run-render.js
│   └── run-qa.js
│
├── schema/
│   ├── trip.schema.js
│   ├── timeline.schema.js
│   ├── attraction.schema.js
│   ├── food.schema.js
│   ├── source.schema.js
│   ├── media.schema.js
│   └── route.schema.js
│
├── media/
│   ├── downloader.js
│   ├── cache.js
│   ├── thumbnail.js
│   └── vision-review.js
│
├── validators/
│   ├── attraction-validator.js
│   ├── food-validator.js
│   ├── source-validator.js
│   ├── media-validator.js
│   ├── route-validator.js
│   └── html-validator.js
│
└── render/
    ├── html-renderer.js
    └── sections/
        ├── overview.js
        ├── transport.js
        ├── hotels.js
        ├── days.js
        ├── attractions.js
        ├── food.js
        ├── pitfalls.js
        └── sources.js

data/
├── raw/
│   └── xhs/
├── processed/
│   └── trips/
└── media/
    └── <trip_id>/
        └── <note_id>/
            ├── original-01.webp
            ├── thumb-01.webp
            └── review.json
```

---

# 5. 统一 Timeline Schema

必须先把节点类型明确。

```json
{
  "id": "day2-stop-01",
  "day": 2,
  "time": "09:00",
  "type": "attraction",
  "title": "噶丹·松赞林寺",
  "place": "噶丹·松赞林寺",
  "coordinates": {
    "lng": 99.705525,
    "lat": 27.859991
  },
  "attraction_id": "香格里拉-噶丹松赞林寺"
}
```

允许：

```text
attraction
food
hotel
transport
rest
free_time
```

---

# 6. 每日路线图 Agent Loop

这是本轮最高优先级。

## 6.1 只允许 attraction 进入 daily map

核心代码必须类似：

```js
const mapStops = day.timeline.filter(
  item => item.type === "attraction"
);
```

绝对不能再：

```js
const mapStops = day.timeline;
```

---

## 6.2 每日地图显示规则

### 0 个景点

```text
不渲染地图
```

页面显示：

```text
今天没有需要绘制的景点路线
```

---

### 1 个景点

```text
● 景点 A
```

只显示一个圆点。

不调用路线 API。

不画 polyline。

---

### 2 个景点

```text
● A ───────── ● B
```

A：

```text
绿色圆点
```

B：

```text
橙红色圆点
```

---

### >= 3 个景点

```text
● A ─ ○ B ─ ○ C ─ ● D
```

颜色：

```text
start     #2c7a5b
waypoint  #64748b
end       #c65d3b
```

---

# 7. 地图 Marker 改造

## 删除

地图 Marker 中不再包含：

```text
图片
“起”
“终”
大段文字
```

---

## 新 Marker

```js
function createDotMarker(map, point, role) {
  const className =
    role === "start"
      ? "map-dot start"
      : role === "end"
      ? "map-dot end"
      : "map-dot waypoint";

  return new AMap.Marker({
    map,
    position: [point.lng, point.lat],
    content: `<div class="${className}"></div>`,
    offset: new AMap.Pixel(-7, -7),
    title: point.name
  });
}
```

CSS：

```css
.map-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 3px solid #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,.22);
}

.map-dot.start {
  background: #2c7a5b;
}

.map-dot.end {
  background: #c65d3b;
}

.map-dot.waypoint {
  background: #64748b;
}
```

---

# 8. 地图内删除景点缩略图

地图只显示：

```text
路线
圆点
地图底图
```

景点图片放在左侧 timeline：

```text
09:00

[缩略图]
噶丹·松赞林寺
建议 2h

来自 3 篇攻略
查看原帖 ↗
```

---

# 9. Polyline 必须重新生成

不要复用：

```text
hotel → attraction
```

得到的 geometry。

修改行程后：

```text
A attraction
     ↓
B attraction
     ↓
C attraction
```

必须重新调用高德：

```text
A → B
B → C
```

生成：

```json
legs[]
```

---

# 10. Route Agent Loop

```text
INPUT
  day.timeline
      │
      ▼
filter type=attraction
      │
      ▼
POI normalize
      │
      ▼
coordinate validate
      │
      ▼
AMap route A → B
      │
      ▼
AMap route B → C
      │
      ▼
endpoint QA
      │
      ▼
route critic
      │
 ┌────┴────┐
PASS      FAIL
 │          │
save     retry POI / route
```

最多：

```text
2 retries
```

---

# 11. 解决“路线末端和景点圆点连不上”

这是正常的导航 API 行为之一：

```text
景区 POI 坐标
```

可能位于：

```text
景区中心
建筑中心
湖中心
古城中心
```

而驾车路线终点必须吸附到：

```text
可通行道路
停车点
入口
```

所以不能简单把两者当成错误 polyline。

新增：

```js
validateRouteEndpoint()
```

计算：

```text
start_gap_m
end_gap_m
```

建议阈值：

```text
0 - 100m       PASS
100 - 300m     WARN
> 300m         FAIL
```

---

## FAIL 修复策略

### Step 1

重新查：

```text
景区入口
游客中心
停车场
南门
北门
```

### Step 2

重新跑高德路线。

### Step 3

仍有距离：

不要画一条假的实线。

使用：

```text
navigation polyline
+
last mile connector
```

connector 用：

```text
灰色虚线
```

表示：

```text
道路终点 → 景点 POI
```

---

# 12. Route JSON

```json
{
  "day": 2,
  "points": [
    {
      "id": "attr-songzanlin",
      "name": "噶丹·松赞林寺",
      "lng": 99.705525,
      "lat": 27.859991,
      "role": "start"
    },
    {
      "id": "attr-guishan",
      "name": "龟山公园",
      "lng": 99.706408,
      "lat": 27.810998,
      "role": "end"
    }
  ],
  "legs": [
    {
      "from_id": "attr-songzanlin",
      "to_id": "attr-guishan",
      "mode": "driving",
      "distance_m": 6200,
      "duration_min": 18,
      "polyline": [],
      "endpoint_validation": {
        "start_gap_m": 13,
        "end_gap_m": 42,
        "status": "pass"
      }
    }
  ]
}
```

---

# 13. Attraction Agent Loop

不要让一个 Agent 从几十篇帖子里直接“凭感觉”写景点。

链路：

```text
XHS search
   │
   ▼
post detail
   │
   ▼
candidate attraction extraction
   │
   ▼
entity normalize
   │
   ▼
AMap POI verify
   │
   ▼
source binding
   │
   ▼
image candidate extraction
   │
   ▼
Vision Review
   │
   ▼
content critic
   │
   ▼
final attraction JSON
```

---

## 13.1 Attraction JSON

```json
{
  "id": "丽江-白沙古镇",
  "name": "白沙古镇",
  "city": "丽江",

  "poi": {
    "name": "白沙古镇",
    "lng": 100.216933,
    "lat": 26.953303,
    "amap_verified": true
  },

  "summary": "...",

  "duration_minutes": 120,

  "primary_source_id": "xhs-note-abc",

  "source_refs": [
    "xhs-note-abc",
    "xhs-note-def"
  ],

  "media_refs": [
    "media-xhs-note-abc-02"
  ]
}
```

---

# 14. Food Agent Loop

不要再只输出：

```text
牦牛肉火锅
当地推荐
```

Food entity 分为：

```text
dish
restaurant
```

---

## 14.1 Dish

```json
{
  "id": "food-yak-hotpot",
  "entity_type": "dish",
  "name": "牦牛肉火锅",
  "city": "香格里拉",

  "summary": "...",

  "primary_source_id": "xhs-note-123",

  "source_refs": [
    "xhs-note-123",
    "xhs-note-456"
  ],

  "media_refs": [
    "media-xhs-note-123-03"
  ]
}
```

---

## 14.2 Restaurant

如果帖子明确推荐店铺：

```json
{
  "id": "restaurant-xxx",
  "entity_type": "restaurant",

  "name": "XXX牦牛肉火锅",

  "poi": {
    "amap_verified": true
  },

  "source_refs": [
    "xhs-note-123"
  ]
}
```

---

# 15. 给 Codex 增加“看图能力”

Codex CLI 本身可以查看本地图片。

推荐实现不是让 Codex 直接看远程 URL，而是：

```text
XHS MCP
   ↓
image URL
   ↓
download local
   ↓
Codex / Vision Reviewer
   ↓
review.json
```

---

## 15.1 最简单方案

下载图片后：

```bash
codex -i data/media/note123/01.webp \
  "判断这张图是否和白沙古镇相关，并输出 JSON"
```

多图：

```bash
codex --image a.jpg,b.jpg,c.jpg \
  "逐张判断哪些图片可用于白沙古镇景点卡片"
```

---

## 15.2 更推荐的自动化方案

实现：

```text
src/media/vision-review.js
```

输入：

```json
{
  "target_type": "attraction",
  "target_name": "白沙古镇",
  "source_title": "...",
  "source_text": "...",
  "image_path": "..."
}
```

输出：

```json
{
  "relevant": true,
  "score": 0.91,

  "visible_entities": [
    "古镇街道",
    "传统建筑"
  ],

  "ocr_text": [
    "白沙..."
  ],

  "reason": "..."
}
```

---

# 16. Vision Review 规则

## Attraction

模型需要判断：

```text
图片是否展示目标景点
是否只是地图截图
是否只是酒店
是否只是自拍
是否只是无关风景
是否是其他景点
```

建议：

```text
score >= 0.75 → accept
0.5 - 0.75    → secondary
< 0.5         → reject
```

---

## Food

模型判断：

```text
目标菜品是否出现
餐厅招牌是否出现
菜单是否出现
是不是完全无关食物
是不是人物自拍为主
```

---

# 17. 图片必须本地缓存

新增：

```text
src/media/downloader.js
```

---

## 工作流程

```text
remote_url
   ↓
download
   ↓
HTTP status check
   ↓
decode check
   ↓
minimum size check
   ↓
SHA256
   ↓
local file
   ↓
thumbnail
```

---

## 推荐目录

```text
public/
└── media/
    └── <trip_id>/
        └── <note_id>/
            ├── 01.webp
            ├── 01-thumb.webp
            ├── 02.webp
            └── 02-thumb.webp
```

最终 HTML：

```html
<img
  src="./media/trip_xxx/note_xxx/01-thumb.webp"
  data-fullsrc="./media/trip_xxx/note_xxx/01.webp"
>
```

不要再：

```html
<img src="https://sns-webpic-qc.xhscdn.com/...">
```

---

# 18. 图片 fallback

当前做法不要再：

```js
onerror="this.remove()"
```

应该：

```text
image failed
    ↓
replace with placeholder
```

例如：

```html
<div class="media-placeholder">
  暂无已核验图片
</div>
```

避免整个 gallery 布局塌掉。

---

# 19. Source Registry

所有 XHS 链接统一管理。

```json
{
  "source_id": "xhs-6a59ab31000000001303f42e",

  "platform": "xiaohongshu",

  "note_id": "6a59ab31000000001303f42e",

  "title": "香格里拉旅游后的真实感受。。。",

  "author": "不温柔的小格",

  "canonical_url":
    "https://www.xiaohongshu.com/explore/6a59ab31000000001303f42e",

  "retrieved_url":
    "https://www.xiaohongshu.com/explore/...?...",

  "retrieved_at":
    "2026-09-20T..."
}
```

建议同时保留：

```text
canonical_url
retrieved_url
note_id
```

renderer 默认优先使用：

```text
canonical_url
```

必要时可以 fallback：

```text
retrieved_url
```

---

# 20. 所有推荐卡片必须有原帖

强制 Validator：

```text
attraction.source_refs.length >= 1
food.source_refs.length >= 1
pitfall.source_refs.length >= 1
```

否则：

```text
FAIL
```

不允许生成：

```text
“原帖有推荐”
```

却没有 URL。

---

# 21. 景点 / 美食卡片 UI

每张卡片底部：

```text
3 篇小红书帖子共同提及

查看主要原帖 ↗
查看全部来源（3）
```

---

## HTML

```html
<footer class="evidence-footer">

  <a
    href="..."
    target="_blank"
    rel="noopener noreferrer"
    class="primary-source"
  >
    查看原帖 ↗
  </a>

  <details class="card-sources">
    <summary>
      查看全部来源（3）
    </summary>

    <ul>
      ...
    </ul>
  </details>

</footer>
```

---

# 22. Attraction Card 新布局

建议：

```text
┌──────────────────────────────────────────────┐
│ [主图]     白沙古镇                         │
│            丽江                             │
│            推荐停留 2h                     │
│                                              │
│            简短总结                          │
│                                              │
│            小红书 5 篇提及                  │
│            查看原帖 ↗                       │
│            ▼ 查看全部来源                   │
└──────────────────────────────────────────────┘
```

不要一次展示 3 张以上大图。

建议：

```text
1 张主图
+
2 张缩略图
```

---

# 23. Food Card 新布局

```text
┌────────────────────────┐
│ [food image]           │
│                        │
│ 牦牛肉火锅             │
│ 香格里拉               │
│                        │
│ 推荐原因               │
│                        │
│ 3 篇帖子提及           │
│ 查看原帖 ↗             │
│ ▼ 查看全部来源         │
└────────────────────────┘
```

---

# 24. 页面底部 Sources 改成折叠

当前几十条链接全部展开，信息密度太高。

改为：

```html
<section id="sources">

  <h2>参考来源</h2>

  <button id="expand-all-sources">
    展开全部
  </button>

  <details class="source-group">
    <summary>
      景点来源 · 20
    </summary>
    ...
  </details>

  <details class="source-group">
    <summary>
      美食来源 · 12
    </summary>
    ...
  </details>

  <details class="source-group">
    <summary>
      住宿来源 · 8
    </summary>
    ...
  </details>

  <details class="source-group">
    <summary>
      避坑来源 · 10
    </summary>
    ...
  </details>

</section>
```

默认：

```text
closed
```

---

# 25. “全部展开 / 全部收起”

```js
const sourceDetails =
  [...document.querySelectorAll('.source-group')];

button.onclick = () => {
  const shouldOpen =
    sourceDetails.some(x => !x.open);

  sourceDetails.forEach(x => {
    x.open = shouldOpen;
  });

  button.textContent =
    shouldOpen
      ? '全部收起'
      : '展开全部';
};
```

---

# 26. XHS Research Agent Loop

此 Agent 只负责：

```text
搜索
抓详情
保留来源
保留图片 URL
```

不要做最终总结。

```text
query
  ↓
XHS search
  ↓
fetch note details
  ↓
dedupe
  ↓
normalize source
  ↓
save raw evidence
```

输出：

```text
data/raw/xhs/<trip_id>.json
```

---

# 27. Attraction Agent Prompt 约束

核心规则：

```text
你不是网页生成器。

你的任务是：
1. 从 evidence 中选择真正和目标景点相关的内容
2. 不添加 evidence 中不存在的事实
3. 所有结论必须输出 source_refs
4. 每个 source_ref 必须存在于 Source Registry
5. 如果证据不足，返回 insufficient_evidence
6. 不输出 HTML
```

---

# 28. Food Agent Prompt 约束

```text
你不是根据常识写当地美食。

只允许根据当前 XHS evidence 推荐。

每个 food item 必须：
- 有 source_refs
- 指定 dish / restaurant
- 至少一个 primary_source_id
- 不得虚构店铺名称
```

---

# 29. Hotel Agent Loop

住宿板块单独工作。

```text
XHS
 ↓
提取住宿区域
 ↓
AMap / Ctrip location normalize
 ↓
Ctrip candidates
 ↓
distance-to-itinerary validation
 ↓
rank / summarize
 ↓
hotel JSON
```

Hotel Agent 不应该：

```text
直接修改每日路线
```

---

# 30. Transport Agent Loop

```text
origin / destination / date
 ↓
flight / train query
 ↓
normalize
 ↓
invalid option filter
 ↓
transport critic
 ↓
transport JSON
```

必须过滤类似：

```text
¥0
机场字段异常
到达早于出发
城市代码和机场名称不一致
```

这类明显解析错误。

---

# 31. Itinerary Agent Loop

Itinerary Agent 只决定：

```text
哪一天
去哪些景点
顺序
大致时间
```

它不负责：

```text
画地图
找图片
写 HTML
```

输出：

```json
{
  "day": 3,
  "timeline": [...]
}
```

随后：

```text
Route Agent
```

再生成地图。

---

# 32. Pitfall Agent Loop

避坑内容必须：

```text
claim
source_refs
applicable_place
applicable_date
```

不要把几十句帖子原文直接塞入页面。

输出精简：

```text
索道票提前购买
上午某时段拥堵
某入口容易误下车
```

---

# 33. Media Agent Loop

```text
source image URLs
      ↓
download
      ↓
decode check
      ↓
visual review
      ↓
dedupe
      ↓
thumbnail generation
      ↓
media registry
```

---

## Media Registry

```json
{
  "media_id": "media-note123-02",

  "source_id": "xhs-note123",

  "local_path":
    "./media/trip01/note123/02.webp",

  "thumbnail_path":
    "./media/trip01/note123/02-thumb.webp",

  "target_type": "attraction",

  "target_id": "丽江-白沙古镇",

  "vision": {
    "relevant": true,
    "score": 0.91
  }
}
```

---

# 34. QA Agent Loop

最终再做一次跨板块检查。

检查：

```text
地图
图片
链接
来源
重复
空内容
错误字符
路线
卡片
```

---

## QA Checklist

### Route

```text
[ ] daily map 没有 hotel
[ ] daily map 没有 rest
[ ] 1 景点不画路线
[ ] 2+ 景点路线顺序和 itinerary 相同
[ ] marker 只有圆点
[ ] start / end 颜色不同
```

### Media

```text
[ ] 所有 HTML img 指向本地
[ ] 图片文件存在
[ ] 图片可 decode
[ ] attraction image vision pass
[ ] food image vision pass
```

### Source

```text
[ ] 每个 attraction 有 source
[ ] 每个 food 有 source
[ ] URL 非空
[ ] note_id 可追踪
```

### HTML

```text
[ ] 没有乱码
[ ] 没有空图
[ ] 没有裸露长 JSON
[ ] Sources 默认收起
```

---

# 35. Browser Visual QA

建议使用 Playwright。

生成 HTML 后自动：

```text
open page
 ↓
wait map load
 ↓
capture full page
 ↓
capture each day map
 ↓
capture food section
 ↓
capture attraction section
 ↓
Codex vision inspect
```

---

## Screenshot

```text
output/qa/
├── full-page.png
├── day-1-map.png
├── day-2-map.png
├── attraction.png
└── food.png
```

---

## QA Agent 输入

```bash
codex --image \
  output/qa/day-1-map.png,\
  output/qa/day-2-map.png \
  "检查地图是否只包含当天景点，路线是否正确连接，marker 是否清晰"
```

---

# 36. 推荐使用 Codex Subagents

不要让一个 Codex Session 顺序完成所有事情。

主 Agent：

```text
Trip Planner Orchestrator
```

子 Agent：

```text
1. itinerary-researcher
2. attraction-researcher
3. food-researcher
4. hotel-researcher
5. transport-researcher
6. media-reviewer
7. map-route-reviewer
8. html-qa-reviewer
```

---

# 37. Agent 之间禁止共享自由文本

不要：

```text
Agent A:
我觉得白沙古镇不错...

Agent B:
根据 Agent A 的感觉...
```

必须共享：

```text
JSON artifacts
```

例如：

```text
attractions.json
food.json
sources.json
media.json
routes.json
```

---

# 38. 推荐中间产物

```text
data/processed/<trip_id>/
├── request.json
├── sources.json
├── itinerary.json
├── attractions.json
├── food.json
├── hotels.json
├── transport.json
├── pitfalls.json
├── media.json
├── routes.json
├── validation.json
└── final.json
```

---

# 39. Section Manifest

建议：

```json
{
  "trip_id": "beijing-shangrila-lijiang-20261002",

  "sections": {
    "itinerary": {
      "status": "pass",
      "version": 3
    },

    "attractions": {
      "status": "pass",
      "version": 2
    },

    "food": {
      "status": "pass",
      "version": 4
    },

    "media": {
      "status": "warn",
      "version": 2
    },

    "routes": {
      "status": "pass",
      "version": 5
    }
  }
}
```

这样可以：

```text
只重跑失败的 section
```

---

# 40. CLI 设计

建议新增：

```bash
npm run trip -- plan \
  --origin 北京 \
  --destination 香格里拉,丽江 \
  --start 2026-10-02 \
  --end 2026-10-07
```

单板块：

```bash
npm run trip -- section attractions
```

```bash
npm run trip -- section food
```

```bash
npm run trip -- section route --day 3
```

```bash
npm run trip -- section media
```

最终：

```bash
npm run trip -- render
npm run trip -- qa
```

---

# 41. Resume 机制

推荐：

```bash
npm run trip -- resume
```

读取：

```text
manifest.json
```

只执行：

```text
status != pass
```

的 Agent。

---

# 42. Renderer 必须是纯函数

推荐：

```js
renderTrip(finalTripJson)
```

不能在 renderer 中：

```text
调用 LLM
调用 XHS
调用 Ctrip
调用 AMap search
```

renderer 只允许：

```text
读取 final JSON
生成 HTML
```

---

# 43. 数据 / 展示彻底分离

正确：

```text
Research
 ↓
JSON
 ↓
Validation
 ↓
HTML
```

不要：

```text
Research
 ↓
HTML
 ↓
Regex 修 HTML
 ↓
再次问 Agent 改 HTML
```

---

# 44. 当前 `window.__TRAVEL_PLAN__` 推荐拆分

现在页面里塞了很大的：

```js
window.__TRAVEL_PLAN__
```

建议改成：

```text
output/<trip_id>/
├── index.html
├── trip.json
├── media/
└── assets/
```

HTML：

```js
fetch('./trip.json')
```

优点：

```text
更容易调试
更容易 diff
更容易单独验证
HTML 不会几十万字符
```

---

# 45. 第一阶段：必须先修

## P0

### A. Daily map

```text
只使用 attraction
```

### B. Marker

```text
只用圆点
```

### C. 图片

```text
XHS 图片本地缓存
```

### D. Source

```text
Attraction / Food 每条有原帖
```

### E. Sources

```text
默认折叠
```

---

# 46. 第二阶段：Agent 化

## P1

实现：

```text
attraction-agent
food-agent
media-agent
route-agent
qa-agent
```

这 5 个优先。

---

# 47. 第三阶段：完整 Orchestrator

## P2

再拆：

```text
hotel
transport
pitfall
itinerary
```

并增加：

```text
manifest
resume
targeted retry
parallel subagents
```

---

# 48. Codex 第一轮具体任务

建议先不要直接要求 Codex：

```text
“把整个项目优化一下”
```

改成下面的任务。

---

## Task 1 — Map data separation

```text
找到生成 day.map.points 和 day.map.legs 的代码。

修改逻辑：
- daily map 只允许 timeline.type === "attraction"
- hotel / rest / transport 不进入 points
- 重新生成 attraction-to-attraction route legs
- 1 个 attraction 时不生成 leg
- 0 个 attraction 不生成 map
```

---

## Task 2 — Marker renderer

```text
找到 AMap Marker renderer。

删除：
- image_url
- 起 / 终文字
- 图片双击行为

替换为：
- start green dot
- waypoint neutral dot
- end orange dot
```

---

## Task 3 — Media cache

```text
实现本地图片缓存。

要求：
- 下载 XHS image URL
- 检查 HTTP status
- 检查图片可 decode
- 生成 thumbnail
- 输出 Media Registry
- HTML 禁止直接使用 xhscdn URL
```

---

## Task 4 — Vision review

```text
实现 vision-review。

输入：
- target name
- target type
- source text
- local image path

输出：
- relevant
- score
- reason
- visible_entities
```

---

## Task 5 — Source binding

```text
为 Attraction / Food 增加：

primary_source_id
source_refs

并实现 Source Registry。
```

---

## Task 6 — Source UI

```text
每张 Attraction / Food 卡片：

查看主要原帖
查看全部来源

页面末尾 sources：
默认 collapsed
支持全部展开 / 全部收起
```

---

## Task 7 — QA

```text
使用 Playwright：

打开最终 HTML
截取：
- 每日地图
- 景点区域
- 美食区域

让 Codex 使用图片输入检查：
- 地图
- 缺图
- 卡片异常
```

---

# 49. 建议给 Codex 的总任务描述

```text
你现在不是直接重新生成一份旅行 HTML。

你的任务是重构 Travel-Planner 的生成架构。

核心要求：

1. 所有研究 Agent 只输出结构化 JSON。
2. 最终 HTML 必须由 deterministic renderer 生成。
3. 每日地图只使用当天 type=attraction 的节点。
4. 酒店、抵达、休息、交通节点禁止进入 daily map。
5. 地图 Marker 只显示圆点：
   - 起点绿色
   - 中间点灰蓝
   - 终点橙红
6. 地图中禁止放景点图片。
7. 只有 >=2 个景点时才画路线。
8. 路线必须按照当天 attraction 顺序重新请求 AMap。
9. XHS 图片必须下载到本地后再进入 HTML。
10. 图片必须经过 vision review。
11. 每个 Attraction / Food 必须有 primary_source_id 和 source_refs。
12. 每个卡片必须提供小红书原帖链接。
13. 页面底部来源默认折叠，可以全部展开。
14. Attraction、Food、Route、Media、QA 必须支持独立执行。
15. 每个 Agent loop 必须有 validator + critic + 最多两次 targeted retry。
16. Agent 不允许直接编辑最终 HTML。
17. 使用中间 JSON 文件完成 Agent 之间的数据交换。
18. 实现 manifest 和 resume，以便只重跑失败 section。

开始修改前先扫描当前仓库结构，并输出：
- 当前 pipeline
- 需要修改的文件
- 需要新增的文件

然后按 P0 → P1 → P2 逐阶段完成。
```

---

# 50. 最终验收标准

最终生成的 HTML 必须满足：

## Daily map

```text
PASS：地图上只有当天景点
PASS：无酒店 / 住宿 / 休息点
PASS：start / end 只有圆点
PASS：start / end 颜色不同
PASS：1 个景点没有路线
PASS：>=2 个景点按 itinerary 顺序连接
```

## Image

```text
PASS：页面不直接依赖 XHS CDN
PASS：所有主要图片存在本地文件
PASS：图片通过 vision review
PASS：图片失败不会破坏布局
```

## Attraction

```text
PASS：所有 attraction 有 source_refs
PASS：有主要原帖链接
PASS：图片和景点通过视觉复核
```

## Food

```text
PASS：所有 food 有 source_refs
PASS：有主要原帖链接
PASS：图片和美食内容相关
```

## Sources

```text
PASS：默认折叠
PASS：支持全部展开
PASS：支持全部收起
```

## Architecture

```text
PASS：每个 section 可单独重跑
PASS：Agent 不直接改最终 HTML
PASS：final HTML 由 renderer 生成
PASS：QA 失败只触发对应 section 修复
```

---

# 51. 推荐实施顺序

最推荐按这个顺序，不要一次全改：

```text
P0-1  Daily map 数据分离
   ↓
P0-2  Marker 简化
   ↓
P0-3  Source binding
   ↓
P0-4  XHS 图片本地缓存
   ↓
P0-5  Sources 折叠
   ↓
P1-1  Vision Review
   ↓
P1-2  Attraction Agent Loop
   ↓
P1-3  Food Agent Loop
   ↓
P1-4  Route Agent Loop
   ↓
P1-5  Browser QA Loop
   ↓
P2    完整 Multi-Agent Orchestrator
```

---

# 52. 推荐最终 Agent 划分

| Agent | 职责 | 输入 | 输出 |
|---|---|---|---|
| Orchestrator | 调度所有 section | TripRequest | Manifest |
| XHS Research | 搜索 / 抓帖 / 原始证据 | Query | Raw Evidence |
| Itinerary | 日程与景点顺序 | Evidence | Itinerary JSON |
| Attraction | 景点总结 | Evidence + POI | Attractions JSON |
| Food | 美食 / 店铺 | Evidence + POI | Food JSON |
| Hotel | 住宿区域与候选 | XHS + Ctrip | Hotels JSON |
| Transport | 飞机 / 高铁 | Ctrip | Transport JSON |
| Pitfall | 避坑 | Evidence | Pitfalls JSON |
| Media | 下载 / 缓存 / 缩略图 | Media URLs | Media Registry |
| Vision Reviewer | 图像语义复核 | Local Images | Vision JSON |
| Route | 每日景点路线 | Itinerary | Routes JSON |
| Validator | schema / evidence / route | Section JSON | Validation |
| Renderer | 生成页面 | Final JSON | HTML |
| Browser QA | 截图视觉检查 | HTML | QA Report |

---

# 53. 一句话总结架构

最终应该从：

```text
一个 Agent
  ↓
搜索所有东西
  ↓
自己判断
  ↓
直接写巨大 HTML
```

升级成：

```text
多个专业 Agent
       ↓
结构化 JSON
       ↓
验证 / Vision / Route QA
       ↓
确定性 Renderer
       ↓
Browser Visual QA
       ↓
只修失败的 section
```

这样不仅能解决你现在的地图、图片、原帖问题，后续增加：

```text
天气
门票
餐厅预约
实时拥堵
景区营业时间
```

也只需要新增独立 Agent，而不需要重新改整条生成链路。



---

# 54. 第一版 Agent Runtime：4 个 Codex 子进程

> 这一节是当前最推荐的第一版落地方式。
>
> 不要一开始就拆成 10 多个 Agent。
>
> 第一版先实现 **4 个短生命周期 Codex 子进程**：
>
> 1. Research / Itinerary Agent
> 2. Attraction + Food Agent
> 3. Route Critic Agent
> 4. Vision QA Agent

底层结构：

```text
npm run trip
     │
     ▼
Node.js Orchestrator
     │
     ├── subprocess #1
     │      codex exec
     │      Research / Itinerary Agent
     │
     ├── subprocess #2
     │      codex exec
     │      Attraction + Food Agent
     │
     ├── subprocess #3
     │      codex exec
     │      Route Critic Agent
     │
     └── subprocess #4
            codex exec
            Vision QA Agent
```

这里的每个 Agent：

```text
一次任务
=
一次 codex exec
=
一个短生命周期 OS 子进程
```

执行完成后：

```text
进程退出
```

不保持一个长期运行的大 Agent。

---

# 55. 为什么第一版只拆 4 个 Agent

如果一开始直接拆：

```text
itinerary
attraction
food
hotel
transport
route
media
vision
pitfall
renderer
qa
```

会增加：

```text
token 成本
调度复杂度
中间文件数量
debug 难度
Agent 间信息丢失
重复调用
```

因此第一版合并为：

```text
Research + Itinerary
Attraction + Food
Route Critic
Vision QA
```

这四个 Agent 已经覆盖当前最需要 LLM 判断的环节。

其余确定性任务继续使用普通代码：

```text
XHS MCP 调用
Ctrip MCP 调用
AMap API
图片下载
图片缓存
缩略图生成
JSON Schema Validation
HTML Renderer
Playwright Screenshot
URL Check
```

---

# 56. Agent Runtime 的职责边界

原则：

```text
Agent
负责“不确定、语义型、需要判断”的任务

普通代码
负责“确定、可验证、可重复”的任务
```

例如：

| 工作 | Agent | 普通代码 |
|---|---:|---:|
| 判断哪些景点值得进入行程 | ✅ | |
| 总结小红书证据 | ✅ | |
| 判断图片是否真的是目标景点 | ✅ | |
| 判断路线结果是否语义合理 | ✅ | |
| 下载图片 | | ✅ |
| 调 AMap API | | ✅ |
| 计算两点距离 | | ✅ |
| JSON Schema | | ✅ |
| 生成 HTML | | ✅ |
| 检查文件是否存在 | | ✅ |

---

# 57. 四 Agent 的依赖 DAG

推荐依赖：

```text
             Raw Research Data
                    │
                    ▼
       ┌─────────────────────────┐
       │ Subprocess #1           │
       │ Research / Itinerary    │
       └────────────┬────────────┘
                    │
                    ▼
             itinerary.json
             sources.json
                    │
                    ▼
       ┌─────────────────────────┐
       │ Subprocess #2           │
       │ Attraction + Food       │
       └────────────┬────────────┘
                    │
             ┌──────┴──────┐
             ▼             ▼
     attractions.json   food.json
             │             │
             └──────┬──────┘
                    │
                    ▼
             AMap Route Code
                    │
                    ▼
              routes.raw.json
                    │
                    ▼
       ┌─────────────────────────┐
       │ Subprocess #3           │
       │ Route Critic            │
       └────────────┬────────────┘
                    │
                    ▼
             routes.json
                    │
                    ▼
             Media Downloader
                    │
                    ▼
             Local Images
                    │
                    ▼
       ┌─────────────────────────┐
       │ Subprocess #4           │
       │ Vision QA               │
       └────────────┬────────────┘
                    │
                    ▼
               media.json
               qa.json
                    │
                    ▼
             HTML Renderer
                    │
                    ▼
               index.html
```

注意：

```text
HTML Renderer
不是 Agent。
```

Renderer 必须是 deterministic code。

---

# 58. Subprocess #1 — Research / Itinerary Agent

## 58.1 主要职责

负责：

```text
整理 XHS 搜索结果
归并景点候选
理解用户旅行目标
生成每天的景点顺序
生成简化 timeline
建立 source registry
```

不负责：

```text
地图路线
图片下载
图片判断
HTML
```

---

## 58.2 输入文件

```text
data/processed/<trip_id>/
├── request.json
├── raw-xhs.json
├── transport.raw.json
└── hotel.raw.json
```

---

## 58.3 输出文件

```text
sources.json
itinerary.json
```

---

## 58.4 itinerary.json 示例

```json
{
  "days": [
    {
      "day": 2,
      "date": "2026-10-03",

      "timeline": [
        {
          "type": "attraction",
          "name": "噶丹·松赞林寺",
          "source_refs": [
            "xhs-note-a"
          ]
        },
        {
          "type": "attraction",
          "name": "龟山公园",
          "source_refs": [
            "xhs-note-b"
          ]
        }
      ]
    }
  ]
}
```

---

## 58.5 Agent Prompt 核心约束

```text
你是 Research / Itinerary Agent。

你的任务：
1. 阅读原始小红书 evidence。
2. 归并重复景点。
3. 生成每天的景点访问顺序。
4. 每个 attraction 必须绑定 source_refs。
5. 不生成地图路线。
6. 不生成 HTML。
7. 不下载图片。
8. 不虚构 evidence 中不存在的内容。
9. 住宿、抵达、休息可以保留在 timeline，但必须有明确 type。
10. 输出严格 JSON。
```

---

# 59. Subprocess #2 — Attraction + Food Agent

## 59.1 主要职责

统一负责：

```text
景点内容总结
景点 source binding
美食内容总结
菜品 / 餐厅区分
primary source 选择
媒体候选关联
```

第一版先不要把：

```text
Attraction Agent
Food Agent
```

拆成两个子进程。

因为二者都主要依赖：

```text
sources.json
```

而且处理逻辑接近。

等以后调用量增大，再拆开。

---

## 59.2 输入

```text
sources.json
itinerary.json
```

可选：

```text
amap-poi.json
```

---

## 59.3 输出

```text
attractions.json
food.json
```

---

## 59.4 Attraction 要求

每个 attraction：

```json
{
  "id": "丽江-白沙古镇",
  "name": "白沙古镇",

  "summary": "...",

  "primary_source_id": "xhs-note-abc",

  "source_refs": [
    "xhs-note-abc",
    "xhs-note-def"
  ],

  "candidate_media": [
    {
      "source_id": "xhs-note-abc",
      "image_index": 2
    }
  ]
}
```

---

## 59.5 Food 要求

每个 food：

```json
{
  "id": "food-yak-hotpot",

  "entity_type": "dish",

  "name": "牦牛肉火锅",

  "summary": "...",

  "primary_source_id": "xhs-note-xxx",

  "source_refs": [
    "xhs-note-xxx"
  ]
}
```

---

## 59.6 Validator

普通代码检查：

```text
attraction.source_refs.length >= 1
food.source_refs.length >= 1

primary_source_id
必须存在于 sources.json

禁止不存在的 source id
禁止空 name
禁止完全重复 entity
```

---

# 60. Subprocess #3 — Route Critic Agent

这个 Agent **不负责真正计算路线**。

真正路线由：

```text
AMap API
```

普通代码完成。

Agent 只负责：

```text
检查路线结果是否合理
```

---

## 60.1 前置普通代码

```text
itinerary.json
     ↓
filter attraction
     ↓
AMap POI normalize
     ↓
AMap route API
     ↓
routes.raw.json
```

---

## 60.2 Route Critic 输入

```text
itinerary.json
routes.raw.json
poi.json
```

---

## 60.3 Route Critic 检查

```text
路线顺序是否与 itinerary 一致

hotel 是否意外进入路线

transport 是否意外进入路线

route start / end 是否匹配景点

是否出现明显绕路

是否出现 0m 异常路线

是否存在：
A → C
却遗漏 B

是否存在：
景点 POI 和道路终点偏差过大
```

---

## 60.4 输出

```text
route-review.json
```

示例：

```json
{
  "status": "fail",

  "issues": [
    {
      "day": 2,
      "type": "invalid_node",

      "message":
        "酒店节点被加入 daily map"
    },

    {
      "day": 3,
      "type": "endpoint_gap",

      "place": "纳帕海",

      "gap_m": 612
    }
  ]
}
```

---

# 61. Route Critic 修复 Loop

```text
AMap Route
    │
    ▼
routes.raw.json
    │
    ▼
Route Critic Agent
    │
 ┌──┴────┐
PASS    FAIL
 │        │
 ▼        ▼
save   correction.json
          │
          ▼
 deterministic route fixer
          │
          ▼
 retry AMap
          │
          └──→ Route Critic
```

最多：

```text
2 次
```

---

# 62. Route Critic 不直接改路线 JSON

Agent 不能直接：

```text
凭空修改 polyline
```

只允许输出：

```text
问题是什么
建议重新查哪个 POI
哪个节点不应该存在
需要重新请求哪一段路线
```

真正修改：

```text
route-fixer.js
```

完成。

---

# 63. Subprocess #4 — Vision QA Agent

这个 Agent 负责两个任务：

```text
图片内容复核
最终页面视觉 QA
```

第一版可以合并。

以后再拆成：

```text
Media Reviewer
Browser QA
```

---

# 64. Vision QA — 第一阶段：图片语义检查

前置普通代码：

```text
XHS image URL
      ↓
downloader
      ↓
local image
      ↓
thumbnail
```

然后：

```text
Vision QA Agent
```

看本地图片。

---

## 64.1 输入

```text
attractions.json
food.json
sources.json
local media files
```

---

## 64.2 检查

Attraction 图片：

```text
是否真的与目标景点有关

是不是：
酒店
自拍
其他景点
地图截图
无关街景
纯文字截图
```

Food 图片：

```text
是否有目标食物

是否展示餐厅 / 菜品

是否只是人物自拍

是否明显是其他菜品
```

---

## 64.3 输出

```text
media.json
```

例如：

```json
{
  "media_id": "media-note-a-02",

  "target_id": "丽江-白沙古镇",

  "local_path":
    "./media/note-a/02.webp",

  "review": {
    "relevant": true,
    "score": 0.91,
    "reason":
      "图片主体为古镇街道与传统建筑，和目标景点描述一致"
  }
}
```

---

# 65. Vision QA — 第二阶段：最终 HTML Screenshot 检查

Renderer 完成后：

```text
index.html
    ↓
Playwright
    ↓
screenshot
```

建议生成：

```text
output/qa/
├── full-page.png
├── day-1-map.png
├── day-2-map.png
├── attractions.png
└── food.png
```

再启动：

```text
Vision QA Agent
```

看这些图片。

---

## 65.1 检查内容

```text
地图是否真的只显示景点

marker 是否仍出现图片

起点 / 终点颜色是否区分

路线是否明显连错

景点图片是否空白

美食图片是否空白

卡片是否溢出

是否出现乱码

来源区域是否默认折叠

移动端布局是否明显破坏
```

---

## 65.2 输出

```text
visual-qa.json
```

例如：

```json
{
  "status": "fail",

  "issues": [
    {
      "section": "day-2-map",
      "severity": "high",
      "message":
        "路线起点仍然是酒店，不是噶丹·松赞林寺"
    },

    {
      "section": "food",
      "severity": "medium",
      "message":
        "牦牛肉火锅卡片没有图片"
    }
  ]
}
```

---

# 66. Node Orchestrator 如何启动四个 Agent 子进程

推荐使用：

```js
child_process.spawn()
```

不要使用：

```text
shell 拼接巨大字符串
```

基础封装：

```js
import { spawn } from "node:child_process";

export function runCodexAgent({
  name,
  prompt,
  cwd,
  images = []
}) {
  return new Promise((resolve, reject) => {

    const args = [
      "exec",
      "--json",
      "--sandbox",
      "workspace-write"
    ];

    if (images.length) {
      args.push(
        "--image",
        images.join(",")
      );
    }

    args.push(prompt);

    const child = spawn(
      "codex",
      args,
      {
        cwd,
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on(
      "data",
      chunk => {
        stdout += chunk.toString();
      }
    );

    child.stderr.on(
      "data",
      chunk => {
        stderr += chunk.toString();
      }
    );

    child.on(
      "close",
      code => {
        if (code === 0) {
          resolve({
            name,
            stdout
          });
        } else {
          reject(
            new Error(
              `${name} failed: ${stderr}`
            )
          );
        }
      }
    );
  });
}
```

---

# 67. 不要让 Agent 直接通过 stdout 传大量数据

推荐：

```text
stdout
只记录：
状态
日志
run id
```

真正结果写入：

```text
JSON 文件
```

例如：

```text
data/processed/<trip_id>/
```

因为这样：

```text
更容易 debug
更容易 resume
更容易 diff
更容易单独重跑
```

---

# 68. 推荐的四 Agent 文件输出

```text
data/processed/<trip_id>/
├── request.json
├── raw-xhs.json
│
├── sources.json
├── itinerary.json
│
├── attractions.json
├── food.json
│
├── routes.raw.json
├── route-review.json
├── routes.json
│
├── media.json
├── visual-qa.json
│
└── manifest.json
```

---

# 69. Orchestrator 第一版伪代码

```js
async function runTrip(tripId) {

  // --------------------------------
  // deterministic research tools
  // --------------------------------

  await fetchXhsData(tripId);

  await fetchTransport(tripId);

  await fetchHotels(tripId);


  // --------------------------------
  // Agent subprocess #1
  // --------------------------------

  await runResearchItineraryAgent(
    tripId
  );

  validateItinerary(tripId);


  // --------------------------------
  // Agent subprocess #2
  // --------------------------------

  await runAttractionFoodAgent(
    tripId
  );

  validateAttractions(tripId);

  validateFood(tripId);


  // --------------------------------
  // deterministic route generation
  // --------------------------------

  await generateAmapRoutes(
    tripId
  );


  // --------------------------------
  // Agent subprocess #3
  // --------------------------------

  await runRouteCriticAgent(
    tripId
  );

  await repairRoutesIfNeeded(
    tripId
  );


  // --------------------------------
  // deterministic media download
  // --------------------------------

  await downloadMedia(
    tripId
  );


  // --------------------------------
  // Agent subprocess #4
  // image review
  // --------------------------------

  await runVisionMediaAgent(
    tripId
  );


  // --------------------------------
  // deterministic renderer
  // --------------------------------

  await renderHtml(
    tripId
  );


  // --------------------------------
  // deterministic screenshot
  // --------------------------------

  await captureScreenshots(
    tripId
  );


  // --------------------------------
  // Agent subprocess #4
  // final visual QA
  // --------------------------------

  await runVisionPageQaAgent(
    tripId
  );
}
```

这里虽然：

```text
Vision QA Agent
```

会执行两次，

但仍然是同一个 Agent 类型：

```text
第一次：
media review

第二次：
browser screenshot review
```

---

# 70. 每个 Agent 子进程必须短生命周期

推荐：

```text
spawn
 ↓
读取明确输入
 ↓
完成单个任务
 ↓
写 JSON
 ↓
退出
```

不要：

```text
启动一个 Codex
让它常驻
然后几十轮不断聊天
```

原因：

```text
上下文越来越脏
更难重现
更难 retry
更难做并发
更难记录成本
```

---

# 71. Retry 也使用新的 Codex 子进程

如果 Validator FAIL：

```text
不要继续复用旧 Agent Session
```

第一版建议：

```text
创建一个新的 codex exec
```

把：

```text
原输出
+
validation errors
```

作为新输入。

例如：

```text
第一次：

Food Agent
 ↓
food.json

Validator：
牦牛肉火锅缺 source_refs
奶渣蛋卷 source id 不存在

第二次：
重新 spawn Food Agent
 ↓
prompt:
只修复以上两个问题
```

---

# 72. 通用 Agent Loop

推荐：

```js
async function runAgentLoop({
  run,
  validate,
  maxRetries = 2
}) {

  let feedback = [];

  for (
    let attempt = 0;
    attempt <= maxRetries;
    attempt++
  ) {

    await run({
      attempt,
      feedback
    });

    const validation =
      await validate();

    if (validation.ok) {
      return {
        status: "pass",
        attempt
      };
    }

    feedback =
      validation.errors;
  }

  return {
    status: "failed",
    feedback
  };
}
```

---

# 73. Agent Loop 的正确理解

注意：

```text
Agent Loop
≠
一个 Agent 永久运行
```

而是：

```text
spawn Agent
   ↓
generate
   ↓
exit
   ↓
validator
   ↓
FAIL
   ↓
spawn 新 Agent
   ↓
repair
   ↓
exit
```

所以第一版底层模型应该理解成：

```text
Node Orchestrator
+
短生命周期 Codex CLI 子进程
+
JSON 文件
+
Validator
```

---

# 74. 并发策略

第一版不需要所有 Agent 并发。

因为四个 Agent 有明显依赖：

```text
#1 Research / Itinerary
        ↓
#2 Attraction + Food
        ↓
AMap
        ↓
#3 Route Critic
        ↓
Media
        ↓
#4 Vision QA
```

因此主链基本串行。

但是普通数据抓取可以并行：

```js
await Promise.all([
  fetchXhsData(),
  fetchHotels(),
  fetchTransport()
]);
```

---

# 75. 第二阶段可以并行拆 Agent

当第一版稳定后：

```text
Attraction + Food
```

可以拆成：

```text
Attraction Agent
Food Agent
```

此时：

```text
                sources.json
                      │
              ┌───────┴───────┐
              ▼               ▼
       Attraction Agent    Food Agent
              │               │
              └───────┬───────┘
                      ▼
                    merge
```

两者可以：

```js
await Promise.all([
  runAttractionAgent(),
  runFoodAgent()
]);
```

---

# 76. 第三阶段再升级到完整 Multi-Agent

最终才考虑：

```text
Research Agent
Itinerary Agent
Attraction Agent
Food Agent
Hotel Agent
Transport Agent
Route Critic
Media Reviewer
Browser QA
Pitfall Agent
```

但第一版不需要。

---

# 77. 推荐新增代码目录

```text
src/
├── runtime/
│   ├── codex-runner.js
│   ├── agent-loop.js
│   └── manifest.js
│
├── agents/
│   ├── research-itinerary.js
│   ├── attraction-food.js
│   ├── route-critic.js
│   └── vision-qa.js
│
├── validators/
│   ├── itinerary-validator.js
│   ├── attraction-validator.js
│   ├── food-validator.js
│   ├── route-validator.js
│   └── media-validator.js
│
├── routes/
│   ├── amap-route.js
│   └── route-fixer.js
│
└── media/
    ├── downloader.js
    ├── thumbnail.js
    └── screenshot.js
```

---

# 78. manifest.json 记录每个 Agent 执行状态

```json
{
  "trip_id":
    "beijing-shangrila-lijiang-20261002",

  "agents": {
    "research_itinerary": {
      "status": "pass",
      "attempts": 1
    },

    "attraction_food": {
      "status": "pass",
      "attempts": 2
    },

    "route_critic": {
      "status": "pass",
      "attempts": 1
    },

    "vision_qa": {
      "status": "warn",
      "attempts": 2
    }
  }
}
```

---

# 79. Resume

运行：

```bash
npm run trip -- resume <trip_id>
```

读取：

```text
manifest.json
```

如果：

```text
research_itinerary = pass
attraction_food = pass
route_critic = failed
```

则：

```text
不要重新搜索小红书
不要重新跑前两个 Agent

直接从 Route Critic 开始
```

---

# 80. 第一版 CLI

完整生成：

```bash
npm run trip -- plan \
  --origin 北京 \
  --destination 香格里拉,丽江 \
  --start 2026-10-02 \
  --end 2026-10-07
```

单 Agent：

```bash
npm run trip -- agent research-itinerary
```

```bash
npm run trip -- agent attraction-food
```

```bash
npm run trip -- agent route-critic
```

```bash
npm run trip -- agent vision-qa
```

重跑某一天路线：

```bash
npm run trip -- route \
  --day 2
```

最终 QA：

```bash
npm run trip -- qa
```

---

# 81. 第一版 Codex 改造任务

可以直接把下面这段交给 Codex：

```text
请为 Travel-Planner 增加第一版 Agent Runtime。

不要一次拆成很多 Agent。

第一版只实现四种 Codex Agent：

1. Research / Itinerary Agent
2. Attraction + Food Agent
3. Route Critic Agent
4. Vision QA Agent

实现要求：

A. Runtime

使用 Node.js child_process.spawn 启动：

codex exec

每次 Agent 调用都是一个独立、短生命周期的 OS 子进程。

每个 Agent：
- 启动
- 读取明确输入 JSON
- 完成单一职责
- 写入明确输出 JSON
- 退出

禁止长期保持一个 Codex Session。


B. Agent Loop

新增：

src/runtime/codex-runner.js
src/runtime/agent-loop.js
src/runtime/manifest.js

每个 Agent 必须支持：

generate
→ validate
→ PASS / FAIL
→ targeted retry

maxRetries = 2

Retry 时启动新的 codex exec 子进程。


C. Agent #1

Research / Itinerary Agent

输入：

request.json
raw-xhs.json
transport.raw.json
hotel.raw.json

输出：

sources.json
itinerary.json

职责：

- 整理来源
- 去重景点
- 规划每天景点
- 绑定 source_refs

禁止：

- 生成 HTML
- 生成路线
- 下载图片


D. Agent #2

Attraction + Food Agent

输入：

sources.json
itinerary.json

输出：

attractions.json
food.json

要求：

每个 attraction / food：

primary_source_id
source_refs

必须可追踪到 sources.json。


E. Route

路线本身继续使用普通 AMap API。

先生成：

routes.raw.json

然后启动：

Route Critic Agent

检查：

- daily map 只能有 attraction
- hotel 禁止进入 map
- rest 禁止进入 map
- route 顺序一致
- endpoint gap
- 0m route
- 明显绕路

Route Critic 不允许自己虚构 polyline。

它只输出：

route-review.json

真正修复交给：

route-fixer.js


F. Agent #4

Vision QA Agent

阶段 1：

检查本地缓存的景点 / 美食图片。

阶段 2：

Playwright 截取最终 HTML：

full page
day maps
attractions
food

Vision QA 使用图片输入检查：

- 路线图是否错误
- 图片是否缺失
- 景点图片是否不相关
- 美食图片是否不相关
- 布局是否异常
- 来源区域是否折叠


G. Renderer

HTML Renderer 必须继续保持 deterministic。

禁止 Agent 直接修改最终 HTML。


H. JSON 通信

所有 Agent 之间只通过：

data/processed/<trip_id>/*.json

通信。

禁止 Agent 间共享自由文本。


I. Manifest

记录：

agent status
attempt count
last error

支持：

npm run trip -- resume


J. CLI

支持：

npm run trip -- agent research-itinerary
npm run trip -- agent attraction-food
npm run trip -- agent route-critic
npm run trip -- agent vision-qa

开始编码前：

1. 扫描当前仓库结构
2. 找出已有 pipeline
3. 列出需要修改的文件
4. 列出需要新增的文件
5. 再开始实现
```

---

# 82. 第一版最终运行模型

最终建议你把系统理解成：

```text
                 Node.js Main Process
                         │
                         ▼
                  Trip Orchestrator
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
 deterministic tools               Codex Agents
         │                               │
 XHS / Ctrip / AMap                     │
 downloader                             │
 validator                              │
 renderer                               │
 Playwright                             │
         │                               │
         │          ┌────────────────────┤
         │          │                    │
         │          ▼                    ▼
         │    subprocess #1       subprocess #2
         │    Research /          Attraction +
         │    Itinerary           Food
         │
         │          ▼
         │    subprocess #3
         │    Route Critic
         │
         │          ▼
         │    subprocess #4
         │    Vision QA
         │
         └──────────┬────────────────────┘
                    ▼
                 final.json
                    │
                    ▼
              HTML Renderer
                    │
                    ▼
                index.html
```

第一版先做到这一层。

稳定后再把：

```text
Attraction + Food
```

拆开，并逐渐升级到完整 Multi-Agent 系统。
