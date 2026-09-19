# Xiaohongshu Travel Guide MCP MVP Plan

## 目标

在当前 `Travel-Planner` 项目中实现一个最小可运行 Demo：

```text
用户输入一个旅游目的地
例如：
京都
东京
上海
成都
香港

        ↓

Codex 调用 xiaohongshu-mcp
搜索相关旅游攻略

        ↓

读取若干高质量小红书帖子

        ↓

提取：
- 地点 / 景点
- 特色体验
- 特色美食
- 推荐住宿区域
- 实用 Tips
- 原始参考帖子

        ↓

生成：

output/<destination>.html
```

最终 HTML 必须能够直接用浏览器打开。

第一版只使用小红书的**读取功能**。

禁止调用：

```text
publish_content
publish_with_video
post_comment_to_feed
reply_comment_in_feed
like_feed
favorite_feed
```

只允许使用：

```text
check_login_status
search_feeds
get_feed_detail
```

---

## Phase 1：准备 xiaohongshu-mcp

### 1. 创建工具目录

不要把 binary 放到项目源码目录。

创建：

```text
~/tools/xiaohongshu-mcp/
```

最终：

```text
~/tools/xiaohongshu-mcp/
├── xiaohongshu-login-darwin-arm64
└── xiaohongshu-mcp-darwin-arm64
```

如果当前机器不是 Apple Silicon：

先执行：

```bash
uname -m
```

如果：

```text
arm64
```

使用：

```text
xiaohongshu-login-darwin-arm64
xiaohongshu-mcp-darwin-arm64
```

---

## Phase 2：下载 binary

从官方 GitHub Release：

```text
https://github.com/xpzouying/xiaohongshu-mcp/releases
```

下载最新版本：

```text
xiaohongshu-login-darwin-arm64
xiaohongshu-mcp-darwin-arm64
```

添加执行权限：

```bash
chmod +x ~/tools/xiaohongshu-mcp/xiaohongshu-login-darwin-arm64
chmod +x ~/tools/xiaohongshu-mcp/xiaohongshu-mcp-darwin-arm64
```

不要使用 Docker。

---

## Phase 3：第一次登录

第一次需要用户手动完成一次登录。

运行：

```bash
cd ~/tools/xiaohongshu-mcp

./xiaohongshu-login-darwin-arm64
```

如果出现二维码或浏览器登录界面：

暂停自动执行。

提示用户：

```text
请完成小红书登录，登录成功后告诉我继续。
```

不要尝试绕过登录。

登录成功之后检查：

```text
~/.xiaohongshu/cookies.json
```

确认文件存在。

不要：

- 打印 Cookie 内容
- 把 Cookie 加入 Git
- 把 Cookie 拷贝进项目目录

---

## Phase 4：启动 MCP Server

执行：

```bash
cd ~/tools/xiaohongshu-mcp

./xiaohongshu-mcp-darwin-arm64
```

默认使用：

```text
headless=true
```

开发调试如果失败，可以临时：

```bash
./xiaohongshu-mcp-darwin-arm64 -headless=false
```

MCP Server 默认地址：

```text
http://localhost:18060/mcp
```

---

## Phase 5：连接 Codex

检查是否已经存在：

```bash
codex mcp list
```

如果没有 `xiaohongshu`：

执行：

```bash
codex mcp add xiaohongshu \
  --url http://localhost:18060/mcp
```

再次：

```bash
codex mcp list
```

然后在 Codex TUI 中检查：

```text
/mcp
```

应该能看到：

```text
xiaohongshu
```

---

## Phase 6：验证登录状态

调用：

```text
check_login_status
```

必须确认：

```text
logged in
```

或者语义等价的登录成功状态。

如果未登录：

停止后续搜索。

重新运行：

```bash
~/tools/xiaohongshu-mcp/xiaohongshu-login-darwin-arm64
```

不要在未登录状态下继续执行 Demo。

---

## Phase 7：创建 Demo 项目结构

在：

```text
Travel-Planner/
```

创建：

```text
Travel-Planner/
│
├── AGENTS.md
├── README.md
│
├── data/
│   ├── raw/
│   └── processed/
│
├── output/
│
├── templates/
│   └── travel-guide.html
│
└── scripts/
    └── README.md
```

其中：

```text
data/raw/
```

保存 MCP 搜索和帖子详情原始结果。

```text
data/processed/
```

保存经过归一化后的旅游攻略 JSON。

```text
output/
```

保存最终 HTML。

---

## Phase 8：输入方式

第一版不需要做 Web 表单。

由用户直接告诉 Codex：

```text
生成「京都」的小红书旅游攻略 Demo。
```

或者：

```text
DESTINATION=京都
```

