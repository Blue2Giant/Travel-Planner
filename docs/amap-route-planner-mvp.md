# AMap 双地点驾车 / 公交路线规划 MVP 实现计划

## 目标

在当前 `Travel-Planner` 项目中实现一个最小可运行 Demo。

用户只需要输入：

- 起点，例如：`上海虹桥火车站`
- 终点，例如：`上海迪士尼度假区`

点击“查询路线”后，系统必须：

1. 将两个地点解析为高德 POI。
2. 显示实际解析出的起点和终点名称、地址。
3. 查询驾车路线。
4. 查询公共交通路线。
5. 分别显示：
   - 总距离
   - 总耗时
   - 关键路线信息
6. 在同一个 HTML 页面中渲染地图。
7. 支持在“驾车路线”和“公共交通路线”之间切换。
8. 地图必须显示实际路线，而不是起终点之间画直线。
9. 公共交通需要显示：
   - 步行段
   - 地铁/公交线路
   - 上车站
   - 下车站
   - 换乘站
   - 各主要路段
10. 所有高德 API Key 留空，由用户自行填写。

---

## 技术方案

不要使用 LLM 猜测距离、时间或地理坐标。

运行时直接调用高德官方 API：

```text
用户输入地点名称
        │
        ▼
Web Service POI Search
        │
        ├── POI ID
        ├── 经纬度
        ├── citycode
        └── 地址
        │
        ▼
┌─────────────────────────────┐
│                             │
▼                             ▼
Driving API                Transit API
│                             │
├─ distance                  ├─ distance
├─ duration                  ├─ duration
├─ steps                     ├─ segments
└─ polyline                  └─ polyline
│                             │
└──────────────┬──────────────┘
               ▼
        Normalized JSON
               │
               ▼
         Browser Frontend
               │
               ▼
          AMap JSAPI 2.0
               │
       ┌───────┴────────┐
       ▼                ▼
   驾车路线          公交路线
```

第一版不需要高德 MCP。

MCP 可以以后给 Travel Agent 做自然语言工具调用，但这个确定性的路线服务应该直接调用 Web Service API。

---

## 项目结构

请创建：

```text
Travel-Planner/
│
├── package.json
├── server.js
├── .env
├── .env.example
├── .gitignore
├── README.md
│
├── src/
│   └── amap/
│       ├── poi.js
│       ├── driving.js
│       ├── transit.js
│       ├── normalize.js
│       └── utils.js
│
└── public/
    ├── index.html
    ├── app.js
    └── styles.css
```

---

## API Key 配置

创建：

```text
.env.example
```

内容：

```env
# 高德 Web 服务 API Key
# 高德开放平台 -> 应用管理 -> 添加 Key -> Web 服务
AMAP_WEB_SERVICE_KEY=

# 高德 Web端(JS API) Key
# 高德开放平台 -> 应用管理 -> 添加 Key -> Web端(JS API)
AMAP_JSAPI_KEY=

# 与 JSAPI Key 对应的安全密钥
AMAP_JSAPI_SECURITY_CODE=
```

同时创建：

```text
.env
```

内容完全相同，但值保持为空：

```env
AMAP_WEB_SERVICE_KEY=
AMAP_JSAPI_KEY=
AMAP_JSAPI_SECURITY_CODE=
```

用户之后自己填写。

`.gitignore` 必须包含：

```gitignore
.env
node_modules/
.DS_Store
```

严禁把真实 Key 写死进：

```text
server.js
app.js
index.html
Git repository
```

---

## Step 1：地点解析

实现：

```text
src/amap/poi.js
```

调用高德 POI 2.0：

```text
GET https://restapi.amap.com/v5/place/text
```

输入：

```text
keywords
region（如果有）
key
```

对于：

```text
上海虹桥火车站
```

返回并标准化为：

```json
{
  "id": "高德POIID",
  "name": "上海虹桥站",
  "address": "...",
  "location": {
    "lng": 121.327,
    "lat": 31.2
  },
  "city": "上海市",
  "citycode": "021",
  "adcode": "310112"
}
```

