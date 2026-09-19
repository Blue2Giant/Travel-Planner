const BAD_ENTITY_PATTERNS = [
  '也离', '我发现', '个人建议', '不一样', '依山而建', '适合', '优点', '注意', '千年古城',
  '下高铁', '去民宿', '一天给', '上午', '下午', '出发', '行程'
  , '不要导航', '一下车', '就能看到', '得搜', '离龟山', '之后', '先环湖', '一路穿梭', '一次是去', '的是上'
];
const GENERIC_PLACE_WORDS = new Set(['机场', '车站', '古城', '市区', '县城', '景区', '湿地', '环湖', '附近', '周边']);
const PLACE_SUFFIX = /(?:古城|寺|湖|雪山|峡谷|草原|公园|村|塔|广场|景区|博物馆|市场|湿地|江|山|海)$/;
const TIP_TERMS = /预约|开放|门票|高反|海拔|防晒|温差|交通|打车|自驾|公交|徒步|拍照|禁止|避坑|排队|时间|路况|习俗/;
const FOOD_SUFFIX = /(?:火锅|米线|米糕|米粉|烤肉|羊排|烤包子|包子|酥油茶|青稞饼|藏香猪|牲牛肉|咖啡|茶|鱼)$/;
const CANONICAL_FOODS = ['牦牛肉火锅', '藏式火锅', '牛肉米线', '酥油茶', '青稞饼', '酥油烤包子', '手抓羊排', '藏香猪', '奶渣蛋卷', '玉米粑粑', '藏香排骨'];