Codex 接收到目的地后自动执行完整流程。

例如：

```text
京都
```

---

## Phase 9：搜索策略

不要只搜索一次：

```text
京都
```

至少执行以下搜索：

```text
京都 旅游攻略
京都 美食
京都 住宿
京都 景点
```

可以额外：

```text
京都 一日游
京都 避坑
京都 小众
```

但第一版最多：

```text
5 个 keyword
```

避免产生大量 MCP 调用。

---

## Phase 10：搜索过滤策略

调用：

```text
search_feeds
```

推荐默认：

```json
{
  "keyword": "京都 旅游攻略",
  "filters": {
    "sort_by": "综合",
    "note_type": "不限",
    "publish_time": "半年内",
    "search_scope": "不限",
    "location": "不限"
  }
}
```

同时可针对：

```text
京都 美食
```

执行：

```json
{
  "filters": {
    "sort_by": "最多收藏",
    "publish_time": "半年内"
  }
}
```

目的不是简单追求点赞最高，而是获得：

```text
综合攻略
+
美食
+
住宿
+
景点
```

不同类型信息。

---

## Phase 11：帖子筛选

不要读取所有搜索结果。

建立候选池之后：

```text
最多选择 8～12 篇帖子
```

第一版建议：

```text
8 篇
```

目标覆盖：

```text
3 篇 综合攻略 / 景点
2 篇 美食
2 篇 住宿
1 篇 Tips / 避坑
```

如果类别不足，可以由其他类别补齐。

优先考虑：

```text
标题与目的地高度相关

正文信息丰富

收藏 / 点赞 / 评论相对较高

不是明显广告

不是单纯自拍

不是仅有一句话的短帖
```

不要只依据点赞数。

---

## Phase 12：读取帖子详情

每个选中的搜索结果必须保存：

```text
feed_id
xsec_token
```

然后调用：

```text
get_feed_detail
```

参数：

```json
{
  "feed_id": "...",
  "xsec_token": "...",
  "load_all_comments": false
}
```

第一版：

```text
load_all_comments = false
```

不要大量展开评论。

默认返回的少量评论已经足够用于辅助判断：

```text
是否踩雷
是否排队严重
是否值得去
住宿交通是否方便
```

---

## Phase 13：保存原始结果

所有 MCP 数据都要先保存。

例如：

```text
data/raw/kyoto-search-travel.json
data/raw/kyoto-search-food.json
data/raw/kyoto-search-hotel.json

data/raw/posts/
├── <feed_id_1>.json
├── <feed_id_2>.json
└── ...
```

不要只在 LLM context 中使用后丢弃。

方便后续：

```text
Debug
数据检查
重新生成 HTML
未来接高德地图
```

---

## Phase 14：统一帖子数据结构

创建：

```text
data/processed/kyoto-sources.json
```

每篇帖子规范成：

```json
{
  "feedId": "",
  "xsecToken": "",

  "title": "",
  "author": "",

  "content": "",

  "metrics": {
    "likes": null,
    "favorites": null,
    "comments": null
  },

  "category": [
    "attraction",
    "food"
  ],

  "mentionedPlaces": [],

  "foodMentions": [],

  "hotelAreaMentions": [],

  "tips": [],

  "sourceUrl": ""
}
```

---

## Phase 15：参考帖子 URL

最终 HTML 中每条结论必须能够追溯到帖子。

首先检查 MCP response 是否直接包含：

```text
url
link
share_url
note_url
```

如果存在：

直接使用 MCP 返回的 URL。

如果不存在：

可以根据：

```text
feed_id
xsec_token
```

生成小红书 Web URL。

将 URL 生成封装为：

```text
buildXiaohongshuUrl(feedId, xsecToken)
```

不要把 URL 模板散落在 HTML 生成代码中。

生成后必须实际验证至少 2～3 个链接可以在浏览器打开。

如果当前小红书 URL 格式变化：

不要伪造 URL。

应该重新从浏览器实际打开帖子并确认 URL 格式。

---

## Phase 16：信息抽取规则

### 景点 / 地点

提取：

```text
景点名
街区
商圈
寺庙
公园
市场
购物地点
咖啡馆
餐厅
```

每个地点尽量记录：

```json
{
  "name": "清水寺",
  "type": "attraction",
  "reason": "适合上午游览，周边可继续步行至二年坂三年坂",
  "sourceFeedIds": [
    "xxx",
    "yyy"
  ]
}
```

不要把一个帖子提到一次的内容直接描述成：

```text
“大家都推荐”
```

---

## Phase 17：美食总结

最终必须包含：

```text
特色美食推荐
```

分成两个层次：

### 特色类别

例如：

