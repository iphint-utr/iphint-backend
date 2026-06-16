import { Request, Response } from 'express';
import axios from 'axios';
import { Subscription } from '../../models/subscriptions';
import { Plan } from '../../models/plan';
import { Search } from '../../models/searches';
import { User } from '../../models/users';
import { Payment } from '../../models/payment';
import { PLAN_DEFINITIONS, getPlanDefinition } from './billing.constants';
import { syncPlanFromEnvByTier } from './plan-catalog.service';
import type { PlanTier } from '../../models/plan';
import type { BillingCycle, SubscriptionStatus } from '../../models/subscriptions';
import { topUpCredits, topUpAlerts } from '../../common/helpers/alert.helper';
import { evaluateSubscriptionAccess, pickEffectiveSubscription } from '../../common/helpers/subscription-access';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Returns the active/trialing plan tier for a user, defaulting to 'starter'. */
const getActivePlanTier = async (userId: string): Promise<PlanTier> => {
  const sub = await Subscription.findOne({
    userId,
    status: { $in: ['active', 'trialing'] },
  }).populate<{ planId: { tier: PlanTier } }>('planId', 'tier');
  return (sub?.planId as any)?.tier ?? 'starter';
};

/** Build the Paddle base URL from the env. */
const paddleBase = (): string =>
  process.env.PADDLE_ENVIRONMENT === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';

const isPaddlePriceId = (value: string) => /^pri_[a-z\d]{26}$/i.test(value.trim());

// Export helpers for use in other modules (e.g., referral.controller for trial creation)
export { isPaddlePriceId };

const isPaddleNotFoundError = (err: any): boolean =>
  err?.response?.data?.error?.code === 'not_found';

const pickBestPaddleSubscription = (subscriptions: any[]): any | undefined => {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return undefined;

  const STATUS_PRIORITY: Record<string, number> = {
    active: 0,
    trialing: 1,
    past_due: 2,
    paused: 3,
    canceled: 4,
  };

  return [...subscriptions].sort((a: any, b: any) => {
    const statusRankDiff = (STATUS_PRIORITY[a?.status] ?? 9) - (STATUS_PRIORITY[b?.status] ?? 9);
    if (statusRankDiff !== 0) return statusRankDiff;

    const aCreated = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const bCreated = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return bCreated - aCreated;
  })[0];
};

const PADDLE_SUBSCRIPTION_STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  paused: 'paused',
  past_due: 'past_due',
  canceled: 'cancelled',
};

const mapPaddleStatusToUserStatus = (
  status: SubscriptionStatus,
): 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused' | undefined => {
  if (status === 'cancelled') return 'canceled';
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'paused') {
    return status;
  }
  return undefined;
};

const syncLocalSubscriptionFromPaddle = async ({
  userId,
  subscriptionDocId,
  paddleSubscription,
}: {
  userId: string;
  subscriptionDocId: string;
  paddleSubscription: any;
}): Promise<boolean> => {
  const paddlePriceId = paddleSubscription?.items?.[0]?.price?.id;
  if (!paddleSubscription?.id || !paddlePriceId) {
    return false;
  }

  const plan = await Plan.findOne({
    $or: [
      { paddleMonthlyPriceId: paddlePriceId },
      { paddleAnnualPriceId: paddlePriceId },
      { paddleTrialPriceId: paddlePriceId },
    ],
  });

  if (!plan) {
    console.warn('[Paddle Subscription Update] Could not map patched subscription price to a local plan.', {
      userId,
      paddleSubscriptionId: paddleSubscription.id,
      paddlePriceId,
    });
    return false;
  }

  const status: SubscriptionStatus = PADDLE_SUBSCRIPTION_STATUS_MAP[paddleSubscription.status] ?? 'pending';
  const billingCycle: BillingCycle = paddleSubscription.billing_cycle?.interval === 'year' ? 'annual' : 'monthly';
  const periodEnd = paddleSubscription.current_billing_period?.ends_at
    ? new Date(paddleSubscription.current_billing_period.ends_at)
    : undefined;
  const trialEnd = status === 'trialing' && paddleSubscription.next_billed_at
    ? new Date(paddleSubscription.next_billed_at)
    : undefined;
  const scheduledCancel =
    paddleSubscription.scheduled_change?.action === 'cancel' && paddleSubscription.scheduled_change?.effective_at
      ? new Date(paddleSubscription.scheduled_change.effective_at)
      : undefined;

  const setFields: Record<string, unknown> = {
    planId: plan._id,
    billingCycle,
    grantSource: status === 'trialing' ? 'trial' : 'paid',
    status,
    paddleSubscriptionId: paddleSubscription.id,
    paddleCustomerId: paddleSubscription.customer_id,
    ...(periodEnd ? { currentPeriodEnd: periodEnd, nextBillingDate: periodEnd } : {}),
    ...(trialEnd ? { trialEndDate: trialEnd } : {}),
    ...(scheduledCancel ? { cancelDate: scheduledCancel } : {}),
    ...(!scheduledCancel ? { autoRenewReminderStages: [] } : {}),
    ...(!trialEnd ? { trialReminderStages: [] } : {}),
  };

  const unsetFields: Record<string, string> = {
    ...(!scheduledCancel ? { cancelDate: '' } : {}),
    ...(!trialEnd ? { trialEndDate: '' } : {}),
  };

  const updateDoc: Record<string, unknown> = { $set: setFields };
  if (Object.keys(unsetFields).length > 0) {
    updateDoc.$unset = unsetFields;
  }

  const subscription = await Subscription.findByIdAndUpdate(subscriptionDocId, updateDoc, { new: true });
  if (!subscription) {
    return false;
  }

  const userStatus = mapPaddleStatusToUserStatus(status);
  await User.findByIdAndUpdate(userId, {
    subscriptionId: subscription._id,
    paddleCustomerId: paddleSubscription.customer_id,
    paddleSubscriptionId: paddleSubscription.id,
    ...(userStatus ? { subscriptionStatus: userStatus } : {}),
  });

  if (status === 'active') {
    await Subscription.updateMany(
      {
        userId,
        _id: { $ne: subscription._id },
        status: { $in: ['active', 'trialing'] },
      },
      {
        $set: { status: 'cancelled', cancelDate: new Date() },
      },
    );
  }

  return true;
};