const clean = (value) => String(value || '')
  .replace(/#[^#\n]+\[话题\]#/g, ' ')
  .replace(/[\u200b-\u200f\u00a0]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const unique = (items) => [...new Set(items.filter(Boolean))];
const cut = (value, maximum) => clean(value).slice(0, maximum);

export function likelyBadEntity(value) {
  const name = clean(value).replace(/^(?:第?[\d一二三四五六七八九十]+(?:站|点|号)\s*[:：-]?|[#\s:：-]+)/, '').trim();
  return name.length < 2 || name.length > 30 || GENERIC_PLACE_WORDS.has(name) || /[-–—]/.test(name)
    || BAD_ENTITY_PATTERNS.some((pattern) => name.includes(pattern));
}

export function canonicalEntityName(value) {
  let name = clean(value)
    .replace(/^[📍\s:：>→➡\d第站号-]+/gu, '')
    .replace(/[\uff08(].*?[\uff09)]/g, '')
    .replace(/^(?:午饭后打车去|回古城可以去|顺路打卡|最后选择了|途径|远眺|基本是|整体是|游玩|打卡|推荐|去|到)+/u, '')
    .replace(/(?:景区|旅游区)$/u, '')
    .trim();
  const aliases = new Map([
    ['松赞林', '噶丹·松赞林寺'], ['松赞林寺', '噶丹·松赞林寺'], ['噶丹松赞林寺', '噶丹·松赞林寺'],
    ['普达措', '普达措国家公园'], ['独克宗', '独克宗古城']
  ]);
  return aliases.get(name) || name;
}

function explicitPlaces(content) {
  const found = [];
  const marker = /(?:\ud83d\udccd|(?:第[\d一二三四五六七八九十\ufe0f⃣]+站)\s*[:：]?\s*(?:\ud83d\udccd)?)([\p{L}\p{N}·・]{2,24}?)(?=\s|[:：，。\uff01\uff1f,!?\ud83d\udccd]|$)/gu;
  for (const match of content.matchAll(marker)) found.push(match[1]);
  for (const route of content.matchAll(/(?:Day\d+|D\d+|路线(?:安排)?)\s*[:：]\s*([^。\uff01\uff1f\n]{4,180})/gi)) {
    if (!/(?:→|➡️?|👉|->|－|—|\|)/.test(route[1])) continue;
    for (const token of route[1].split(/(?:→|➡️?|\ud83d\udc49|->|－|—|\|)/)) {
      const name = token.replace(/^[\s\d第站号:：]+|[\s，。\uff01\uff1f].*$/gu, '').trim();
      if (PLACE_SUFFIX.test(name) || (name.length >= 3 && name.length <= 8)) found.push(name);
    }
  }
  const prose = /(?:^|[，。；：、]|去|到|逛|看|游玩|打卡|推荐|途径|远眺)([\p{L}·]{2,12}?(?:古城|寺|湖|雪山|峡谷|草原|公园|村|塔|广场|景区|博物馆|市场|湿地|海))(?=[，。；：、\s和与]|$)/gu;
  for (const match of content.matchAll(prose)) found.push(match[1]);
  return unique(found.map(canonicalEntityName).filter((name) => !likelyBadEntity(name)));
}

function sentenceAround(content, name, maximum = 100) {
  const sentence = content.split(/[。\uff01\uff1f;；]/).map(clean).find((item) => item.includes(name));
  return cut(sentence || `原帖提及${name}`, maximum);
}

function foods(content) {
  const found = [];
  for (const block of content.matchAll(/(?:特色美食|美食|必吃|推荐吃)[:：]\s*([^。\uff01\uff1f\n]{2,160})/g)) {
    const withoutAsides = block[1].replace(/[（(][^）)]*[）)]/g, '');
    for (const item of withoutAsides.split(/[，、/|和]\s*/)) {
      const name = clean(item).replace(/^[\d\.、-\s]+/, '').replace(/[\s（(].*$/, '');
      if (name.length >= 2 && name.length <= 14 && FOOD_SUFFIX.test(name)) found.push(name);
    }
  }
  const dish = /(?:^|[，。；：、\s]|吃|点了|午餐|推荐)([\p{L}·]{2,12}?(?:牦牛肉火锅|牛肉米线|酥油茶|青稞饼|烤包子|手抓羊排|藏香猪))(?=[，。；：、\s和与（(]|$)/gu;
  for (const match of content.matchAll(dish)) found.push(match[1]);
  for (const name of CANONICAL_FOODS) if (content.includes(name)) found.push(name);
  return unique(found).slice(0, 8);
}

function stayAreas(content) {
  const found = [];
  const patterns = [
    /(?:住|住在|住宿选|建议住)([\p{L}\p{N}·]{2,12}(?:古城|市区|县城|车站|机场)(?:内|外|北门|南门|附近|周边)?)/gu,
    /([\p{L}\p{N}·]{2,12}(?:北门|南门|东门|西门|车站|机场)附近)/gu
  ];
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) found.push(clean(match[1]).replace(/^(?:在了?|于)/, ''));
  return unique(found.filter((name) => !likelyBadEntity(name))).slice(0, 5);
}

function tips(content) {
  return unique(content.split(/[。\uff01\uff1f;；]|(?=[⚠✅📌💡])/).map((item) => clean(item).replace(/^[⚠✅📌💡]+\s*/, '')).filter((sentence) => TIP_TERMS.test(sentence)))
    .map((sentence) => cut(sentence, 100)).slice(0, 6);
}

export function compressNote(note, { kind = 'overview', sourceUrl = '' } = {}) {
  const content = clean(note.desc || note.content);
  const names = explicitPlaces(content);
  const images = (note.imageList || note.images || []).map((image, index) => ({
    index,
    url: typeof image === 'string' ? image : image.urlDefault || image.url || image.urlPre || '',
    width: typeof image === 'object' ? image.width ?? null : null,
    height: typeof image === 'object' ? image.height ?? null : null,
    ocrText: null,
    semanticHint: null
  })).filter((image) => image.url);
  const metrics = note.interactInfo || note.metrics || {};
  const attractions = names.map((name) => ({
    name,
    reason: sentenceAround(content, name, 60),
    routeMentions: [],
    tips: tips(content).filter((tip) => tip.includes(name)),
    sentiment: 'neutral',
    imageEvidence: names.length === 1 && images.length ? [{
      url: images[0].url, caption: '来源帖首图（景点通用图）', sourceImageIndex: 0, confidence: 0.5
    }] : []
  }));
  return {
    feedId: note.noteId || note.feedId || note.id || '',
    xsecToken: note.xsecToken || note.xsec_token || '',
    title: cut(note.title, 100),
    author: note.user?.nickname || note.author || '',
    authorId: note.user?.userId || note.authorId || '',
    sourceUrl,
    publishTime: note.time || note.publishTime || null,
    metrics: {
      likes: metrics.likedCount ?? metrics.likes ?? null,
      favorites: metrics.collectedCount ?? metrics.favorites ?? metrics.collects ?? null,
      comments: metrics.commentCount ?? metrics.comments ?? null,
      shares: metrics.sharedCount ?? metrics.shares ?? null
    },
    category: [kind],
    content: cut(content, 700),
    images,
    mentionedPlaces: attractions,
    foodMentions: foods(content).map((name) => ({ name, category: '当地美食', reason: `原帖将${name}列为当地美食；具体口味与店铺选择请查看来源帖子。`, imageEvidence: [] })),
    hotelAreaMentions: stayAreas(content).map((area) => ({
      area, goodFor: '以原帖住宿场景为准', pros: [cut(sentenceAround(content, area), 90)], cons: [], images: []
    })),
    tips: tips(content).map((text) => ({ text })),
    routeMapImageIndices: []
  };
}