不要只保存经纬度。

必须同时保存：

```text
POI ID
name
address
citycode
adcode
location
```

后续路径规划把 POI ID 一起传递给高德，提高地点识别准确度。

如果搜索返回 0 个结果：

```text
HTTP 400
{
  "error": "PLACE_NOT_FOUND"
}
```

如果返回多个结果，MVP 第一版可以使用排序第一名，但页面必须明确显示：

```text
已识别为：
上海虹桥站
上海市闵行区申贵路1500号
```

避免用户不知道系统实际选中了哪个地点。

---

## Step 2：驾车路线

实现：

```text
src/amap/driving.js
```

调用：

```text
GET https://restapi.amap.com/v5/direction/driving
```

传入：

```text
origin
destination
origin_id
destination_id
strategy=32
show_fields=cost,polyline
key
```

默认：

```text
strategy=32
```

即使用高德推荐路线。

提取第一条路线。

统一输出：

```json
{
  "mode": "driving",
  "distanceMeters": 0,
  "durationSeconds": 0,
  "durationMinutes": 0,
  "tolls": 0,
  "trafficLights": 0,
  "steps": [
    {
      "instruction": "",
      "roadName": "",
      "distanceMeters": 0,
      "durationSeconds": 0,
      "polyline": []
    }
  ],
  "polyline": []
}
```

`polyline` 必须转换成：

```json
[
  [121.123, 31.123],
  [121.124, 31.124]
]
```

而不是把高德原始字符串直接交给前端。

---

## Step 3：公共交通路线

实现：

```text
src/amap/transit.js
```

调用：

```text
GET https://restapi.amap.com/v5/direction/transit/integrated
```

传入：

```text
origin
destination
originpoi
destinationpoi
city1
city2
show_fields=cost,polyline
key
```

其中：

```text
city1 = 起点 POI citycode
city2 = 终点 POI citycode
```

默认选择返回的第一条推荐公共交通方案。

统一为：

```json
{
  "mode": "transit",
  "distanceMeters": 0,
  "durationSeconds": 0,
  "durationMinutes": 0,
  "segments": [
    {
      "type": "walk | bus | subway | railway | taxi",
      "lineName": "",
      "from": "",
      "to": "",
      "viaStops": [],
      "distanceMeters": 0,
      "durationSeconds": 0,
      "polyline": []
    }
  ],
  "polyline": []
}
```

重点解析公共交通中的：

```text
步行到车站

地铁 X 号线
A站 → B站

公交 XXX 路
B站 → C站

换乘

步行到目的地
```

页面至少能展示：

```text
步行 420 m
↓
人民广场站
地铁 2 号线
↓ 6站
龙阳路站
↓
换乘地铁 16 号线
↓
迪士尼站
↓
步行 650 m
```

如果 API 某些方案没有具体 `viaStops`，不要伪造。

只展示 API 实际返回的信息。

---

## Step 4：统一后端 API

`server.js` 提供：

```http
POST /api/routes
```

Body：

```json
{
  "origin": "上海虹桥火车站",
  "destination": "上海迪士尼度假区"
}
```

执行：

```text
resolvePlace(origin)
        +
resolvePlace(destination)
        ↓
Promise.all(
    getDrivingRoute(),
    getTransitRoute()
)
```

最终只给前端返回一个干净的数据结构：

```json
{
  "origin": {
    "name": "",
    "address": "",
    "lng": 0,
    "lat": 0
  },
  "destination": {
    "name": "",
    "address": "",
    "lng": 0,
    "lat": 0
  },
  "driving": {
    "distanceMeters": 0,
    "durationMinutes": 0,
    "steps": [],
    "polyline": []
  },
  "transit": {
    "distanceMeters": 0,
    "durationMinutes": 0,
    "segments": []
  }
}
```

前端不应该直接处理高德原始 API response。

---

## Step 5：提供 JSAPI 配置

增加：

```http
GET /api/config
```

只返回浏览器地图初始化所需要的信息：

```json
{
  "amapJsKey": ""
}
```

