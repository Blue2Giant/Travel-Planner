# OpenCLI + 携程（Ctrip）本地 MCP 接入计划

> 目标：让 Codex/Agent 在本机通过 MCP 查询 **中国国内机票、高铁/动车/普通列车、住宿信息**。
>
> 重要说明：这不是“携程官方 MCP”。底层使用开源项目 **OpenCLI** 的 `ctrip` adapter，复用本机 Chrome 的携程会话，再在外层封装一个只读的本地 MCP Server。

---

## 1. 最终架构

```text
Codex / Agent
      │
      │ MCP (stdio)
      ▼
ctrip-travel-mcp
      │
      │ spawn opencli（只读）
      ▼
OpenCLI ctrip adapter
      │
      │ Browser Bridge
      ▼
本机 Chrome + 携程 Cookie / 浏览器状态
      │
      ▼
ctrip.com
```

推荐只开放以下只读工具：

```text
search_flights
search_roundtrip_flights
search_trains
search_hotels
get_hotel_detail
resolve_hotel_city
```

不要实现下单、支付、自动登录、抢票等操作。

---

## 2. OpenCLI 当前携程能力

OpenCLI 当前的 `ctrip` adapter 已包含：

```text
search
hotel-suggest
hotel-search
hotel
flight
flight-round
train
bus
ferry
cruise
tour
package
attraction
```

本项目重点使用：

| 能力 | OpenCLI 命令 | 是否适合本项目 |
|---|---|---|
| 国内单程机票 | `ctrip flight` | ✅ |
| 国内往返机票 | `ctrip flight-round` | ✅，但有局限 |
| 火车/高铁/动车 | `ctrip train` | ✅ |
| 酒店列表 | `ctrip hotel-search` | ✅ |
| 酒店详情 | `ctrip hotel` | ✅ |
| 城市/酒店/商圈解析 | `ctrip search` / `hotel-suggest` | ✅ |

官方文档：

- OpenCLI: https://github.com/jackwener/OpenCLI
- Ctrip adapter: https://github.com/jackwener/OpenCLI/blob/main/docs/adapters/browser/ctrip.md
- Browser Bridge: https://github.com/jackwener/OpenCLI/blob/main/docs/guide/browser-bridge.md

---

# 3. 我需要手动做什么？

真正需要用户手动做的只有以下几项。

## 3.1 安装 Node.js

为了避免版本兼容问题，建议直接使用 **Node.js 22 LTS 或更新版本**。

检查：

```bash
node -v
npm -v
```

如果没有 Node.js，可在 macOS 使用：

```bash
brew install node
```

---

## 3.2 安装 OpenCLI

```bash
npm install -g @jackwener/opencli
```

验证：

```bash
opencli --version
opencli list
```

诊断：

```bash
opencli doctor
```

---

## 3.3 安装 OpenCLI Browser Bridge Chrome 扩展

这是最重要的手动步骤。

OpenCLI 的携程机票、火车、酒店查询属于 Browser/Cookie 模式，需要复用真实 Chrome 的浏览器状态。

操作：

1. 打开 OpenCLI GitHub Releases。
2. 下载最新的 `opencli-extension-v*.zip`。
3. 解压。
4. Chrome 打开：

```text
chrome://extensions
```

5. 打开右上角 **开发者模式**。
6. 点击 **加载已解压的扩展程序**。
7. 选择刚才解压的扩展目录。

然后运行：

```bash
opencli doctor
```

确保 Browser Bridge / daemon 正常。

> Browser Bridge 的本地 daemon 会在需要浏览器命令时自动启动，一般不需要额外配置端口或 Token。

---

## 3.4 在 Chrome 中打开携程

打开：

```text
https://www.ctrip.com/
```

建议手动登录携程账号一次。

如果携程出现：

- 验证码
- 滑块验证
- 风控验证
- 登录确认

必须在真实 Chrome 中手动完成一次，然后重新执行 OpenCLI 查询。

MCP **不要保存携程用户名或密码**；只复用 Chrome 中已经存在的会话。

---

# 4. 先不要写 MCP，先测试 OpenCLI

Codex 在实现 MCP 之前，必须先确认下面命令在本机正常返回 JSON。

## 4.1 测试国内机票

携程 flight 当前接收 IATA/城市机场代码，例如：

```bash
opencli ctrip flight CAN SHA --date YYYY-MM-DD --limit 10 -f json
```

例如：