const recoverLivePaddleSubscriptionId = async (userId: string): Promise<string | null> => {
  const userDoc = await User.findById(userId).select('email paddleCustomerId').lean();
  let paddleCustomerId: string | undefined = (userDoc as any)?.paddleCustomerId;
  const email: string = (userDoc as any)?.email ?? '';

  if (!paddleCustomerId && email) {
    const customersResponse = await paddleRequest('get', `/customers?email=${encodeURIComponent(email)}&per_page=5`);
    const customers: any[] = customersResponse?.data ?? [];
    paddleCustomerId = customers[0]?.id;

    if (paddleCustomerId) {
      await User.findByIdAndUpdate(userId, { paddleCustomerId });
    }
  }

  if (!paddleCustomerId) return null;

  const subscriptionsResponse = await paddleRequest('get', `/subscriptions?customer_id=${paddleCustomerId}&per_page=25`);
  const subscriptions: any[] = subscriptionsResponse?.data ?? [];
  const bestSubscription = pickBestPaddleSubscription(subscriptions);

  return bestSubscription?.id ?? null;
};

const runPaddleMutationWithRecovery = async ({
  userId,
  localSubscriptionId,
  localSubscriptionDocId,
  actionName,
  execute,
}: {
  userId: string;
  localSubscriptionId: string;
  localSubscriptionDocId: any;
  actionName: string;
  execute: (subscriptionId: string) => Promise<void>;
}): Promise<string> => {
  try {
    await execute(localSubscriptionId);
    return localSubscriptionId;
  } catch (err: any) {
    if (!isPaddleNotFoundError(err)) {
      throw err;
    }

    console.warn(`[${actionName}] Local subscription ID not found in Paddle. Attempting customer-based recovery.`, {
      userId,
      localSubscriptionId,
      paddleEnvironment: process.env.PADDLE_ENVIRONMENT,
    });

    const recoveredSubscriptionId = await recoverLivePaddleSubscriptionId(userId);
    if (!recoveredSubscriptionId) {
      const recoveryError: any = new Error('Unable to find an active Paddle subscription for this account. Please open billing portal and retry, or contact support.');
      recoveryError.statusCode = 409;
      recoveryError.code = 'PADDLE_SUBSCRIPTION_NOT_FOUND';
      recoveryError.details = {
        paddleEnvironment: process.env.PADDLE_ENVIRONMENT,
        localSubscriptionId,
      };
      throw recoveryError;
    }

    await execute(recoveredSubscriptionId);

    await Promise.all([
      Subscription.findByIdAndUpdate(localSubscriptionDocId, { paddleSubscriptionId: recoveredSubscriptionId }),
      User.findByIdAndUpdate(userId, { paddleSubscriptionId: recoveredSubscriptionId }),
    ]);

    console.log(`[${actionName}] Recovered Paddle subscription ID from customer record.`, {
      userId,
      previousSubscriptionId: localSubscriptionId,
      recoveredSubscriptionId,
    });

    return recoveredSubscriptionId;
  }
};

const buildUpdatedSubscriptionItems = (items: any[], newPriceId: string) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [{ price_id: newPriceId, quantity: 1 }];
  }

  return items.map((item: any, index: number) => ({
    price_id: index === 0 ? newPriceId : item?.price?.id,
    quantity: Number(item?.quantity) > 0 ? Number(item.quantity) : 1,
  })).filter((item) => isPaddlePriceId(String(item.price_id)));
};

