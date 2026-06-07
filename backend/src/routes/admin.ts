import { Router, Request, Response } from 'express';

export const adminRouter = Router();

adminRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'admin' });
});

adminRouter.get('/stats', (_req: Request, res: Response) => {
  res.json({ users: 0, signals: 0, insights: 0 });
});
