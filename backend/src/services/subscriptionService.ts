// ============================================================
// SUBSCRIPTION SERVICE
// Manages the full subscription lifecycle:
//   create (FREE on register), upgrade, downgrade, cancel,
//   reactivate, override (admin), status checks
// ============================================================

import { PrismaClient } from '@prisma/client';
import {
  PlanTier, BillingInterval, PLANS, isUpgrade, isDowngrade,
} from '../config/plans';
import { createLogger } from '../../../shared/src/utils';

const logger = createLogger('subscription-service');

export const createSubscriptionService = (prisma: PrismaClient) => ({

  // ── Get current subscription ──────────────────────────────

  async getForUser(userId: string) {
    return prisma.subscription.findUnique({
      where:   { userId },
      include: { invoices: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
  },

  async getPlanTier(userId: string): Promise<PlanTier> {
    const sub = await prisma.subscription.findUnique({
      where:  { userId },
      select: { plan: true, status: true, currentPeriodEnd: true },
    });

    if (!sub) return 'FREE';

    // Treat expired / canceled as FREE
    if (
      sub.status === 'CANCELED' ||
      sub.status === 'UNPAID' ||
      (sub.status !== 'TRIALING' && sub.currentPeriodEnd < new Date())
    ) {
      return 'FREE';
    }

    return sub.plan as PlanTier;
  },

  // ── Create FREE subscription on registration ──────────────

  async createFree(userId: string) {
    const farFuture = new Date('2099-12-31');
    return prisma.subscription.upsert({
      where:  { userId },
      update: {},
      create: {
        userId,
        plan:               'FREE',
        status:             'ACTIVE',
        billingInterval:    'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd:   farFuture,
      },
    });
  },

  // ── Upgrade / change plan ────────────────────────────────

  async changePlan(opts: {
    userId:          string;
    newPlan:         PlanTier;
    billingInterval: BillingInterval;
    stripeSubscriptionId?: string;
    stripePriceId?:        string;
    stripeCustomerId?:     string;
  }) {
    const existing = await prisma.subscription.findUnique({ where: { userId: opts.userId } });
    const oldPlan  = (existing?.plan ?? 'FREE') as PlanTier;

    const direction = isUpgrade(oldPlan, opts.newPlan)
      ? 'upgrade' : isDowngrade(oldPlan, opts.newPlan)
      ? 'downgrade' : 'same';

    const periodEnd = opts.billingInterval === 'ANNUAL'
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 30  * 24 * 60 * 60 * 1000);

    const sub = await prisma.subscription.upsert({
      where:  { userId: opts.userId },
      update: {
        plan:                 opts.newPlan,
        status:               'ACTIVE',
        billingInterval:      opts.billingInterval,
        stripeSubscriptionId: opts.stripeSubscriptionId,
        stripePriceId:        opts.stripePriceId,
        stripeCustomerId:     opts.stripeCustomerId,
        currentPeriodStart:   new Date(),
        currentPeriodEnd:     periodEnd,
        cancelAtPeriodEnd:    false,
        canceledAt:           null,
      },
      create: {
        userId:               opts.userId,
        plan:                 opts.newPlan,
        status:               'ACTIVE',
        billingInterval:      opts.billingInterval,
        stripeSubscriptionId: opts.stripeSubscriptionId,
        stripePriceId:        opts.stripePriceId,
        stripeCustomerId:     opts.stripeCustomerId,
        currentPeriodStart:   new Date(),
        currentPeriodEnd:     periodEnd,
      },
    });

    logger.info('Plan changed', {
      userId: opts.userId,
      from:   oldPlan,
      to:     opts.newPlan,
      direction,
      interval: opts.billingInterval,
    });

    return { sub, direction };
  },

  // ── Cancel (at period end) ────────────────────────────────

  async cancel(userId: string) {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new Error('No subscription found');
    if (sub.plan === 'FREE') throw new Error('Cannot cancel a free plan');

    return prisma.subscription.update({
      where: { userId },
      data:  { cancelAtPeriodEnd: true, canceledAt: new Date() },
    });
  },

  // ── Reactivate (undo cancel) ──────────────────────────────

  async reactivate(userId: string) {
    return prisma.subscription.update({
      where: { userId },
      data:  { cancelAtPeriodEnd: false, canceledAt: null },
    });
  },

  // ── Handle Stripe webhook events ─────────────────────────

  async handleStripeEvent(event: {
    type:    string;
    stripeSubscriptionId: string;
    status?: string;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  }) {
    const sub = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: event.stripeSubscriptionId },
    });
    if (!sub) return;

    switch (event.type) {
      case 'customer.subscription.updated':
        await prisma.subscription.update({
          where: { id: sub.id },
          data:  {
            status:            (event.status?.toUpperCase() ?? sub.status) as any,
            currentPeriodEnd:  event.currentPeriodEnd ?? sub.currentPeriodEnd,
            cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? sub.cancelAtPeriodEnd,
          },
        });
        break;

      case 'customer.subscription.deleted':
        await prisma.subscription.update({
          where: { id: sub.id },
          data:  {
            plan:   'FREE',
            status: 'CANCELED',
            currentPeriodEnd: new Date('2099-12-31'),
          },
        });
        break;

      case 'invoice.payment_failed':
        await prisma.subscription.update({
          where: { id: sub.id },
          data:  { status: 'PAST_DUE' },
        });
        break;

      case 'invoice.payment_succeeded':
        if (sub.status === 'PAST_DUE' || sub.status === 'UNPAID') {
          await prisma.subscription.update({
            where: { id: sub.id },
            data:  { status: 'ACTIVE' },
          });
        }
        break;
    }
  },

  // ── Admin override ────────────────────────────────────────

  async adminOverride(opts: {
    targetUserId: string;
    newPlan:      PlanTier;
    adminId:      string;
    note?:        string;
  }) {
    const farFuture = new Date('2099-12-31');
    return prisma.subscription.upsert({
      where:  { userId: opts.targetUserId },
      update: {
        plan:             opts.newPlan,
        status:           'ACTIVE',
        currentPeriodEnd: farFuture,
        overrideBy:       opts.adminId,
        overrideNote:     opts.note,
      },
      create: {
        userId:           opts.targetUserId,
        plan:             opts.newPlan,
        status:           'ACTIVE',
        billingInterval:  'MONTHLY',
        currentPeriodEnd: farFuture,
        overrideBy:       opts.adminId,
        overrideNote:     opts.note,
      },
    });
  },

  // ── Statistics (admin) ────────────────────────────────────

  async getStats() {
    const [byPlan, byStatus, mrr] = await Promise.all([
      prisma.subscription.groupBy({ by: ['plan'],   _count: true }),
      prisma.subscription.groupBy({ by: ['status'], _count: true }),
      // MRR: sum of active non-free subscribers
      prisma.subscription.findMany({
        where: { status: 'ACTIVE', plan: { not: 'FREE' } },
        select: { plan: true, billingInterval: true },
      }),
    ]);

    const mrrUsd = mrr.reduce((sum, s) => {
      const plan    = PLANS[s.plan as PlanTier];
      const monthly = s.billingInterval === 'ANNUAL'
        ? plan.pricing.annualUsd / 12
        : plan.pricing.monthlyUsd;
      return sum + monthly;
    }, 0);

    return { byPlan, byStatus, mrrUsd: Math.round(mrrUsd) };
  },
});

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