/** Shared Paddle API client; throws on non-2xx with a cleaned error message. */
const paddleRequest = async (
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: Record<string, unknown>,
) => {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  if (!apiKey) throw new Error('Paddle API key not configured.');
  const res = await axios({ method, url: `${paddleBase()}${path}`, data: body,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
  return res.data;
};

/** True when the user has never had a Paddle-managed subscription (trial eligible). */
const isTrialEligible = async (userId: string): Promise<boolean> => {
  const previous = await Subscription.findOne({
    userId,
    paddleSubscriptionId: { $exists: true, $ne: null },
  }).lean();
  return !previous;
};

/**
 * Look up or create a Paddle customer for the given user.
 * Caches the customer ID on the User document.
 */
const getOrCreatePaddleCustomer = async (
  userId: string,
  email: string,
  name: string,
): Promise<string> => {
  const userDoc = await User.findById(userId).select('paddleCustomerId').lean();
  const cachedCustomerId = (userDoc as any)?.paddleCustomerId as string | undefined;

  if (cachedCustomerId) {
    try {
      await paddleRequest('get', `/customers/${cachedCustomerId}`);
      return cachedCustomerId;
    } catch (err: any) {
      if (!isPaddleNotFoundError(err)) {
        throw err;
      }

      // Cached customer ID can become stale across environments (sandbox/production)
      // or if it no longer exists. Clear and recover via email lookup/create.
      console.warn('[Paddle Checkout] Cached paddleCustomerId not found; recovering via email lookup.', {
        userId,
        cachedCustomerId,
        paddleEnvironment: process.env.PADDLE_ENVIRONMENT,
      });
      await User.findByIdAndUpdate(userId, { $unset: { paddleCustomerId: '' } });
    }
  }

  const searchData = await paddleRequest('get', `/customers?email=${encodeURIComponent(email)}&per_page=5`);
  const existing: any[] = searchData?.data ?? [];
  if (existing.length > 0) {
    const paddleCustomerId: string = existing[0].id;
    await User.findByIdAndUpdate(userId, { paddleCustomerId });
    return paddleCustomerId;
  }
  const createData = await paddleRequest('post', '/customers', { email, name });
  const paddleCustomerId: string | undefined = createData?.data?.id;
  if (!paddleCustomerId) throw new Error('Paddle did not return a customer ID when creating customer.');
  await User.findByIdAndUpdate(userId, { paddleCustomerId });
  return paddleCustomerId;
};

// Export helpers for use in other modules (e.g., referral.controller for trial creation)
export { paddleRequest, getOrCreatePaddleCustomer };

// ─── Controllers ───────────────────────────────────────────────────────────

/** GET /billing/plans — return all plan definitions (no auth required) */
export const getPlans = async (_req: Request, res: Response) => {
  res.json({ success: true, plans: PLAN_DEFINITIONS });
};

/**
 * GET /billing/subscription — return the authenticated user's current
 * subscription status + active plan info.
 */
export const getSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;

    const [subscriptions, userDoc] = await Promise.all([
      Subscription.find({ userId })
        .sort({ activationDate: -1, createdAt: -1 })
        .populate('planId', 'tier name monthlyPrice annualPrice imageUploadLimit alertLimit pdfEnabled trialDays')
        .lean(),
      User.findById(userId)
        .select('permanentPdfAccess credits subscriptionStatus paddleSubscriptionId')
        .lean(),
    ]);

    const sub = pickEffectiveSubscription(subscriptions as any[], {
      preferredSubscriptionId: (userDoc as { paddleSubscriptionId?: string | null } | null)?.paddleSubscriptionId,
    });

    const subStatus = sub?.status ?? null;
    const {
      effectiveStatus,
      hasAccess: hasSubAccess,
      grantSource,
      periodExpired,
      isTrialing,
      trialEndsAt,
    } = evaluateSubscriptionAccess(sub as any, userDoc?.subscriptionStatus ?? null);

    const tier: PlanTier = hasSubAccess
      ? ((sub?.planId as any)?.tier ?? 'starter')
      : 'starter';
    const planDef = getPlanDefinition(tier);
    const pdfEnabled = planDef.pdfEnabled || (userDoc?.permanentPdfAccess ?? false);
    const isTrial = isTrialing || (grantSource === 'trial' && hasSubAccess && !periodExpired);

    const trialDaysLeft = isTrial && trialEndsAt
      ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0;

    // Images used this calendar month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const imagesUsedThisMonth = await Search.countDocuments({
      userId,
      date: { $gte: monthStart },
    });

    const pendingPlanTier = (sub as any)?.pendingPlanTier as PlanTier | undefined;
    const pendingBillingCycle = (sub as any)?.pendingBillingCycle as BillingCycle | undefined;
    const pendingChangeEffectiveAt = (sub as any)?.pendingChangeEffectiveAt
      ? new Date((sub as any).pendingChangeEffectiveAt)
      : null;
    const hasPendingPlanChange =
      !!pendingPlanTier &&
      !!pendingBillingCycle &&
      (pendingPlanTier !== tier || pendingBillingCycle !== sub?.billingCycle);

    res.json({
      success: true,
      subscription: sub
        ? {
            id: (sub as any)._id,
            status: effectiveStatus,
            paddleStatus: userDoc?.subscriptionStatus ?? null,
            hasAccess: hasSubAccess,
            billingCycle: sub.billingCycle,
            grantSource,
            isTrial,
            isTrialing,
            isPastDue: subStatus === 'past_due',
            trialEndsAt,
            trialDaysLeft,
            activationDate: sub.activationDate,
            currentPeriodEnd: sub.currentPeriodEnd,
            nextBillingDate: sub.nextBillingDate,
            cancelDate: sub.cancelDate,
            paddleManaged: !!(sub as any).paddleSubscriptionId,
            pendingPlan: hasPendingPlanChange
              ? {
                  tier: pendingPlanTier,
                  name: getPlanDefinition(pendingPlanTier as PlanTier).name,
                  billingCycle: pendingBillingCycle,
                  effectiveAt: pendingChangeEffectiveAt,
                }
              : null,
          }
        : null,
      plan: { ...planDef, pdfEnabled },
      credits: userDoc?.credits ?? 0,
      usage: {
        imagesUsedThisMonth,
        imageUploadLimit: planDef.imageUploadLimit,
        alertLimit: planDef.alertLimit,
        pdfEnabled,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
};

/**
 * GET /billing/plan-limits — lightweight endpoint for the frontend to
 * know if results should be blurred without loading the full subscription.
 */
export const getPlanLimits = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const [tier, userDoc] = await Promise.all([
      getActivePlanTier(userId),
      User.findById(userId).select('permanentPdfAccess').lean(),
    ]);
    const planDef    = getPlanDefinition(tier);
    const pdfEnabled = planDef.pdfEnabled || (userDoc?.permanentPdfAccess ?? false);
    res.json({
      success: true,
      tier,
      alertLimit:         planDef.alertLimit,
      imageUploadLimit:   planDef.imageUploadLimit,
      pdfEnabled,
      permanentPdfAccess: userDoc?.permanentPdfAccess ?? false,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
};

/**
 * POST /billing/subscribe — admin/testing only. Creates a subscription directly
 * without a Paddle payment. Do NOT expose this on public routes.
 * The production flow is: POST /billing/paddle/checkout → user pays → webhook activates subscription.
 */
export const subscribe = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const { tier, billingCycle } = req.body as { tier: PlanTier; billingCycle: BillingCycle };

    if (!['starter', 'pro', 'premium'].includes(tier)) {
      return res.status(400).json({ success: false, message: 'Invalid plan tier.' });
    }
    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({ success: false, message: 'Invalid billing cycle.' });
    }

    const def = getPlanDefinition(tier);
    const plan = await syncPlanFromEnvByTier(tier);

    // Carry over is automatic — user's credits/alertsRemaining balance persists.
    // Subscribing to a new plan simply adds the plan's quota on top.
    await Subscription.updateMany(
      { userId, status: { $in: ['active', 'trialing'] } },
      { status: 'cancelled', cancelDate: new Date() },
    );

    const now = new Date();
    const periodEnd = new Date(now);
    billingCycle === 'annual'
      ? periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      : periodEnd.setMonth(periodEnd.getMonth() + 1);

    const sub = await Subscription.create({
      userId, planId: plan._id, billingCycle, grantSource: 'paid',
      status: 'active', activationDate: now,
      currentPeriodEnd: periodEnd, nextBillingDate: periodEnd,
    });

    // Top up the user's monitoring credits and alert quota
    await Promise.all([
      topUpCredits(userId, def.imageUploadLimit),
      topUpAlerts(userId, def.alertLimit),
    ]);

    res.status(201).json({
      success: true,
      message: `Subscribed to ${def.name} (${billingCycle}) successfully.`,
      subscriptionId: sub._id,
      plan: def,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
};

/**
 * POST /billing/paddle/checkout — create a Paddle checkout transaction and
 * return the hosted checkout URL.
 *
 * Body: { tier, billingCycle, withTrial?, discountId? }
 *   OR  { priceId, discountId? }
 *
 * Trial logic (Paddle-native):
 *   If withTrial is not explicitly false AND the plan has a paddleTrialPriceId configured
 *   AND the user has never had a Paddle-managed subscription → use the trial price.
 *   Trial period length is set on the Paddle Price in the dashboard (configure via
 *   PADDLE_<TIER>_TRIAL_PRICE_ID in env).
 */
export const createPaddleCheckout = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    let { priceId, tier, billingCycle, withTrial, discountId } = req.body;

    if (!priceId && tier) {
      const def = getPlanDefinition(tier as PlanTier);

      const hasActiveLocalTrial = !!(await Subscription.findOne({
        userId,
        grantSource: 'trial',
        status: { $in: ['active', 'trialing'] },
        $or: [
          { paddleSubscriptionId: { $exists: false } },
          { paddleSubscriptionId: null },
        ],
      }).lean());

      // Determine if we should use the Paddle-native trial price
      const offerTrial =
        withTrial !== false &&          // caller didn't opt out
        def.trialDays > 0 &&            // plan supports a trial
        !!def.paddleTrialPriceId &&      // trial price configured in env
        (await isTrialEligible(userId)) && // user hasn't already been through Paddle
        !hasActiveLocalTrial;             // don't stack a second trial over local trial access

      if (offerTrial) {
        priceId = def.paddleTrialPriceId;
      } else {
        priceId = billingCycle === 'annual' ? def.paddleAnnualPriceId : def.paddleMonthlyPriceId;
      }

      if (!priceId) {
        return res.status(404).json({
          success: false,
          message: `No Paddle price ID configured for plan "${tier}" (${billingCycle ?? 'monthly'}). ` +
            `Check PADDLE_${String(tier).toUpperCase()}_${billingCycle === 'annual' ? 'ANNUAL' : 'MONTHLY'}_PRICE_ID in env.`,
        });
      }
    }

    if (!priceId) {
      return res.status(400).json({ success: false, message: 'priceId (or tier) is required.' });
    }

    if (!isPaddlePriceId(String(priceId))) {
      return res.status(400).json({
        success: false,
        message: `Invalid Paddle price ID "${String(priceId)}". Expected a Price ID like pri_xxxxxxxxxxxxxxxxxxxxxxxxxx (not a Product ID like pro_...).`,
      });
    }

    const userForCheckout = await User.findById(userId).select('email name').lean();
    const userEmail: string = (userForCheckout as any)?.email ?? '';
    const userName: string  = (userForCheckout as any)?.name  ?? '';
    const paddleCustomerId = userEmail
      ? await getOrCreatePaddleCustomer(userId, userEmail, userName)
      : undefined;

    const body: Record<string, unknown> = {
      items:       [{ price_id: priceId, quantity: 1 }],
      custom_data: { userId },
    };
    if (paddleCustomerId) body.customer_id = paddleCustomerId;
    if (discountId) body.discount_id = discountId;

    console.log(`[Paddle Checkout] env=${process.env.PADDLE_ENVIRONMENT} priceId=${priceId} userId=${userId} customerId=${paddleCustomerId ?? 'none'} discount=${discountId ?? 'none'}`);

    const data = await paddleRequest('post', '/transactions', body);
    const txn = data?.data;
    const checkoutUrl: string | undefined = txn?.checkout?.url;
    const transactionId: string | undefined = txn?.id;

    if (!transactionId) {
      return res.status(500).json({
        success: false,
        message: 'Paddle did not return a transaction ID.',
        debug: { txnStatus: txn?.status },
      });
    }

    // transactionId → use with Paddle.Checkout.open({ transactionId }) for overlay/inline
    // checkoutUrl   → use for redirect-based hosted checkout
    res.json({ success: true, transactionId, checkoutUrl: checkoutUrl ?? null });
  } catch (err: any) {
    const paddleError = err?.response?.data;
    console.error('[Paddle Checkout Error]', JSON.stringify(paddleError ?? err?.message, null, 2));
    const msg = paddleError?.error?.detail || paddleError?.error?.code || err?.message || 'Server error';
    res.status(500).json({ success: false, message: msg, paddleError: paddleError?.error ?? null });
  }
};

/**
 * PATCH /billing/subscription — upgrade or downgrade the active Paddle subscription.
 * Body: { tier: PlanTier, billingCycle?: BillingCycle }
 * - For trial → paid upgrades: remaining trial days are added as bonus days (prorated immediately)
 * - For paid → paid upgrades: proration applied immediately
 * - For downgrades: scheduled for next billing period
 */
export const updateSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const { tier, billingCycle } = req.body as { tier: PlanTier; billingCycle?: BillingCycle };

    if (!['starter', 'pro', 'premium'].includes(tier)) {
      return res.status(400).json({ success: false, message: 'Invalid plan tier.' });
    }

    const sub = await Subscription.findOne({ userId, status: { $in: ['active', 'trialing'] } }).populate<{ planId: { tier: PlanTier } }>('planId', 'tier');
    if (!sub) {
      return res.status(404).json({ success: false, message: 'No active subscription found.' });
    }
    if (!sub.paddleSubscriptionId) {
      return res.status(400).json({ success: false, message: 'Subscription is not managed by Paddle. Use /billing/cancel and re-subscribe.' });
    }

    const tierRank: Record<PlanTier, number> = { starter: 0, pro: 1, premium: 2 };
    const currentTier = (sub.planId as any)?.tier as PlanTier | undefined;
    if (!currentTier || !tierRank.hasOwnProperty(currentTier)) {
      return res.status(422).json({ success: false, message: 'Could not resolve current subscription tier.' });
    }

    const targetCycle: BillingCycle = billingCycle ?? (sub.billingCycle as BillingCycle);
    const def = getPlanDefinition(tier);
    const newPriceId = targetCycle === 'annual' ? def.paddleAnnualPriceId : def.paddleMonthlyPriceId;

    const currentCycle = sub.billingCycle as BillingCycle;
    const currentRank = tierRank[currentTier];
    const targetRank = tierRank[tier];
    const isKeepCurrentPlanRequest =
      tier === currentTier &&
      targetCycle === currentCycle &&
      !!(sub as any).pendingPlanTier;
    const isDowngradeRequest =
      targetRank < currentRank ||
      (targetRank === currentRank && targetCycle !== currentCycle && currentCycle === 'annual' && targetCycle === 'monthly');
    const isUpgradeOrLateralNow = !isDowngradeRequest && !isKeepCurrentPlanRequest;

    // Trial-specific logic: upgrade from trial → paid plan
    const isTrialSubscription = (sub.status as string) === 'trialing' || (sub.grantSource as string) === 'trial';
    const isUpgradeFromTrial = isTrialSubscription && isUpgradeOrLateralNow;

    if (!newPriceId) {
      return res.status(404).json({ success: false, message: `No Paddle price ID for plan "${tier}" (${targetCycle}).` });
    }

    if (!isPaddlePriceId(String(newPriceId))) {
      return res.status(400).json({
        success: false,
        message: `Invalid Paddle price ID configured for ${tier} (${targetCycle}): "${String(newPriceId)}". Use Paddle Price IDs (pri_), not Product IDs (pro_).`,
      });
    }

    let paddleSubscriptionId = sub.paddleSubscriptionId;
    let currentSubscriptionResponse: any;

    try {
      currentSubscriptionResponse = await paddleRequest('get', `/subscriptions/${paddleSubscriptionId}`);
    } catch (err: any) {
      if (!isPaddleNotFoundError(err)) {
        throw err;
      }

      console.warn('[Paddle Subscription Update] Local subscription ID not found in Paddle. Attempting customer-based recovery.', {
        userId,
        paddleSubscriptionId,
        paddleEnvironment: process.env.PADDLE_ENVIRONMENT,
      });

      const recoveredSubscriptionId = await recoverLivePaddleSubscriptionId(userId);

      if (!recoveredSubscriptionId) {
        return res.status(409).json({
          success: false,
          message: 'Unable to find an active Paddle subscription for this account. Please open billing portal and retry, or contact support.',
          code: 'PADDLE_SUBSCRIPTION_NOT_FOUND',
          details: {
            paddleEnvironment: process.env.PADDLE_ENVIRONMENT,
            localSubscriptionId: paddleSubscriptionId,
          },
        });
      }

      paddleSubscriptionId = recoveredSubscriptionId;
      currentSubscriptionResponse = await paddleRequest('get', `/subscriptions/${paddleSubscriptionId}`);

      await Promise.all([
        Subscription.findByIdAndUpdate(sub._id, { paddleSubscriptionId }),
        User.findByIdAndUpdate(userId, { paddleSubscriptionId }),
      ]);

      console.log('[Paddle Subscription Update] Recovered Paddle subscription ID from customer record.', {
        userId,
        previousSubscriptionId: sub.paddleSubscriptionId,
        recoveredSubscriptionId: paddleSubscriptionId,
      });
    }

    const currentPaddleSubscription = currentSubscriptionResponse?.data;
    const currentItems = Array.isArray(currentPaddleSubscription?.items) ? currentPaddleSubscription.items : [];

    if (currentItems.length === 0) {
      console.error('[Paddle Subscription Update] No subscription items found', {
        subscriptionId: paddleSubscriptionId,
        userId,
      });
    }

    const nextItems = buildUpdatedSubscriptionItems(currentItems, String(newPriceId));

    if (nextItems.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Could not build Paddle subscription items for update.',
      });
    }

    if (isKeepCurrentPlanRequest) {
      await paddleRequest('patch', `/subscriptions/${paddleSubscriptionId}`, {
        scheduled_change: null,
      });

      await Subscription.findByIdAndUpdate(sub._id, {
        $unset: {
          pendingPlanTier: '',
          pendingBillingCycle: '',
          pendingChangeEffectiveAt: '',
        },
      });

      return res.json({
        success: true,
        syncedLocally: true,
        message: 'Scheduled downgrade was removed. Your current plan will renew as-is.',
      });
    }

    // Calculate bonus days for trial upgrades
    let bonusDays = 0;
    if (isUpgradeFromTrial && sub.currentPeriodEnd) {
      const now = new Date();
      const remaining = sub.currentPeriodEnd.getTime() - now.getTime();
      bonusDays = Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
    }

    const prorationMode = isDowngradeRequest ? 'full_next_billing_period' : 'prorated_immediately';
    
    // For trial upgrades, extend the billing period by remaining trial days
    const patchPayload: Record<string, unknown> = {
      items: nextItems,
      proration_billing_mode: prorationMode,
    };

    if (isUpgradeFromTrial && bonusDays > 0) {
      // Add bonus days by extending the first billing period
      const existingPaddleSub = currentSubscriptionResponse?.data;
      const currentPeriodEnd = existingPaddleSub?.current_billing_period?.ends_at
        ? new Date(existingPaddleSub.current_billing_period.ends_at)
        : new Date();
      const extendedEnd = new Date(currentPeriodEnd.getTime() + bonusDays * 24 * 60 * 60 * 1000);
      patchPayload.next_billed_at = extendedEnd.toISOString();
    }

    const updatedSubscriptionResponse = await paddleRequest('patch', `/subscriptions/${paddleSubscriptionId}`, patchPayload);

    if (isDowngradeRequest) {
      const existingPaddleSub = currentSubscriptionResponse?.data;
      const effectiveAtRaw = existingPaddleSub?.next_billed_at ?? existingPaddleSub?.current_billing_period?.ends_at;
      const effectiveAt = effectiveAtRaw ? new Date(effectiveAtRaw) : undefined;

      await Subscription.findByIdAndUpdate(sub._id, {
        $set: {
          pendingPlanTier: tier,
          pendingBillingCycle: targetCycle,
          ...(effectiveAt ? { pendingChangeEffectiveAt: effectiveAt } : {}),
        },
      });
    } else if (isUpgradeOrLateralNow) {
      // Update local subscription with bonus days information
      const bonusSearches = bonusDays > 0 ? Math.round((bonusDays / 30) * def.imageUploadLimit) : 0;
      const bonusAlerts = bonusDays > 0 ? Math.round((bonusDays / 30) * def.alertLimit) : 0;

      await Subscription.findByIdAndUpdate(sub._id, {
        $set: {
          bonusSearches: (sub.bonusSearches ?? 0) + bonusSearches,
          bonusAlerts: (sub.bonusAlerts ?? 0) + bonusAlerts,
        },
        $unset: {
          pendingPlanTier: '',
          pendingBillingCycle: '',
          pendingChangeEffectiveAt: '',
        },
      });
    }

    let syncedLocally = false;
    try {
      const updatedPaddleSubscription = updatedSubscriptionResponse?.data
        ?? (await paddleRequest('get', `/subscriptions/${paddleSubscriptionId}`))?.data;
      syncedLocally = await syncLocalSubscriptionFromPaddle({
        userId,
        subscriptionDocId: String(sub._id),
        paddleSubscription: updatedPaddleSubscription,
      });
    } catch (syncErr: any) {
      console.error('[Paddle Subscription Update] Local sync after patch failed.', JSON.stringify(syncErr?.response?.data ?? syncErr?.message, null, 2));
    }

    res.json({
      success: true,
      syncedLocally,
      message: isDowngradeRequest
        ? `Downgrade to ${def.name} (${targetCycle}) is scheduled for your next renewal.`
        : isUpgradeFromTrial
        ? `Upgraded to ${def.name} (${targetCycle})${bonusDays > 0 ? ` with ${bonusDays} bonus days` : ''}. Changes take effect immediately.`
        : `Subscription change to ${def.name} (${targetCycle}) submitted. Changes take effect immediately.`,
    });
  } catch (err: any) {
    console.error('[Paddle Subscription Update Error]', JSON.stringify(err?.response?.data ?? err?.message, null, 2));
    const msg = err?.response?.data?.error?.detail || err?.message || 'Server error';
    const status = isPaddleNotFoundError(err) ? 409 : 500;
    res.status(status).json({
      success: false,
      message: msg,
      code: isPaddleNotFoundError(err) ? 'PADDLE_SUBSCRIPTION_NOT_FOUND' : undefined,
      details: isPaddleNotFoundError(err)
        ? { paddleEnvironment: process.env.PADDLE_ENVIRONMENT }
        : undefined,
    });
  }
};

