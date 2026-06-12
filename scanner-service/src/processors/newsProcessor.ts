// ============================================================
// NEWS & MACRO PROCESSOR
// Fetches crypto news from CryptoPanic (free tier) and
// filters for high-impact macro events.
// ============================================================

import { createLogger } from '../utils/constants';

const logger = createLogger('news-processor');

const CRYPTOPANIC_KEY = process.env.CRYPTOPANIC_API_KEY || 'free';
const BASE_URL        = 'https://cryptopanic.com/api/v1';

export interface NewsItem {
  id:          number;
  title:       string;
  url:         string;
  source:      string;
  currencies:  string[];
  kind:        'news' | 'media' | 'analysis';
  votes:       { positive: number; negative: number; important: number };
  publishedAt: string;
  sentiment:   'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impact:      'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Keywords that indicate high-impact macro events
const HIGH_IMPACT_KEYWORDS = [
  'SEC', 'ETF', 'Fed', 'Federal Reserve', 'interest rate', 'FOMC',
  'ban', 'regulation', 'hack', 'exploit', 'bankruptcy', 'collapse',
  'halving', 'fork', 'upgrade', 'partnership', 'acquisition',
  'liquidation', 'margin call', 'whale', 'dump', 'pump',
];

const BEARISH_KEYWORDS = ['ban', 'hack', 'exploit', 'bankruptcy', 'collapse', 'crash', 'dump', 'sell', 'fear'];
const BULLISH_KEYWORDS = ['ETF', 'approval', 'partnership', 'adoption', 'upgrade', 'bull', 'buy', 'pump', 'surge'];

function classifyNews(title: string, votes: NewsItem['votes']): { sentiment: NewsItem['sentiment']; impact: NewsItem['impact'] } {
  const lower = title.toLowerCase();

  const bearishScore = BEARISH_KEYWORDS.filter(k => lower.includes(k.toLowerCase())).length;
  const bullishScore = BULLISH_KEYWORDS.filter(k => lower.includes(k.toLowerCase())).length;
  const highImpact   = HIGH_IMPACT_KEYWORDS.some(k => lower.includes(k.toLowerCase()));

  const sentiment: NewsItem['sentiment'] =
    bearishScore > bullishScore ? 'BEARISH' :
    bullishScore > bearishScore ? 'BULLISH' : 'NEUTRAL';

  const totalVotes = votes.positive + votes.negative + votes.important;
  const impact: NewsItem['impact'] =
    votes.important >= 10 || totalVotes >= 50 ? 'CRITICAL' :
    highImpact || totalVotes >= 20             ? 'HIGH'     :
    totalVotes >= 5                            ? 'MEDIUM'   : 'LOW';

  return { sentiment, impact };
}

let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cachedNews: NewsItem[] = [];

export async function fetchCryptoNews(filter: 'rising' | 'hot' | 'bullish' | 'bearish' | 'important' = 'hot'): Promise<NewsItem[]> {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL && cachedNews.length > 0) {
    return cachedNews;
  }

  try {
    const params = new URLSearchParams({
      auth_token: CRYPTOPANIC_KEY,
      filter,
      public: 'true',
    });

    const res = await fetch(`${BASE_URL}/posts/?${params}`);
    if (!res.ok) {
      if (res.status !== 404) logger.warn('CryptoPanic API error', { status: res.status });
      return cachedNews;
    }

    const data = await res.json() as any;
    const items: NewsItem[] = (data.results ?? []).map((item: any) => {
      const votes = {
        positive:  item.votes?.positive  ?? 0,
        negative:  item.votes?.negative  ?? 0,
        important: item.votes?.important ?? 0,
      };
      const { sentiment, impact } = classifyNews(item.title, votes);
      return {
        id:          item.id,
        title:       item.title,
        url:         item.url,
        source:      item.source?.title ?? 'Unknown',
        currencies:  (item.currencies ?? []).map((c: any) => c.code),
        kind:        item.kind ?? 'news',
        votes,
        publishedAt: item.published_at,
        sentiment,
        impact,
      };
    });

    cachedNews = items;
    lastFetch  = now;
    logger.info('News fetched', { count: items.length, filter });
    return items;
  } catch (err: any) {
    logger.error('Failed to fetch news', { error: err.message });
    return cachedNews;
  }
}

export async function fetchMacroEvents(): Promise<NewsItem[]> {
  const news = await fetchCryptoNews('important');
  return news.filter(n => n.impact === 'HIGH' || n.impact === 'CRITICAL');
}
