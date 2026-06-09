// ============================================================
// AI SERVICE HEALTH SERVER
// GET /health   — liveness + readiness
// GET /metrics  — queue depths, Claude stats, alert stats
// GET /dead     — inspect dead-letter queue items
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ClaudeAnalyzer } from '../analyzers/claudeAnalyzer';
import { AlertChecker } from '../analyzers/alertChecker';
import { AnalysisQueue } from '../queue/analysisQueue';
import { createLogger } from '../utils/shared';

const logger = createLogger('ai-health-server');

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(payload);
}

export function createHealthServer(
  port:     number,
  analyzer: ClaudeAnalyzer,
  checker:  AlertChecker,
  queue:    AnalysisQueue,
  startedAt:number,
) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url?.split('?')[0] ?? '/';

    if (url === '/health') {
      const qStats   = queue.stats;
      const depths   = await queue.depths();
      const isReady  = true; // AI service is stateless — always ready

      json(res, 200, {
        status:    'ok',
        service:   'ai-service',
        uptime:    Math.floor((Date.now() - startedAt) / 1000),
        queue:     { ...qStats, depths },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (url === '/metrics') {
      const claudeStats  = analyzer.claudeStats;
      const rateLimiter  = analyzer.rateLimiterStats;
      const alertStats   = checker.stats;
      const queueDepths  = await queue.depths();

      json(res, 200, {
        uptime:        Math.floor((Date.now() - startedAt) / 1000),
        claude:        claudeStats,
        rateLimiter,
        queue: {
          ...queue.stats,
          depths: queueDepths,
        },
        alerts:        alertStats,
        timestamp:     new Date().toISOString(),
      });
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  server.listen(port, () => {
    logger.info(`AI health server on port ${port}`);
  });

  return server;
}