/**
 * POST /billing/pause — pause the active Paddle subscription at end of current period.
 */
export const pauseSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;

    const sub = await Subscription.findOne({ userId, status: 'active' });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'No active subscription found.' });
    }
    if (!sub.paddleSubscriptionId) {
      return res.status(400).json({ success: false, message: 'Subscription is not managed by Paddle.' });
    }

    await paddleRequest('post', `/subscriptions/${sub.paddleSubscriptionId}/pause`, {
      effective_from: 'next_billing_period',
    });

    // subscription.paused webhook will update the local record.
    res.json({ success: true, message: 'Subscription will be paused at the end of the current billing period.' });
  } catch (err: any) {
    const msg = err?.response?.data?.error?.detail || err?.message || 'Server error';
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * POST /billing/resume — resume a paused Paddle subscription immediately.
 */
export const resumeSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;

    const sub = await Subscription.findOne({ userId, status: 'paused' });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'No paused subscription found.' });
    }
    if (!sub.paddleSubscriptionId) {
      return res.status(400).json({ success: false, message: 'Subscription is not managed by Paddle.' });
    }

    await runPaddleMutationWithRecovery({
      userId,
      localSubscriptionId: sub.paddleSubscriptionId,
      localSubscriptionDocId: sub._id,
      actionName: 'Paddle Resume Subscription',
      execute: async (subscriptionId: string) => {
        await paddleRequest('post', `/subscriptions/${subscriptionId}/resume`, {
          effective_from: 'immediately',
        });
      },
    });

    // subscription.resumed webhook will update the local record.
    res.json({ success: true, message: 'Subscription resumed. Access will be restored shortly.' });
  } catch (err: any) {
    const msg = err?.response?.data?.error?.detail || err?.message || 'Server error';
    const status = Number(err?.statusCode) || (isPaddleNotFoundError(err) ? 409 : 500);
    res.status(status).json({
      success: false,
      message: msg,
      code: err?.code || (isPaddleNotFoundError(err) ? 'PADDLE_SUBSCRIPTION_NOT_FOUND' : undefined),
      details: err?.details || (isPaddleNotFoundError(err) ? { paddleEnvironment: process.env.PADDLE_ENVIRONMENT } : undefined),
    });
  }
};