```text
CAN = 广州
SHA = 上海城市机场代码
BJS = 北京城市机场代码
SZX = 深圳
CTU = 成都
```

预期字段包括：

```json
{
  "airline": "...",
  "flightNo": "...",
  "aircraft": "...",
  "departureTime": "...",
  "departureAirport": "...",
  "arrivalTime": "...",
  "arrivalAirport": "...",
  "terminal": "...",
  "price": 0,
  "currency": "CNY",
  "cabin": "经济舱",
  "url": "..."
}
```

### 注意

携程当前网页卡片有时不显示稳定的航班号，因此：

```text
flightNo
aircraft
```

可能为 `null`。

这是 OpenCLI 当前 adapter 的已知限制，不要把 `null` 当程序错误。

---

## 4.2 测试往返机票

```bash
opencli ctrip flight-round SHA BJS \
  --depart YYYY-MM-DD \
  --return YYYY-MM-DD \
  --limit 10 \
  -f json
```

注意：

当前 `flight-round` 主要返回 **去程航班列表以及往返总价**。

携程选择返程航班属于下一步交互，当前 adapter 没有完整暴露，因此 MCP 中必须将此限制写入返回值：

```json
{
  "roundtrip_return_leg_complete": false
}
```

不要向 Agent 声称已经获取完整去返程组合。

---

# 5. 高铁和动车能不能查？

**可以。**

使用：

```bash
opencli ctrip train 北京 上海 --date YYYY-MM-DD --limit 20 -f json
```

或者直接指定车站：

```bash
opencli ctrip train 广州南 深圳北 --date YYYY-MM-DD --limit 20 -f json
```

返回字段包括：

```json
{
  "trainNo": "G531",
  "departureTime": "08:00",
  "arrivalTime": "13:56",
  "departureStation": "北京南",
  "arrivalStation": "上海虹桥",
  "duration": "5时56分",
  "fromPrice": 0,
  "seats": "二等座有票 / 一等座17张 / 商务座(抢)",
  "url": "..."
}
```

因此可以通过车次前缀区分：

```text
G = 高铁
D = 动车
C = 城际
Z = 直达
T = 特快
K = 快速
```

MCP 应允许 Agent 过滤：

```json
{
  "train_types": ["G", "D"]
}
```

实现方式不需要再次请求携程，只需在 OpenCLI 返回结果后：

```js
result.trainNo.startsWith("G")
result.trainNo.startsWith("D")
```

进行后处理。

### 高铁数据建议

虽然携程可以查询 G/D 车次、最低价格和席别余票，但如果项目已经接入 `12306-mcp`，建议：

```text
12306 MCP = 火车主数据源
携程 train = 备用 / 交叉验证
```

原因是 12306 更接近铁路官方数据源。

---

# 6. 住宿信息

携程 adapter 已经支持酒店搜索和酒店详情。

## 6.1 第一步：解析城市 ID

酒店搜索需要携程 city id。

例如：

```bash
opencli ctrip search 上海 --limit 10 -f json
```

或者：

```bash
opencli ctrip hotel-suggest 陆家嘴 --limit 10 -f json
```

结果中读取：

```text
cityId
```

例如携程文档示例中：

```text
上海 cityId = 2
```

MCP 不应要求最终 Agent 用户自己输入 `cityId`，应自动解析。

---

## 6.2 搜索酒店

```bash
opencli ctrip hotel-search 2 \
  --checkin YYYY-MM-DD \
  --checkout YYYY-MM-DD \
  --limit 10 \
  -f json
```

主要字段：

```json
{
  "hotelId": "...",
  "name": "...",
  "enName": "...",
  "star": 5,
  "score": 4.8,
  "scoreLabel": "超棒",
  "reviewCount": 13966,
  "cityName": "上海",
  "district": "...",
  "address": "...",
  "lat": 31.0,
  "lon": 121.0,
  "price": 700,
  "currency": "CNY",
  "url": "..."
}
```

这样 Agent 就可以结合高德继续计算：

```text
酒店 → 景点
酒店 → 高铁站
酒店 → 机场
```

的通勤距离和时间。

---

## 6.3 查询酒店详情

```bash
opencli ctrip hotel HOTEL_ID -f json
```

额外返回：

```text
星级
总评分
点评数
卫生/设施/环境/服务子评分
热门设施
入住/退房规则
地址
经纬度
```

### 酒店当前限制

必须在 MCP 中明确：

