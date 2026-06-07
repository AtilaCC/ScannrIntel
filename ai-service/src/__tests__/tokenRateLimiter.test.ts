// ============================================================
// TOKEN RATE LIMITER TESTS
// ============================================================

import { TokenRateLimiter } from '../analyzers/tokenRateLimiter';

describe('TokenRateLimiter', () => {

  it('allows requests below RPM limit', async () => {
    const limiter = new TokenRateLimiter(10, 100_000);
    const start   = Date.now();
    await limiter.acquire(100);
    expect(Date.now() - start).toBeLessThan(100); // should be instant
  });

  it('tracks current RPM correctly', async () => {
    const limiter = new TokenRateLimiter(10, 100_000);
    expect(limiter.currentRpm).toBe(0);
    await limiter.acquire(100);
    expect(limiter.currentRpm).toBe(1);
    await limiter.acquire(100);
    expect(limiter.currentRpm).toBe(2);
  });

  it('tracks current TPM correctly', async () => {
    const limiter = new TokenRateLimiter(10, 100_000);
    await limiter.acquire(300);
    await limiter.acquire(500);
    expect(limiter.currentTpm).toBe(800);
  });

  it('recordActual corrects the token estimate', async () => {
    const limiter = new TokenRateLimiter(10, 100_000);
    await limiter.acquire(500);
    expect(limiter.currentTpm).toBe(500);
    limiter.recordActual(500, 350);
    expect(limiter.currentTpm).toBe(350);
  });

  it('allows TPM within budget', async () => {
    const limiter = new TokenRateLimiter(100, 1_000);
    const start   = Date.now();
    await limiter.acquire(999);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('multiple acquires stay within TPM when budget allows', async () => {
    const limiter = new TokenRateLimiter(100, 1_000);
    await limiter.acquire(400);
    await limiter.acquire(400);
    // 800 total — still under 1000
    expect(limiter.currentTpm).toBe(800);
  });
});
