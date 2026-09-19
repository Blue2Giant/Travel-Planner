# Xiaohongshu guide demo rules

- This demo is read-only with respect to Xiaohongshu. Never call publishing, commenting, liking, or favoriting tools.
- Persist MCP search/detail responses under `data/raw/` before generating a guide.
- Treat a recommendation as multi-post consensus only when it has at least two distinct feed IDs.
- Normalize source URLs in the adapter: prefer an MCP-provided URL, otherwise build the documented `explore/{feed_id}` URL with its retained `xsec_token`; never build URLs ad hoc in HTML rendering.
