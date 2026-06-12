import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/authenticate';

export const newsRouter = Router();

const CRYPTOPANIC_KEY = process.env.CRYPTOPANIC_API_KEY || 'free';
const CACHE_TTL = 5 * 60 * 1000;
let cache: any[] = [];
let lastFetch = 0;

const BEARISH = ['ban','hack','exploit','bankruptcy','collapse','crash','dump','sell','fear','warning','risk'];
const BULLISH  = ['ETF','approval','partnership','adoption','upgrade','bull','buy','pump','surge','launch','record'];

function classify(title: string): { sentiment: string; impact: string } {
  const lower = title.toLowerCase();
  const b = BEARISH.filter(k => lower.includes(k)).length;
  const u = BULLISH.filter(k => lower.includes(k)).length;
  return {
    sentiment: b > u ? 'BEARISH' : u > b ? 'BULLISH' : 'NEUTRAL',
    impact:    b >= 2 || u >= 2 ? 'HIGH' : b >= 1 || u >= 1 ? 'MEDIUM' : 'LOW',
  };
}

async function fetchNews(filter = 'hot') {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL && cache.length) return cache;
  try {
    const url = CRYPTOPANIC_KEY && CRYPTOPANIC_KEY !== "free"
      ? `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_KEY}&filter=${filter}&public=true`
      : `https://cryptopanic.com/api/v1/posts/?auth_token=free&filter=${filter}&public=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return cache;
    const data = await res.json() as any;
    cache = (data.results ?? []).map((item: any) => {
      const { sentiment, impact } = classify(item.title);
      return {
        id:          item.id,
        title:       item.title,
        url:         item.url,
        source:      item.source?.title ?? 'Unknown',
        currencies:  (item.currencies ?? []).map((c: any) => c.code),
        publishedAt: item.published_at,
        sentiment,
        impact,
        votes: { positive: item.votes?.positive ?? 0, negative: item.votes?.negative ?? 0, important: item.votes?.important ?? 0 },
      };
    });
    lastFetch = now;
    return cache;
  } catch { return cache; }
}

newsRouter.get('/', authenticate, async (req: Request, res: Response) => {
  const filter = (req.query.filter as string) || 'hot';
  const news = await fetchNews(filter);
  res.json({ data: news });
});

newsRouter.get('/macro', authenticate, async (_req: Request, res: Response) => {
  const news = await fetchNews('important');
  const macro = news.filter((n: any) => n.impact === 'HIGH' || n.impact === 'CRITICAL');
  res.json({ data: macro });
});