/**
 * POST /billing/resume-auto-renew — remove a scheduled end-of-period cancellation
 * so the subscription renews automatically again.
 */
export const resumeAutoRenew = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;

    const sub = await Subscription.findOne({
      userId,
      status: { $in: ['active', 'trialing', 'past_due'] },
    });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'No renewable subscription found.' });
    }
    if (!sub.paddleSubscriptionId) {
      return res.status(400).json({ success: false, message: 'Subscription is not managed by Paddle.' });
    }

    await runPaddleMutationWithRecovery({
      userId,
      localSubscriptionId: sub.paddleSubscriptionId,
      localSubscriptionDocId: sub._id,
      actionName: 'Paddle Resume Auto Renew',
      execute: async (subscriptionId: string) => {
        await paddleRequest('patch', `/subscriptions/${subscriptionId}`, {
          scheduled_change: null,
        });
      },
    });

    // Reflect the expected state immediately while webhook confirmation arrives.
    await Subscription.findByIdAndUpdate(sub._id, {
      $set: { autoRenewReminderStages: [] },
      $unset: {
        cancelDate: '',
        pendingPlanTier: '',
        pendingBillingCycle: '',
        pendingChangeEffectiveAt: '',
      },
    });

    res.json({ success: true, message: 'Auto-renew resumed. Your subscription will renew at the next billing date.' });
  } catch (err: any) {
    const msg = err?.response?.data?.error?.detail || err?.message || 'Server error';
    const status = Number(err?.statusCode) || (isPaddleNotFoundError(err) ? 409 : 500);
    res.status(status).json({
      success: false,
      message: msg,
      code: err?.code || (isPaddleNotFoundError(err) ? 'PADDLE_SUBSCRIPTION_NOT_FOUND' : undefined),
      details: err?.details || (isPaddleNotFoundError(err) ? { paddleEnvironment: process.env.PADDLE_ENVIRONMENT } : undefined),
    });
  }
};