```text
抹茶甜品
汤豆腐
怀石料理
烧鸟
拉面
```

### 具体店铺

只有帖子明确提到了店铺时才能写。

例如：

```json
{
  "name": "...",
  "category": "抹茶甜品",
  "reason": "...",
  "sourceFeedIds": []
}
```

禁止凭 LLM 记忆自行补充小红书帖子中没有出现的餐厅。

---

## Phase 18：住宿推荐

不要直接推荐具体酒店作为第一目标。

优先总结：

```text
推荐住宿区域
```

例如：

```text
京都站附近
四条河原町
祇园
```

每个区域输出：

```text
适合谁

优点

缺点

交通特点

附近主要玩法
```

例如：

```json
{
  "area": "京都站附近",
  "goodFor": "第一次来京都、需要频繁坐 JR 的游客",
  "pros": [],
  "cons": [],
  "sourceFeedIds": []
}
```

只有帖子明确大量提及某家酒店时才列具体酒店。

---

## Phase 19：事实归纳规则

所有旅游建议分成：

```text
多帖共同提及
单帖经验
编辑总结
```

HTML 中表现方式不同。

例如：

```text
🔥 多篇攻略反复推荐
```

需要：

```text
至少 2 个独立 sourceFeedId
```

如果只有一个：

```text
💡 一位作者提到
```

不要写成共识。

---

## Phase 20：生成最终 JSON

生成：

```text
data/processed/kyoto-guide.json
```

Schema：

```json
{
  "destination": "京都",

  "summary": "",

  "highlights": [
    {
      "name": "",
      "description": "",
      "sources": []
    }
  ],

  "food": [
    {
      "name": "",
      "type": "",
      "reason": "",
      "sources": []
    }
  ],

  "stayAreas": [
    {
      "name": "",
      "goodFor": "",
      "pros": [],
      "cons": [],
      "sources": []
    }
  ],

  "tips": [
    {
      "text": "",
      "sources": []
    }
  ],

  "sources": [
    {
      "feedId": "",
      "title": "",
      "author": "",
      "url": "",
      "likes": null,
      "favorites": null
    }
  ]
}
```

HTML 必须从这个 JSON 生成。

不要：

```text
MCP → 直接写 HTML
```

而应该：

```text
MCP
 ↓
raw JSON
 ↓
processed JSON
 ↓
HTML
```

---

## Phase 21：HTML 设计

生成：

```text
output/kyoto-travel-guide.html
```

页面使用：

```text
HTML
CSS
少量 Vanilla JavaScript
```

不要引入 React。

不要依赖外部 build system。

要求：

```text
双击 HTML 就能打开
```

---

## Phase 22：页面布局

页面大概：

```text
┌──────────────────────────────────────────┐
│             京都旅行攻略                  │
│                                          │
│ 基于 8 篇近期小红书旅行笔记整理            │
└──────────────────────────────────────────┘


🔥 值得去的地方

清水寺
二年坂三年坂
伏见稻荷
鸭川
...

────────────────────────────────────────────

🍜 特色美食

抹茶甜品
推荐理由……
参考：帖子 ① ③

汤豆腐
推荐理由……
参考：帖子 ④

────────────────────────────────────────────

🏨 推荐住宿区域

京都站
适合：第一次来京都
优点：……
缺点：……

四条河原町
适合：喜欢购物、餐饮
……

────────────────────────────────────────────

💡 实用 Tips

• XX 时间人最多
• XX 地点适合上午去
• XX 需要提前预约

────────────────────────────────────────────

📚 参考的小红书帖子

① 京都三天两夜攻略
作者：xxx
👍 2.3k   ⭐ 1.1k
[查看原帖]

② 京都美食合集
作者：xxx
👍 1.5k   ⭐ 900
[查看原帖]
```

---

## Phase 23：来源引用

每个内容卡片显示来源编号。

例如：

```text
清水寺

多数攻略建议尽早前往，
上午人流通常相对较少。

来源：① ③ ⑥
```

点击：

```text
①
```

滚动到底部：

```text
参考帖子 ①
```

并提供：

```text
查看原帖 →
```

链接必须：

```html
target="_blank"
rel="noopener noreferrer"
```

---

## Phase 24：禁止幻觉

必须遵守：

```text
小红书帖子没有提到的地点
不要加入。

帖子没有提供的价格
不要猜。

帖子没有提供的营业时间
不要猜。

帖子之间说法冲突
明确说明存在不同体验。

无法确认的数据
写“帖子中未提供”。
```

Codex 自己已有的旅游知识不能作为这个 Demo 的事实来源。

这个 Demo 的目的就是测试：

```text
xiaohongshu-mcp
```

的数据能力。

---