Web Service Key 绝不能从这个 endpoint 返回。

开发阶段 JSAPI Security Code 可以采用环境变量读取方案。

如果需要在客户端使用：

```javascript
window._AMapSecurityConfig = {
  securityJsCode: ...
}
```

请在 README 明确注明：

```text
仅用于本地开发测试。

正式部署时改为高德官方推荐的 serviceHost
代理方式，不应把 securityJsCode 直接暴露在生产前端。
```

---

## Step 6：HTML 页面

`public/index.html` 页面布局：

```text
┌─────────────────────────────────────────────┐
│ Travel Route Planner                        │
│                                             │
│ 起点 [ 上海虹桥火车站                 ]       │
│ 终点 [ 上海迪士尼度假区               ]       │
│                                             │
│              [ 查询路线 ]                    │
├─────────────────────────────────────────────┤
│ 已识别地点                                   │
│                                             │
│ 起点：上海虹桥站                              │
│ 地址：xxxx                                   │
│                                             │
│ 终点：上海迪士尼度假区                        │
│ 地址：xxxx                                   │
├───────────────────────┬─────────────────────┤
│ 🚗 驾车                │ 🚇 公共交通          │
│                       │                     │
│ XX km                 │ XX km               │
│ XX min                │ XX min              │
│                       │                     │
│ [查看路线]             │ [查看路线]           │
├───────────────────────┴─────────────────────┤
│                                             │
│                  高德地图                    │
│                                             │
│              A ───────── B                  │
│                                             │
├─────────────────────────────────────────────┤
│ 路线详情                                    │
│                                             │
│ ...                                         │
└─────────────────────────────────────────────┘
```

默认显示驾车路线。

---

## Step 7：地图渲染

使用：

```text
AMap JS API 2.0
```

创建：

```javascript
const map = new AMap.Map(...)
```

地图不要再次调用 Driving / Transfer API。

后端已经完成算路。

前端只使用：

```text
AMap.Map
AMap.Marker
AMap.Polyline
AMap.InfoWindow
```

绘制后端返回的 route geometry。

这样可以避免：

```text
后端算一次路线
+
前端又算一次路线
```

导致结果不一致和 API 调用浪费。

---

## Step 8：驾车地图表现

驾车模式：

```text
起点 Marker A
终点 Marker B
驾车 Polyline
```

地图下方显示：

```text
驾车

总距离：31.4 km
预计时间：42 min

主要道路：

延安高架路
→ 内环高架路
→ 华夏高架路
→ 迎宾高速
```

不要把几十条“左转/右转 20 米”全部默认展开。

只展示关键 road steps。

可以增加：

```text
查看完整导航步骤
```

展开后再显示全部。

---

## Step 9：公交地图表现

公交不能只画一根线。

应区分：

```text
Walking segment
Bus segment
Subway segment
Railway segment
```

使用不同的 Polyline 样式。

必须添加关键 Marker：

```text
起点
↓
上车站
↓
换乘站
↓
下车站
↓
终点
```

路线详情显示：

```text
公共交通

总距离：35.2 km
预计时间：1 h 18 min

① 步行
420 m · 6 min

② 地铁 2 号线
虹桥火车站
→ 龙阳路站
约 XX min

③ 换乘地铁 16 号线
龙阳路站
→ XX站

④ 步行
650 m · 9 min
```

如果 API 有票价，同时显示：

```text
预计费用：¥X
```

没有数据则不显示。

---

## Step 10：路线切换

页面顶部路线卡支持：

```text
[ 🚗 驾车 ]
[ 🚇 公共交通 ]
```

点击后：

```text
clear current overlays
        ↓
draw selected route
        ↓
update details panel
        ↓
map.setFitView(...)
```

两个路线不要永久重叠显示，否则地图会比较乱。

---

## Step 11：格式化工具

创建：

```text
src/amap/utils.js
```

实现：

```javascript
formatDistance()
formatDuration()
parsePolyline()
```

例如：

```text
830 m
1.4 km
28 min
1 h 12 min
```

不要向用户显示：

```text
distance = 31428
duration = 4278
```