/**
 * GET /billing/payment-method — return a Paddle customer portal URL so the
 * user can update their payment method directly in the Paddle-hosted portal.
 */
export const getUpdatePaymentUrl = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;

    // paddleCustomerId is stored on the Subscription when Paddle fires the webhook,
    // or on the User document. Check both.
    const [sub, userDoc] = await Promise.all([
      Subscription.findOne({
        userId,
        status: { $in: ['active', 'trialing', 'paused', 'past_due'] },
        paddleSubscriptionId: { $exists: true },
      }).lean(),
      User.findById(userId).select('paddleCustomerId').lean(),
    ]);

    const paddleCustomerId = (sub as any)?.paddleCustomerId || (userDoc as any)?.paddleCustomerId;
    if (!paddleCustomerId) {
      return res.status(404).json({ success: false, message: 'No Paddle customer record found. Please subscribe first.' });
    }

    const paddleSubId: string | undefined = (sub as any)?.paddleSubscriptionId;
    const data = await paddleRequest('post', `/customers/${paddleCustomerId}/portal-sessions`, paddleSubId ? { subscription_ids: [paddleSubId] } : {});
    const subEntry = data?.data?.urls?.subscriptions?.[0];
    const portalUrl: string | undefined =
      subEntry?.update_subscription_payment_method ?? data?.data?.urls?.general?.overview;

    if (!portalUrl) {
      return res.status(500).json({ success: false, message: 'Could not retrieve portal URL from Paddle.' });
    }

    // Keep both keys for backward compatibility with existing frontend callers.
    res.json({ success: true, portalUrl, updateUrl: portalUrl });
  } catch (err: any) {
    const msg = err?.response?.data?.error?.detail || err?.message || 'Server error';
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * GET /billing/portal — return a Paddle customer portal URL focused on account overview.
 * Users can view invoices/receipts and manage billing from the hosted portal.
 */
export const getBillingPortalUrl = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;

    const [sub, userDoc] = await Promise.all([
      Subscription.findOne({
        userId,
        status: { $in: ['active', 'trialing', 'paused', 'past_due', 'cancelled'] },
        paddleSubscriptionId: { $exists: true },
      }).lean(),
      User.findById(userId).select('paddleCustomerId').lean(),
    ]);

    const paddleCustomerId = (sub as any)?.paddleCustomerId || (userDoc as any)?.paddleCustomerId;
    if (!paddleCustomerId) {
      return res.status(404).json({ success: false, message: 'No Paddle customer record found. Please subscribe first.' });
    }

    const data = await paddleRequest('post', `/customers/${paddleCustomerId}/portal-sessions`, {});
    const portalUrl: string | undefined = data?.data?.urls?.general?.overview;

    if (!portalUrl) {
      return res.status(500).json({ success: false, message: 'Could not retrieve billing portal URL from Paddle.' });
    }

    res.json({ success: true, portalUrl });
  } catch (err: any) {
    const msg = err?.response?.data?.error?.detail || err?.message || 'Server error';
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * GET /billing/history — return paginated payment history for the authenticated user.
 */
export const getBillingHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Payment.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('amount currency status paddleTransactionId paddleSubscriptionId createdAt')
        .lean(),
      Payment.countDocuments({ userId }),
    ]);

    res.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
};

