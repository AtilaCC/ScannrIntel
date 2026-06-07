// ============================================================
// SUBSCRIPTION ROUTES
//
// GET  /subscriptions/plans          — public: all plan details
// GET  /subscriptions/me             — current user subscription
// GET  /subscriptions/me/usage       — current period usage
// GET  /subscriptions/me/invoices    — billing history
// POST /subscriptions/checkout       — create Stripe checkout session
// POST /subscriptions/cancel         — cancel at period end
// POST /subscriptions/reactivate     — undo cancellation
// POST /subscriptions/webhook        — Stripe webhook handler
// PATCH /subscriptions/admin/:userId — admin plan override
// GET  /subscriptions/admin/stats    — admin subscription stats
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate';
import { AppError } from '../middleware/errorHandler';
import { createSubscriptionService } from '../services/subscriptionService';
import { createUsageService }        from '../services/usageService';
import { PLANS, PlanTier, BillingInterval } from '../config/plans';
import { z } from 'zod';
import { createLogger } from '../../../shared/src/utils';

const logger = createLogger('subscription-routes');

export function createSubscriptionRouter(prisma: PrismaClient, redis: Redis) {
  const router      = Router();
  const subService   = createSubscriptionService(prisma);
  const usageService = createUsageService(prisma, redis);

  // ── GET /plans ────────────────────────────────────────────
  router.get('/plans', (_req: Request, res: Response) => {
    const plans = Object.values(PLANS).map((p) => ({
      tier:        p.tier,
      displayName: p.displayName,
      description: p.description,
      badge:       p.badge,
      highlighted: p.highlighted,
      pricing:     {
        monthlyUsd: p.pricing.monthlyUsd,
        annualUsd:  p.pricing.annualUsd,
        annualSavingsPercent: p.pricing.monthlyUsd > 0
          ? Math.round((1 - p.pricing.annualUsd / (p.pricing.monthlyUsd * 12)) * 100)
          : 0,
      },
      features: p.features,
    }));
    res.json({ success: true, data: plans });
  });

  // ── GET /me ───────────────────────────────────────────────
  router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sub = await subService.getForUser(req.user!.sub);
      if (!sub) {
        // Auto-create FREE if missing (shouldn't happen after migration)
        const created = await subService.createFree(req.user!.sub);
        return res.json({ success: true, data: { ...created, plan: PLANS.FREE } });
      }
      res.json({
        success: true,
        data: {
          ...sub,
          planDetails: PLANS[sub.plan as PlanTier],
        },
      });
    } catch (err) { next(err); }
  });

  // ── GET /me/usage ─────────────────────────────────────────
  router.get('/me/usage', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sub = await subService.getForUser(req.user!.sub);
      if (!sub) { res.json({ success: true, data: {} }); return; }

      const summary = await usageService.getSummary(
        req.user!.sub,
        sub.plan as PlanTier,
        sub.id,
        sub.currentPeriodStart,
      );
      res.json({ success: true, data: summary });
    } catch (err) { next(err); }
  });

  // ── GET /me/invoices ──────────────────────────────────────
  router.get('/me/invoices', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const invoices = await prisma.invoice.findMany({
        where:   { userId: req.user!.sub },
        orderBy: { createdAt: 'desc' },
        take:    24,
      });
      res.json({ success: true, data: invoices });
    } catch (err) { next(err); }
  });

  // ── POST /checkout ────────────────────────────────────────
  // Creates a Stripe Checkout Session and returns the URL.
  router.post('/checkout', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        plan:     z.enum(['PRO', 'ENTERPRISE']),
        interval: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
      });
      const { plan, interval } = schema.parse(req.body);

      const planDef  = PLANS[plan as PlanTier];
      const priceId  = interval === 'ANNUAL'
        ? planDef.pricing.stripePriceIdAnnual
        : planDef.pricing.stripePriceIdMonthly;

      if (!priceId) {
        throw new AppError(500, 'Stripe price not configured for this plan', 'STRIPE_NOT_CONFIGURED');
      }

      // Stripe integration — requires stripe npm package in production
      // For now: return a mock checkout URL so the rest of the system works
      // In production: replace this block with real Stripe checkout session creation
      if (process.env.NODE_ENV !== 'production' || !process.env.STRIPE_SECRET_KEY) {
        logger.warn('Stripe not configured — returning mock checkout URL');
        return res.json({
          success: true,
          data: {
            checkoutUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/dashboard/billing?mock=true&plan=${plan}&interval=${interval}`,
            mock: true,
          },
        });
      }

      // ── Real Stripe checkout (uncomment when stripe is installed) ──
      // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      // const session = await stripe.checkout.sessions.create({ ... });
      // res.json({ success: true, data: { checkoutUrl: session.url } });

    } catch (err) { next(err); }
  });

  // ── POST /cancel ──────────────────────────────────────────
  router.post('/cancel', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sub = await subService.cancel(req.user!.sub);
      logger.info('Subscription canceled', { userId: req.user!.sub, plan: sub.plan });
      res.json({
        success: true,
        message: `Your ${sub.plan} plan will remain active until ${sub.currentPeriodEnd.toLocaleDateString()}.`,
        data:    sub,
      });
    } catch (err) { next(err); }
  });

  // ── POST /reactivate ──────────────────────────────────────
  router.post('/reactivate', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sub = await subService.reactivate(req.user!.sub);
      res.json({ success: true, message: 'Subscription reactivated.', data: sub });
    } catch (err) { next(err); }
  });

  // ── POST /webhook ─────────────────────────────────────────
  // Stripe sends events here. Must be registered in Stripe dashboard.
  router.post('/webhook', async (req: Request, res: Response) => {
    const sig     = req.headers['stripe-signature'] as string;
    const secret  = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      res.status(400).json({ error: 'Webhook secret not configured' });
      return;
    }

    try {
      // In production with stripe installed:
      // const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY!);
      // const event   = stripe.webhooks.constructEvent(req.body, sig, secret);

      // Mock: parse body directly (development)
      const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      logger.info('Stripe webhook received', { type: event.type });

      const stripeObj = event.data?.object ?? {};

      await subService.handleStripeEvent({
        type:                 event.type,
        stripeSubscriptionId: stripeObj.id ?? stripeObj.subscription ?? '',
        status:               stripeObj.status,
        currentPeriodEnd:     stripeObj.current_period_end
          ? new Date(stripeObj.current_period_end * 1000) : undefined,
        cancelAtPeriodEnd:    stripeObj.cancel_at_period_end,
      });

      // Record invoices on payment
      if (event.type === 'invoice.payment_succeeded') {
        const inv = stripeObj;
        const sub = await prisma.subscription.findFirst({
          where: { stripeCustomerId: inv.customer },
        });
        if (sub) {
          await prisma.invoice.create({
            data: {
              subscriptionId:  sub.id,
              userId:          sub.userId,
              stripeInvoiceId: inv.id,
              amountUsd:       inv.amount_paid / 100,
              status:          'paid',
              invoiceUrl:      inv.hosted_invoice_url,
              pdfUrl:          inv.invoice_pdf,
              periodStart:     new Date(inv.period_start * 1000),
              periodEnd:       new Date(inv.period_end   * 1000),
              paidAt:          new Date(),
            },
          }).catch(() => { /* ignore duplicate */ });
        }
      }

      res.json({ received: true });
    } catch (err) {
      logger.error('Webhook error', { error: (err as Error).message });
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  });

  // ── PATCH /admin/:userId ──────────────────────────────────
  router.patch('/admin/:userId', authenticate, requireAdmin,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const schema = z.object({
          plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']),
          note: z.string().max(500).optional(),
        });
        const { plan, note } = schema.parse(req.body);

        const sub = await subService.adminOverride({
          targetUserId: req.params.userId,
          newPlan:      plan as PlanTier,
          adminId:      req.user!.sub,
          note,
        });

        logger.info('Admin plan override', {
          adminId:  req.user!.sub,
          targetId: req.params.userId,
          plan,
        });

        res.json({ success: true, data: sub });
      } catch (err) { next(err); }
    },
  );

  // ── GET /admin/stats ──────────────────────────────────────
  router.get('/admin/stats', authenticate, requireAdmin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const stats = await subService.getStats();
        res.json({ success: true, data: stats });
      } catch (err) { next(err); }
    },
  );

  return router;
}
