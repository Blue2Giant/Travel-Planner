# 小红书原帖链接补全方案

## 1. 当前问题

现在的小红书攻略流程中，帖子内容可以正常获取，但最终生成的攻略里只有 `note_id / feed_id`，**无法直接跳转回小红书原帖**。

目标：为每条来源补充一个可点击的 `source_url`，并在最终 HTML 中提供“查看原帖”入口。

---

## 2. 原因

部分小红书 MCP 不会直接返回原帖 URL，而是返回：

```json
{
  "id": "feed_id",
  "xsecToken": "..."
}
```

后续详情查询也是通过：

```text
feed_id + xsec_token
```

完成，因此不能假设 MCP 响应里一定存在 `url` 字段。

---

## 3. 推荐修改位置

不要让攻略生成 Agent 临时拼 URL。

建议在 **Xiaohongshu MCP Adapter / 数据标准化层**统一补充 `source_url`：

```text
Xiaohongshu MCP
      ↓
feed_id + xsec_token
      ↓
XHS Adapter / Normalizer
      ↓
标准化 Source JSON
      ↓
攻略生成 Agent
      ↓
HTML
```

---

## 4. 标准化字段

建议每条来源至少保存：

```json
{
  "note_id": "...",
  "xsec_token": "...",
  "source_url": "...",
  "title": "...",
  "author": "...",
  "content": "...",
  "images": []
}
```

优先级：

1. 如果 MCP 已返回 `sourceUrl / url / noteUrl`，直接使用；
2. 如果没有，则根据 `feed_id + xsec_token` 生成；
3. `feed_id` 和 `xsec_token` 必须继续保留，供后续 MCP 查询使用。

---

## 5. URL 生成方式

当 MCP 没有直接返回 URL 时，可生成：

```text
https://www.xiaohongshu.com/explore/{feed_id}?xsec_token={xsec_token}&xsec_source=pc_feed
```

示例：

```js
function buildXhsSourceUrl(feedId, xsecToken) {
  if (!feedId) return null;

  if (xsecToken) {
    return `https://www.xiaohongshu.com/explore/${feedId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_feed`;
  }

  return `https://www.xiaohongshu.com/explore/${feedId}`;
}
```

注意：如果当前 MCP 已提供更稳定的 `sourceUrl`，应优先使用 MCP 返回值，不要覆盖。

---

## 6. HTML 展示

最终攻略中，每个来源增加：

```html
<a href="{{source_url}}" target="_blank" rel="noopener noreferrer">
  查看小红书原帖
</a>
```

如果 `source_url` 为空，则隐藏该按钮，不要生成无效链接。

---

## 7. Agent 修改要求

请检查当前项目中：

- 小红书 MCP 原始响应；
- 帖子标准化逻辑；
- 来源 JSON Schema；
- 攻略 HTML 模板。

完成以下修改：

- 自动识别 MCP 返回的 `sourceUrl / url / noteUrl`；
- 如果不存在，使用 `feed_id + xsec_token` 补全；
- 将 `source_url` 写入标准化来源 JSON；
- HTML 中增加“查看小红书原帖”链接；
- 保留现有 `note_id` 和来源引用关系；
- 不影响现有只读流程；
- 不增加发布、点赞、评论、收藏等写操作。

---

## 8. 验收标准

修改后任意一条攻略来源应满足：

```json
{
  "note_id": "xxx",
  "source_url": "https://www.xiaohongshu.com/..."
}
```

最终 HTML 中：

```text
来源：某篇小红书笔记
[查看小红书原帖]
```

点击后能够打开对应帖子。

如果 MCP 原始结果本身没有 URL，也必须由 Adapter 层补全，而不是让最终攻略生成阶段猜测链接。