/**
 * POST /billing/cancel — cancel the user's active or trialing subscription.
 *
 * For Paddle-managed subscriptions: requests cancellation at end of billing period
 * via Paddle API, then waits for the subscription.canceled webhook to update the
 * local DB (no optimistic local update to avoid state mismatch).
 *
 * For non-Paddle subscriptions (trial grants, referral grants): updates locally.
 */
export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;

    const sub = await Subscription.findOne({
      userId,
      status: { $in: ['active', 'trialing', 'past_due'] },
    });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'No active subscription found.' });
    }

    if (sub.paddleSubscriptionId) {
      // Paddle-managed: send cancel request; let the webhook confirm cancellation.
      await runPaddleMutationWithRecovery({
        userId,
        localSubscriptionId: sub.paddleSubscriptionId,
        localSubscriptionDocId: sub._id,
        actionName: 'Paddle Cancel Subscription',
        execute: async (subscriptionId: string) => {
          await paddleRequest('post', `/subscriptions/${subscriptionId}/cancel`, {
            effective_from: 'next_billing_period',
          });
        },
      });
      await Subscription.findByIdAndUpdate(sub._id, {
        $unset: {
          pendingPlanTier: '',
          pendingBillingCycle: '',
          pendingChangeEffectiveAt: '',
        },
      });
      // Do NOT write locally here — subscription.canceled webhook is the source of truth.
      return res.json({
        success: true,
        message: 'Cancellation scheduled. Your subscription will remain active until the end of the current billing period.',
      });
    }

    // Non-Paddle (trial / referral grant): no webhook will come, update locally.
    await Subscription.findByIdAndUpdate(sub._id, {
      status: 'cancelled',
      cancelDate: new Date(),
      $unset: {
        pendingPlanTier: '',
        pendingBillingCycle: '',
        pendingChangeEffectiveAt: '',
      },
    });
    await User.findByIdAndUpdate(userId, { subscriptionId: null });
    res.json({ success: true, message: 'Subscription cancelled successfully.' });
  } catch (err: any) {
    const msg = err?.response?.data?.error?.detail || err?.message || 'Server error';
    const status = Number(err?.statusCode) || (isPaddleNotFoundError(err) ? 409 : 500);
    res.status(status).json({
      success: false,
      message: msg,
      code: err?.code || (isPaddleNotFoundError(err) ? 'PADDLE_SUBSCRIPTION_NOT_FOUND' : undefined),
      details: err?.details || (isPaddleNotFoundError(err) ? { paddleEnvironment: process.env.PADDLE_ENVIRONMENT } : undefined),
    });
  }
};

/**
 * POST /billing/sync — pull the latest subscription state from Paddle and
 * update the local DB. Use this after checkout when webhooks haven't fired yet
 * (e.g. local dev without ngrok). Safe to call repeatedly — fully idempotent.
 */
