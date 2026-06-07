// ============================================================
// CLAUDE CLIENT TESTS
// Uses fetch mock — no real API calls made.
// ============================================================

import { ClaudeClient } from '../analyzers/claudeClient';
import { ClassifiedError } from '../types';

// ── Fetch mock ────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

function mockOk(body: object, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok:     status < 400,
    status,
    text:   async () => JSON.stringify(body),
  });
}

function mockError(status: number, body: object) {
  mockFetch.mockResolvedValueOnce({
    ok:     false,
    status,
    text:   async () => JSON.stringify(body),
  });
}

const MOCK_RESPONSE = {
  id:          'msg_01abc',
  type:        'message',
  role:        'assistant',
  content:     [{ type: 'text', text: '{"summary":"Test","details":"Detail","riskScore":50,"opportunityScore":50,"sentiment":"NEUTRAL","tags":[],"recommendations":[],"confidence":0.7,"keyLevels":{"support":null,"resistance":null},"timeframe":"short-term"}' }],
  model:       'claude-sonnet-4-20250514',
  stop_reason: 'end_turn',
  usage:       { input_tokens: 300, output_tokens: 150 },
};

const MOCK_REQUEST = {
  model:      'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system:     'You are an analyst.',
  messages:   [{ role: 'user' as const, content: 'Analyze this signal.' }],
};

// ── Tests ─────────────────────────────────────────────────────

describe('ClaudeClient', () => {
  let client: ClaudeClient;

  beforeEach(() => {
    client = new ClaudeClient('test-api-key');
    mockFetch.mockClear();
  });

  // ── Success path ──────────────────────────────────────────

  describe('successful request', () => {
    it('returns parsed response and usage', async () => {
      mockOk(MOCK_RESPONSE);
      const { response, usage, latencyMs } = await client.request(MOCK_REQUEST);

      expect(response.content[0].text).toContain('"summary"');
      expect(usage.inputTokens).toBe(300);
      expect(usage.outputTokens).toBe(150);
      expect(usage.totalTokens).toBe(450);
      expect(usage.estimatedCostUsd).toBeGreaterThan(0);
      expect(latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('sends correct headers', async () => {
      mockOk(MOCK_RESPONSE);
      await client.request(MOCK_REQUEST);

      const call    = mockFetch.mock.calls[0];
      const url     = call[0];
      const options = call[1];

      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options.headers['x-api-key']).toBe('test-api-key');
      expect(options.headers['anthropic-version']).toBe('2023-06-01');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('increments stats on success', async () => {
      mockOk(MOCK_RESPONSE);
      await client.request(MOCK_REQUEST);

      const stats = client.stats;
      expect(stats.requestsTotal).toBe(1);
      expect(stats.requestsFailed).toBe(0);
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('accumulates cost across multiple requests', async () => {
      mockOk(MOCK_RESPONSE);
      mockOk(MOCK_RESPONSE);
      await client.request(MOCK_REQUEST);
      await client.request(MOCK_REQUEST);

      expect(client.stats.requestsTotal).toBe(2);
      expect(client.stats.estimatedCostUsd).toBeGreaterThan(0);
    });
  });

  // ── Rate limit ────────────────────────────────────────────

  describe('rate limit (429)', () => {
    it('throws retryable RATE_LIMIT error', async () => {
      mockError(429, { error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } });

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:      'RATE_LIMIT',
        retryable: true,
      } as Partial<ClassifiedError>);

      expect(client.stats.rateLimitHits).toBe(1);
    });

    it('parses retry_after from response body', async () => {
      mockError(429, { error: { message: 'Too many requests' }, retry_after: 30 });

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:          'RATE_LIMIT',
        retryable:     true,
        retryAfterMs:  30_000,
      } as Partial<ClassifiedError>);
    });
  });

  // ── Overloaded ────────────────────────────────────────────

  describe('overloaded (529)', () => {
    it('throws retryable OVERLOADED error', async () => {
      mockError(529, { error: { message: 'Overloaded' } });

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:      'OVERLOADED',
        retryable: true,
      } as Partial<ClassifiedError>);
    });
  });

  // ── Auth error ────────────────────────────────────────────

  describe('auth error (401)', () => {
    it('throws non-retryable AUTH_ERROR', async () => {
      mockError(401, { error: { type: 'authentication_error', message: 'Invalid API key' } });

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:      'AUTH_ERROR',
        retryable: false,
      } as Partial<ClassifiedError>);
    });
  });

  // ── Bad request ───────────────────────────────────────────

  describe('bad request (400)', () => {
    it('throws non-retryable INVALID_REQUEST', async () => {
      mockError(400, { error: { type: 'invalid_request_error', message: 'Bad request' } });

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:      'INVALID_REQUEST',
        retryable: false,
      } as Partial<ClassifiedError>);
    });
  });

  // ── Server error ──────────────────────────────────────────

  describe('server error (500)', () => {
    it('throws retryable SERVER_ERROR', async () => {
      mockError(500, { error: { message: 'Internal server error' } });

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:      'SERVER_ERROR',
        retryable: true,
      } as Partial<ClassifiedError>);
    });
  });

  // ── Network error ─────────────────────────────────────────

  describe('network error', () => {
    it('classifies fetch rejection as NETWORK_ERROR', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:      'NETWORK_ERROR',
        retryable: true,
      } as Partial<ClassifiedError>);
    });
  });

  // ── Timeout ───────────────────────────────────────────────

  describe('timeout', () => {
    it('classifies AbortError as TIMEOUT', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name  = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(client.request(MOCK_REQUEST)).rejects.toMatchObject({
        type:      'TIMEOUT',
        retryable: true,
      } as Partial<ClassifiedError>);
    });
  });
});