1. `hotel-search` 当前主要读取携程首屏 SSR 酒店列表。
2. 首屏通常约 10～13 家酒店，不适合假装成“携程全量酒店”。
3. `hotel-search.price` 是搜索日期条件下的代表/首个房型报价。
4. `hotel` 详情目前 **不包含完整的全部房型实时价格列表**。
5. 如果后续需要“所有房型 + 早餐 + 取消规则 + 床型 + 房态”，要额外实现携程 room XHR 的解析。

---

# 7. Codex 要实现的本地 MCP Server

项目名称建议：

```text
ctrip-travel-mcp
```

目录：

```text
ctrip-travel-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── opencli.ts
│   ├── normalize.ts
│   ├── airport_codes.ts
│   └── schemas.ts
└── README.md
```

---

# 8. 安装 MCP SDK

Codex 执行：

```bash
mkdir -p ctrip-travel-mcp
cd ctrip-travel-mcp
npm init -y

npm install @modelcontextprotocol/sdk zod
npm install -D typescript tsx @types/node
```

配置 TypeScript，并提供：

```bash
npm run build
npm run start
```

两个脚本。

最终 MCP 使用 `stdio` transport。

---

# 9. MCP Tool 设计

## 9.1 `search_flights`

输入：

```json
{
  "origin": "广州",
  "destination": "上海",
  "date": "YYYY-MM-DD",
  "limit": 10,
  "max_price": 1000,
  "sort_by": "price"
}
```

内部：

```text
中文城市
 ↓
resolve airport/metro IATA
 ↓
opencli ctrip flight CAN SHA --date ... -f json
 ↓
JSON parse
 ↓
MCP 后处理过滤 / 排序
```

输出统一格式：

```json
{
  "source": "ctrip_opencli",
  "query": {},
  "results": [
    {
      "airline": "中国南方航空",
      "flight_no": null,
      "aircraft": null,
      "departure_time": "08:20",
      "departure_airport": "广州白云国际机场",
      "arrival_time": "10:40",
      "arrival_airport": "上海虹桥国际机场",
      "terminal": "T2",
      "price": 650,
      "currency": "CNY",
      "cabin": "经济舱",
      "source_url": "..."
    }
  ]
}
```

---

## 9.2 `search_roundtrip_flights`

输入：

```json
{
  "origin": "上海",
  "destination": "北京",
  "depart_date": "YYYY-MM-DD",
  "return_date": "YYYY-MM-DD",
  "limit": 10
}
```

内部：

```bash
opencli ctrip flight-round SHA BJS \
  --depart ... \
  --return ... \
  --limit 10 \
  -f json
```

输出必须包含：

```json
{
  "return_leg_complete": false,
  "note": "当前 OpenCLI 携程 adapter 返回去程候选及往返总价，返程具体航班尚未完整解析。"
}
```

---

## 9.3 `search_trains`

输入：

```json
{
  "origin": "广州南",
  "destination": "上海虹桥",
  "date": "YYYY-MM-DD",
  "train_types": ["G", "D"],
  "limit": 20
}
```

内部：

```bash
opencli ctrip train 广州南 上海虹桥 --date ... --limit 20 -f json
```

再根据 `trainNo` 前缀过滤。

输出：

```json
{
  "train_no": "Gxxx",
  "train_type": "G",
  "departure_time": "...",
  "arrival_time": "...",
  "departure_station": "广州南",
  "arrival_station": "上海虹桥",
  "duration": "...",
  "from_price": 0,
  "seat_availability": "二等座有票 / 一等座...",
  "source_url": "..."
}
```

---

## 9.4 `search_hotels`

Agent 输入应使用自然语言城市，不要求 city id。

输入：

```json
{
  "city": "上海",
  "checkin": "YYYY-MM-DD",
  "checkout": "YYYY-MM-DD",
  "keyword": "陆家嘴",
  "min_star": 4,
  "min_score": 4.5,
  "max_price": 1000,
  "limit": 10
}
```

内部：

### Step 1

```bash
opencli ctrip search 上海 -f json
```

解析目标城市 `cityId`。

如果有 `keyword`，可辅助：

```bash
opencli ctrip hotel-suggest 陆家嘴 -f json
```

### Step 2

```bash
opencli ctrip hotel-search CITY_ID \
  --checkin ... \
  --checkout ... \
  --limit 10 \
  -f json
```

### Step 3

本地过滤：

```text
star >= min_star
score >= min_score
price <= max_price
```

