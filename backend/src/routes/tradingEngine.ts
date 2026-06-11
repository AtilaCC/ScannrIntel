import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePlan } from '../middleware/subscription';

export const tradingEngineRouter = Router();

tradingEngineRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ status: 'active', engine: 'trading-engine' });
});

// POST /api/v1/trading-engine/manual
tradingEngineRouter.post('/manual', authenticate, requirePlan('PRO'), async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text?.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const groqApiKey = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!groqApiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You are an institutional crypto trading decision engine. Analyze market signals and respond ONLY with a valid JSON object. No markdown, no backticks, no explanation. Required JSON:
{
  "action": "BUY | SELL | HOLD | AVOID",
  "confidence": 0-100,
  "timeframe": "IMMEDIATE | SHORT_TERM | MEDIUM_TERM",
  "riskLevel": "LOW | MEDIUM | HIGH | EXTREME",
  "reasoning": "brief explanation",
  "keyFactors": ["factor1", "factor2"],
  "priceTargets": { "entry": null, "stopLoss": null, "takeProfit": null },
  "sentiment": "BULLISH | BEARISH | NEUTRAL",
  "urgency": "LOW | MEDIUM | HIGH | CRITICAL"
}`,
          },
          {
            role: 'user',
            content: `Analyze this market signal and provide a trading decision:\n\n${text}`,
          },
        ],
      }),
    });

    const groqData = await response.json() as any;
    const raw = groqData.choices?.[0]?.message?.content ?? '{}';

    let decision: any;
    try {
      decision = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      decision = { action: 'HOLD', confidence: 50, reasoning: raw, sentiment: 'NEUTRAL', riskLevel: 'MEDIUM', timeframe: 'SHORT_TERM', keyFactors: [], urgency: 'LOW', priceTargets: {} };
    }

    decision.id        = crypto.randomUUID();
    decision.analyzedAt = new Date().toISOString();
    decision.signal    = text.slice(0, 200);

    return res.json({ data: decision });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'Analysis failed' });
  }
});

// POST /api/v1/trading-engine/analyze (alias for /manual)
tradingEngineRouter.post('/analyze', authenticate, requirePlan('PRO'), async (req: Request, res: Response) => {
  req.url = '/manual';
  return res.redirect(307, '/api/v1/trading-engine/manual');
});