## Phase 25：HTML 页面视觉

要求：

```text
简洁
旅行杂志风格
白色 / 浅色背景
最大宽度 1100px
响应式布局
Card UI
```

包含：

```text
Destination Hero
Highlights
Food
Accommodation Areas
Travel Tips
Sources
```

不要过度动画。

---

## Phase 26：README

README 写清楚：

```text
# Start Xiaohongshu MCP

~/tools/xiaohongshu-mcp/xiaohongshu-mcp-darwin-arm64
```

然后：

```text
# Start Codex

cd ~/Documents/Travel-Planner
codex
```

Demo Prompt：

```text
使用 xiaohongshu MCP，
帮我生成京都旅游攻略 Demo。

搜索近期攻略、美食和住宿内容，
读取约 8 篇有代表性的帖子。

总结：
1. 推荐地点
2. 特色美食
3. 推荐住宿区域
4. 实用 Tips

保留所有参考帖子链接。

按照项目规范输出：

data/raw/
data/processed/kyoto-guide.json
output/kyoto-travel-guide.html
```

---

## Phase 27：AGENTS.md

在项目根目录添加：

```text
AGENTS.md
```

至少写：

```markdown
# Xiaohongshu Research Rules

Use Xiaohongshu MCP only for read operations unless explicitly requested.

Allowed:
- check_login_status
- search_feeds
- get_feed_detail

Do not automatically:
- publish
- comment
- reply
- like
- favorite

For travel-guide generation:

1. Search multiple query variants.
2. Select a diverse set of posts.
3. Fetch full post details.
4. Preserve feed_id and xsec_token.
5. Save raw MCP responses.
6. Normalize sources before summarization.
7. Every recommendation must reference source feed IDs.
8. Never invent locations, restaurants, hotels, prices or opening hours.
9. Preserve valid source URLs in the final HTML.
10. Generate the final report from processed JSON rather than directly from MCP output.
```

---

## Phase 28：最小 Demo 测试

使用：

```text
目的地：京都
```

测试流程：

```text
check_login_status
        ↓
search "京都 旅游攻略"
        ↓
search "京都 美食"
        ↓
search "京都 住宿"
        ↓
select ~8 posts
        ↓
get_feed_detail × ~8
        ↓
save raw JSON
        ↓
normalize
        ↓
summarize
        ↓
generate HTML
```

---

## Phase 29：验收标准

必须满足：

### MCP

```text
✓ xiaohongshu-mcp 正常运行
✓ Codex /mcp 可以看到 xiaohongshu
✓ check_login_status 成功
```

### 数据

```text
✓ 至少 3 组关键词搜索
✓ 至少读取 6 篇帖子详情
✓ 推荐 8 篇左右
✓ 每篇保存 feed_id
✓ 每篇保存 xsec_token
✓ 原始数据被保存
```

### 内容

HTML 至少包括：

```text
✓ 目的地简介
✓ 推荐地点
✓ 特色美食
✓ 推荐住宿区域
✓ 实用旅行 Tips
✓ 参考帖子列表
```

### 来源

```text
✓ 每条主要推荐有来源
✓ 至少 6 个原帖链接
✓ 点击链接可以打开对应小红书帖子
✓ 不允许伪造来源
```

### 输出

最终必须产生：

```text
data/processed/kyoto-guide.json

output/kyoto-travel-guide.html
```

并自动打开 HTML：

macOS：

```bash
open output/kyoto-travel-guide.html
```

---

## Phase 30：最终演示效果

理想流程：

```text
User:
帮我查京都的小红书旅游攻略

        ↓

Codex
        ↓
Xiaohongshu MCP

        ↓

搜索：
京都旅游攻略
京都美食
京都住宿

        ↓

读取 8 篇帖子

        ↓

结构化提取

        ↓

┌────────────────────────────┐
│       京都旅行攻略           │
│                            │
│ 🔥 推荐地点                 │
│ 🍜 特色美食                 │
│ 🏨 推荐住宿区域              │
│ 💡 实用 Tips                │
│ 📚 小红书参考帖子            │
└────────────────────────────┘

        ↓

output/kyoto-travel-guide.html
```

---

## 本阶段不要做的事情

暂时不要接：

```text
高德地图
路线规划
距离计算
酒店 Booking
天气
航班
小红书自动发布
```

这一阶段只验证一件事情：

```text
xiaohongshu
      ↓
旅游内容检索
      ↓
结构化信息抽取
      ↓
带来源的旅游攻略 HTML
```

这个链路稳定以后，再把输出的：

```text
mentionedPlaces
food
stayAreas
```

交给高德模块进行：

```text
POI 标准化
经纬度定位
路线计算
地图渲染
```