不要宣称筛选覆盖携程全部酒店，因为 OpenCLI 当前主要取首屏结果。

---

## 9.5 `get_hotel_detail`

输入：

```json
{
  "hotel_id": "375539"
}
```

执行：

```bash
opencli ctrip hotel 375539 -f json
```

返回设施、评分、地址、入住规则、经纬度等。

---

# 10. 中国城市 → IATA 代码

`ctrip flight` 当前需要 IATA/metro code，因此 MCP 必须处理自然语言城市。

实现：

```text
src/airport_codes.ts
```

至少内置常见中国城市映射，例如：

```json
{
  "北京": "BJS",
  "上海": "SHA",
  "广州": "CAN",
  "深圳": "SZX",
  "成都": "CTU",
  "重庆": "CKG",
  "西安": "XIY",
  "杭州": "HGH",
  "南京": "NKG",
  "武汉": "WUH",
  "长沙": "CSX",
  "青岛": "TAO",
  "厦门": "XMN",
  "福州": "FOC",
  "昆明": "KMG",
  "三亚": "SYX",
  "海口": "HAK",
  "乌鲁木齐": "URC",
  "哈尔滨": "HRB",
  "沈阳": "SHE",
  "大连": "DLC",
  "郑州": "CGO",
  "天津": "TSN",
  "济南": "TNA",
  "桂林": "KWL",
  "南宁": "NNG",
  "宁波": "NGB",
  "温州": "WNZ",
  "合肥": "HFE"
}
```

要求：

- 用户直接传 3 位代码时直接使用。
- 对映射不存在的城市返回明确错误，不要猜。
- 后续可以接机场数据库扩展映射。

---

# 11. 调用 OpenCLI 的安全实现

不要这样做：

```js
exec(`opencli ctrip train ${origin} ${destination} ...`)
```

因为存在 shell injection 风险。

使用：

```js
spawn("opencli", [
  "ctrip",
  "train",
  origin,
  destination,
  "--date",
  date,
  "--limit",
  String(limit),
  "-f",
  "json"
])
```

所有参数必须经过 Zod 验证。

日期要求：

```text
YYYY-MM-DD
```

`limit` 做上下界限制。

MCP 只允许只读命令白名单：

```text
ctrip search
ctrip hotel-suggest
ctrip hotel-search
ctrip hotel
ctrip flight
ctrip flight-round
ctrip train
```

禁止任意传入 OpenCLI 子命令。

---

# 12. 错误处理

统一返回错误类型：

```text
OPENCLI_NOT_INSTALLED
BROWSER_BRIDGE_UNAVAILABLE
CTRIP_AUTH_REQUIRED
CTRIP_CAPTCHA_REQUIRED
NO_RESULTS
INVALID_CITY
INVALID_AIRPORT_CODE
INVALID_DATE
UPSTREAM_PARSE_ERROR
TIMEOUT
```

若 OpenCLI 返回 `AuthRequiredError` 或疑似验证页面：

返回给 Agent：

```text
携程当前要求浏览器验证。请在本机 Chrome 打开携程并完成登录/验证码，然后重试。
```

不要尝试自动绕过验证码。

---

# 13. 超时和缓存

建议：

```text
flight timeout: 30s
train timeout: 30s
hotel timeout: 30s
```

本地短期缓存：

```text
flight: 3~5 min
train: 3~5 min
hotel: 5~10 min
hotel detail: 30 min
```

缓存 key 必须包含完整查询条件。

任何实时票价都应返回：

```json
{
  "queried_at": "ISO-8601 timestamp",
  "price_may_change": true
}
```

---

# 14. Codex 本地 MCP 配置

MCP Server 编译完成后，例如：

```text
/Users/YOUR_NAME/projects/ctrip-travel-mcp/dist/index.js
```

推荐直接用 Codex CLI 添加：

```bash
codex mcp add ctrip-travel -- node /Users/YOUR_NAME/projects/ctrip-travel-mcp/dist/index.js
```

查看：

```bash
codex mcp list
```

进入 Codex 后：

```text
/mcp
```

确认 `ctrip-travel` 已连接。

也可以手动编辑：

```text
~/.codex/config.toml
```

加入：

```toml
[mcp_servers.ctrip-travel]
command = "node"
args = ["/Users/YOUR_NAME/projects/ctrip-travel-mcp/dist/index.js"]
```

如果希望仅当前项目生效，也可以放在：

```text
<project>/.codex/config.toml
```

官方 Codex MCP 文档：