---

## Step 12：错误处理

必须覆盖：

```text
地点不存在
地点名称歧义
高德 API Key 未配置
API Key 无权限
API quota exceeded
公交没有可用路线
驾车没有路线
高德请求超时
网络失败
```

例如 Key 没填写时：

```text
AMAP_WEB_SERVICE_KEY is not configured.
Please configure it in .env.
```

不要把完整 Key 输出到 error log。

---

## Step 13：README

README 必须写清楚配置流程。

至少包含：

```text
1. npm install

2. cp .env.example .env

3. 打开 .env

4. 填写：

AMAP_WEB_SERVICE_KEY=
AMAP_JSAPI_KEY=
AMAP_JSAPI_SECURITY_CODE=

5. npm run dev

6. 浏览器访问：

http://localhost:3000
```

并解释三个变量的区别：

```text
AMAP_WEB_SERVICE_KEY

用于：
POI 搜索
驾车路线
公交路线

只能后端使用。


AMAP_JSAPI_KEY

用于：
浏览器加载高德地图
Marker
Polyline
地图交互


AMAP_JSAPI_SECURITY_CODE

与 JSAPI Key 配套。
本地开发允许使用 securityJsCode。
生产环境应改为 serviceHost 代理。
```

---

## Step 14：测试

至少测试：

```text
Case 1

起点：
上海虹桥火车站

终点：
上海迪士尼度假区
```

检查：

```text
✓ 地点被正确识别
✓ 驾车距离存在
✓ 驾车时间存在
✓ 公交距离存在
✓ 公交时间存在
✓ 驾车路线实际显示
✓ 公交路线实际显示
✓ 公交换乘站显示
✓ 地图自动 fit bounds
```

再测试：

```text
Case 2

起点：
广州南站

终点：
广州塔
```

最后测试错误输入：

```text
起点：
xxxxxxxxxxxxxxxxxxxx
```

必须优雅提示，而不是页面崩溃。

---

## 验收标准

任务完成前自行启动项目并验证。

最终必须满足：

```text
用户只输入两个地点名称
        ↓
点击查询
        ↓
真实 POI 匹配
        ↓
┌──────────────┬──────────────┐
│ 驾车          │ 公共交通      │
│ 31.4 km      │ 35.2 km      │
│ 42 min       │ 1 h 18 min   │
└──────────────┴──────────────┘
        ↓
点击不同交通方式
        ↓
地图实时切换对应路线
        ↓
显示对应路线详情和关键站点
```

距离、耗时、道路、公交线路、车站和路线 geometry 均必须来自高德 API。

禁止 LLM 推算或伪造。

不要要求用户提供 API Key 才开始开发。

把所有 Key 位置先留空，并创建 `.env.example`，用户稍后自行配置。

完成后在 README 中明确告诉用户：

```text
需要填写 Key 的唯一位置：

Travel-Planner/.env
```

---

## 关键设计原则

### 1. Web Service API 负责算路，JS API 只负责画图

- 高德 Web Service API：
  - POI 搜索
  - 驾车路线
  - 公共交通路线
  - 距离
  - 时间
  - 路线 geometry

- 高德 JS API：
  - 地图底图
  - Marker
  - Polyline
  - InfoWindow
  - fitView
  - 用户交互

不要在前端再次调用 Driving / Transfer 进行重复算路。

### 2. 地点先经过 POI Search 标准化

不要直接使用用户输入文本猜测经纬度。

所有地点都先转换为：

```text
用户输入
↓
高德 POI Search
↓
POI ID + 经纬度 + 地址 + citycode
↓
路径规划
```

### 3. 第一版不依赖 MCP

这个 MVP 的运行时不需要高德 MCP。

Codex 负责实现项目；项目本身直接调用高德 Web Service API。

未来如果升级为完整 Travel Agent，再使用 MCP 负责：

```text
Agent 判断需要搜索哪些地点
Agent 判断需要比较哪些路线
Agent 规划多日行程
```

而底层确定性的距离和路线计算继续由 Web Service API 完成。
