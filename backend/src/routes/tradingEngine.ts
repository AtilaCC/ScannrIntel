import { Router, Request, Response } from 'express';

export const tradingEngineRouter = Router();

tradingEngineRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ status: 'active', engine: 'trading-engine' });
});