https://developers.openai.com/docs/extend/mcp

---

# 15. Codex 必须实现的验收测试

## Test A：航班

输入：

```text
查询广州到上海某日期的国内航班，按价格排序。
```

检查：

```text
✓ airline
✓ departure / arrival
✓ airport
✓ price
✓ currency = CNY
✓ cabin
```

`flightNo = null` 可以接受。

---

## Test B：高铁

输入：

```text
查询广州南到深圳北，只返回 G/D 车次。
```

检查：

```text
✓ G / D 前缀过滤正确
✓ 出发/到达站
✓ 时间
✓ duration
✓ fromPrice
✓ seats
```

---

## Test C：住宿

输入：

```text
查询上海某日期入住、某日期退房，4 星以上、评分 4.5 以上、价格低于 1000 元的酒店。
```

检查：

```text
✓ 自动解析 cityId
✓ 酒店名称
✓ 星级
✓ 评分
✓ 点评数
✓ 地址
✓ price
✓ CNY
✓ 经纬度
```

---

## Test D：酒店详情

选择一个 `hotelId`：

```text
✓ facilities
✓ ratingBreakdown
✓ checkInOut
✓ address
✓ lat/lon
```

---

## Test E：Browser Bridge 异常

关闭 Chrome 或禁用扩展：

MCP 应返回可理解的错误，而不是崩溃。

---

# 16. 推荐的数据源分工

你的旅行 Agent 最终推荐这样设计：

```text
                         Travel Agent
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
      12306 MCP       Ctrip Travel MCP        高德 MCP/API
          │                   │                   │
       高铁/动车        国内航班 + 酒店           路线/接驳
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                         Planner / Ranker
                              │
                              ▼
                door-to-door 行程方案 + 住宿
```

建议职责：

```text
火车：12306 MCP 主，携程 train 备用
飞机：携程 flight 主
住宿：携程 hotel-search / hotel 主
市内交通：高德主
攻略内容：小红书 MCP
```

---

# 17. Agent 最终应该能够处理的自然语言

例如：

```text
帮我规划 10 月 3 日从广州去上海，10 月 6 日返回。

要求：
1. 比较高铁和飞机。
2. 高铁优先 G/D 车次。
3. 飞机找价格较低的直飞方案。
4. 找上海市区评分 4.5 以上的酒店。
5. 酒店每晚预算 800 元以内。
6. 结合高德计算机场/高铁站到酒店的时间。
7. 最终按总价格和 door-to-door 时间整理方案。
```

Agent 应分别调用：

```text
12306 MCP
ctrip-travel.search_flights
ctrip-travel.search_hotels
ctrip-travel.get_hotel_detail
高德 MCP
```

然后统一聚合。

---

# 18. Codex 实现约束

Codex 执行本计划时必须遵守：

1. 不修改 OpenCLI 源码，优先把它当稳定 CLI 依赖。
2. MCP 只做薄封装和字段标准化。
3. 不实现购票、订房、支付。
4. 不存储携程账号密码或 Cookie。
5. 不绕过验证码。
6. OpenCLI 输出必须 JSON parse，禁止依赖终端表格文本。
7. 对所有用户输入做 schema 验证。
8. 使用 `spawn` 参数数组，禁止拼 shell command。
9. 所有实时价格必须标记查询时间和“价格可能变化”。
10. 酒店搜索明确说明当前 OpenCLI 首屏结果数量有限。
11. 往返航班明确说明返程 leg 当前不完整。
12. 火车优先让 12306 MCP 成为正式主源。

---

# 19. 用户最终只需要手动做的事情

一次性：

```text
[ ] 安装 Node.js 22+
[ ] npm install -g @jackwener/opencli
[ ] 安装 OpenCLI Browser Bridge Chrome 扩展
[ ] Chrome 打开携程并登录/完成一次验证
[ ] opencli doctor 确认成功
```

Codex 可以自动完成：

```text
[ ] 创建 ctrip-travel-mcp 项目
[ ] 安装 MCP SDK
[ ] 写 TypeScript MCP Server
[ ] 写机场代码映射
[ ] 写 OpenCLI wrapper
[ ] 写 schema / normalize / error handling
[ ] build
[ ] 添加 Codex MCP 配置
[ ] 跑 flight/train/hotel smoke tests
```

正常使用时，一般不需要人工干预；只有携程要求重新登录或弹验证码时，需要用户回到 Chrome 手动完成验证。