export const syncSubscriptionFromPaddle = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const { transactionId } = req.body as { transactionId?: string };

    let paddleCustomerId: string | undefined;
    let paddleSub: any;

    // Path 1: transactionId provided
    if (transactionId) {
      const txData = await paddleRequest('get', `/transactions/${transactionId}`);
      const tx = txData?.data;
      if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found in Paddle.' });
      if (tx.customer_id) {
        paddleCustomerId = tx.customer_id;
        await User.findByIdAndUpdate(userId, { paddleCustomerId });
      }
      if (tx.subscription_id) {
        const subData = await paddleRequest('get', `/subscriptions/${tx.subscription_id}`);
        paddleSub = subData?.data;
      }
    }

    // Path 2/3: use cached paddleCustomerId or fall back to email
    if (!paddleSub) {
      if (!paddleCustomerId) {
        const userDoc = await User.findById(userId).select('paddleCustomerId email').lean();
        paddleCustomerId = (userDoc as any)?.paddleCustomerId;
        if (!paddleCustomerId) {
          const userEmail: string = (userDoc as any)?.email ?? '';
          if (!userEmail) return res.status(404).json({ success: false, message: 'No Paddle customer found for this account. Complete a checkout first.' });
          const searchData = await paddleRequest('get', `/customers?email=${encodeURIComponent(userEmail)}&per_page=5`);
          const customers: any[] = searchData?.data ?? [];
          if (!customers.length) return res.status(404).json({ success: false, message: 'No Paddle customer found for this account. Complete a checkout first.' });
          paddleCustomerId = customers[0].id;
          await User.findByIdAndUpdate(userId, { paddleCustomerId });
        }
      }
      const subListData = await paddleRequest('get', `/subscriptions?customer_id=${paddleCustomerId}&per_page=10`);
      const subscriptions: any[] = subListData?.data ?? [];
      if (!subscriptions.length) return res.json({ success: true, synced: false, message: 'No subscriptions found in Paddle for this customer.' });
      const STATUS_PRIORITY: Record<string, number> = { active: 0, trialing: 1, paused: 2, past_due: 3, canceled: 4 };
      paddleSub = subscriptions.sort((a: any, b: any) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9))[0];
    }

    const paddlePriceId = paddleSub.items?.[0]?.price?.id;
    if (!paddlePriceId) {
      return res.status(422).json({ success: false, message: 'Could not read price ID from Paddle subscription.' });
    }

    const plan = await Plan.findOne({
      $or: [
        { paddleMonthlyPriceId: paddlePriceId },
        { paddleAnnualPriceId:  paddlePriceId },
        { paddleTrialPriceId:   paddlePriceId },
      ],
    });
    if (!plan) {
      return res.status(422).json({ success: false, message: `No local plan matched price ID: ${paddlePriceId}` });
    }

    const PADDLE_STATUS_MAP: Record<string, string> = {
      active:   'active',
      trialing: 'trialing',
      paused:   'paused',
      past_due: 'past_due',
      canceled: 'cancelled',
    };
    const status = PADDLE_STATUS_MAP[paddleSub.status] ?? 'pending';
    const billingCycle: BillingCycle = paddleSub.billing_cycle?.interval === 'year' ? 'annual' : 'monthly';
    const periodEnd = paddleSub.current_billing_period?.ends_at
      ? new Date(paddleSub.current_billing_period.ends_at)
      : undefined;
    const trialEnd = paddleSub.next_billed_at && status === 'trialing'
      ? new Date(paddleSub.next_billed_at)
      : undefined;

    const subscription = await Subscription.findOneAndUpdate(
      { paddleSubscriptionId: paddleSub.id },
      {
        userId,
        planId: plan._id,
        billingCycle,
        grantSource: status === 'trialing' ? 'trial' : 'paid',
        status,
        activationDate: paddleSub.created_at ? new Date(paddleSub.created_at) : new Date(),
        paddleSubscriptionId: paddleSub.id,
        paddleCustomerId: paddleSub.customer_id,
        ...(periodEnd && { currentPeriodEnd: periodEnd, nextBillingDate: periodEnd }),
        ...(trialEnd  && { trialEndDate: trialEnd }),
        ...(status === 'cancelled' && { cancelDate: new Date() }),
      },
      { upsert: true, new: true },
    );

    await User.findByIdAndUpdate(userId, {
      subscriptionId:   subscription._id,
      paddleCustomerId: paddleSub.customer_id,
      subscriptionStatus: status,
    });

    // Top up credits/alerts if now active and not previously active
    if (status === 'active') {
      const def = getPlanDefinition(plan.tier as PlanTier);
      await Promise.all([
        topUpCredits(userId, def.imageUploadLimit),
        topUpAlerts(userId, def.alertLimit),
      ]);
    }

    console.log(`[Paddle Sync] userId=${userId} paddleSubId=${paddleSub.id} status=${status} plan=${plan.tier}`);

    res.json({
      success: true,
      synced: true,
      status,
      plan: plan.tier,
      billingCycle,
      paddleSubscriptionId: paddleSub.id,
    });
  } catch (err: any) {
    const paddleError = err?.response?.data;
    console.error('[Paddle Sync Error]', JSON.stringify(paddleError ?? err?.message, null, 2));
    const msg = paddleError?.error?.detail || err?.message || 'Server error';
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * POST /billing/start-trial — initiate a 7-day trial for the user
 * Request body: { tier?: 'pro' | 'premium' | 'starter' } (defaults to 'pro')
 */
export const startTrial = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const { tier = 'pro' } = req.body as { tier?: PlanTier };

    // Check if user already has an active or trialing subscription
    const existing = await Subscription.findOne({
      userId,
      status: { $in: ['active', 'trialing', 'pending'] },
    }).lean();

    if (existing) {
      return res.status(409).json({
        success: false,
        message: existing.status === 'trialing'
          ? 'You already have an active trial. Upgrade to a paid plan or wait for it to expire.'
          : `You already have an active ${existing.status} subscription.`,
      });
    }

    // Get plan definition
    const planDef = getPlanDefinition(tier);
    const userDoc = await User.findById(userId).select(\'refferedBy\').lean();\n    const isReferred = !!(userDoc as any)?.refferedBy;\n    const trialDays = isReferred ? 30 : (planDef.trialDays ?? Number(process.env.TRIAL_DAYS_PRO ?? 7));

    // Get or create plan in DB
    const plan = await Plan.findOneAndUpdate(
      { tier },
      {
        $set: {
          name:              planDef.name,
          imageUploadLimit:  planDef.imageUploadLimit,
          alertLimit:        planDef.alertLimit,
          pdfEnabled:        planDef.pdfEnabled,
          weeklyEmailAlerts: planDef.weeklyEmailAlerts,
          monthlyPrice:      planDef.pricing.monthly,
          annualPrice:       planDef.pricing.annual,
          trialDays:         planDef.trialDays,
        },
        $setOnInsert: { tier },
      },
      { upsert: true, new: true },
    );

    // Cancel any existing subscriptions
    await Subscription.updateMany(
      { userId, status: { $in: ['active', 'pending'] } },
      { $set: { status: 'cancelled', cancelDate: new Date() } },
    );

    const now = new Date();
    const periodEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    // Try to create Paddle subscription if trial price ID exists
    let paddleSubscriptionId: string | undefined;
    let paddleCustomerId: string | undefined;

    const trialPriceId = planDef.paddleTrialPriceId;
    if (trialPriceId && isPaddlePriceId(String(trialPriceId))) {
      try {
        const user = await User.findById(userId).select('email name paddleCustomerId').lean();
        const email: string = (user as any)?.email ?? '';
        const name: string = (user as any)?.name ?? '';

        // Get or create Paddle customer
        paddleCustomerId = await getOrCreatePaddleCustomer(userId, email, name);

        // Create Paddle subscription using trial price
        const createSubResponse = await paddleRequest('post', '/subscriptions', {
          customer_id: paddleCustomerId,
          items: [{ price_id: trialPriceId, quantity: 1 }],
          custom_data: { userId },
        });

        paddleSubscriptionId = createSubResponse?.data?.id;
        if (!paddleSubscriptionId) {
          console.warn(`[Start Trial] Paddle subscription creation returned no ID for userId=${userId}`);
        }
      } catch (paddleErr: any) {
        console.error(`[Start Trial] Failed to create Paddle subscription: ${paddleErr?.message}`);
        // Fall back to local trial if Paddle fails
      }
    }

    // Create local subscription
    await Subscription.create({
      userId,
      planId:           plan._id,
      billingCycle:     'monthly',
      grantSource:      'trial',
      activationDate:   now,
      currentPeriodEnd: periodEnd,
      nextBillingDate:  periodEnd,
      status:           'trialing',
      trialEndDate:     periodEnd,
      trialReminderStages: [],
      ...(paddleSubscriptionId ? { paddleSubscriptionId } : {}),
      ...(paddleCustomerId ? { paddleCustomerId } : {}),
    });

    // Top up credits and alerts
    await Promise.all([
      topUpCredits(userId, planDef.imageUploadLimit),
      topUpAlerts(userId, planDef.alertLimit),
    ]);

    res.json({
      success: true,
      message: `7-day ${tier.charAt(0).toUpperCase() + tier.slice(1)} trial started!`,
      tier,
      trialDays,
    });
  } catch (error: any) {
    console.error('[Start Trial Error]', error?.message);
    const msg = error?.message || 'Failed to start trial. Please try again.';
    res.status(error?.statusCode ?? 500).json({ success: false, message: msg });
  }
};

