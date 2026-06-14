import { Request, Response } from 'express';
import crypto from 'crypto';
import { PaddleService } from './paddle.service';

type PaddleEventHandler = (data: any) => Promise<void>;

const PADDLE_EVENT_HANDLERS: Partial<Record<string, PaddleEventHandler>> = {
  // Transaction events
  'transaction.completed': (data) => PaddleService.handleTransactionCompleted(data),
  'transaction.payment_failed': (data) => PaddleService.handleTransactionFailed(data),

  // Refund/credit events
  'adjustment.created': (data) => PaddleService.handleAdjustmentCreated(data),
  'adjustment.updated': (data) => PaddleService.handleAdjustmentCreated(data),

  // Subscription lifecycle events
  'subscription.created': (data) => PaddleService.handleSubscriptionCreated(data),
  'subscription.trialing': (data) => PaddleService.handleSubscriptionTrialing(data),
  'subscription.activated': (data) => PaddleService.handleSubscriptionActivated(data),
  'subscription.updated': (data) => PaddleService.handleSubscriptionUpdated(data),
  'subscription.past_due': (data) => PaddleService.handleSubscriptionPastDue(data),
  'subscription.paused': (data) => PaddleService.handleSubscriptionPaused(data),
  'subscription.resumed': (data) => PaddleService.handleSubscriptionResumed(data),
  'subscription.canceled': (data) => PaddleService.handleSubscriptionCanceled(data),
};

const shouldLogIgnoredEvent = process.env.PADDLE_WEBHOOK_DEBUG_IGNORED === 'true';

const verifyPaddleSignature = (
  signatureHeader: string,
  rawBody: string,
  secret: string,
  toleranceMs = 5 * 60 * 1000, // 5-minute replay-attack window (Paddle SDKs default to 5 s)
): boolean => {
  const parts = signatureHeader.split(';');
  let ts = '', h1 = '';
  for (const part of parts) {
    if (part.startsWith('ts=')) ts = part.substring(3);
    if (part.startsWith('h1=')) h1 = part.substring(3);
  }
  if (!ts || !h1) return false;

  // Replay-attack protection: reject events whose timestamp is outside the tolerance window.
  const tsMs = parseInt(ts, 10) * 1000;
  if (isNaN(tsMs) || Date.now() - tsMs > toleranceMs) return false;

  const payload = `${ts}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedHmac = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(h1));
};

export const handlePaddleWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['paddle-signature'] as string | undefined;
    const secret = process.env.PADDLE_WEBHOOK_SECRET as string;
    const rawBody = (req as any).rawBody as string | undefined;

    // Guard: missing headers / body before attempting crypto operations
    if (!signature || !rawBody) {
      res.status(400).send('Missing paddle-signature header or raw body');
      return;
    }

    if (!secret) {
      console.error('[Paddle] PADDLE_WEBHOOK_SECRET is not configured');
      res.status(500).send('Webhook secret not configured');
      return;
    }

    if (!verifyPaddleSignature(signature, rawBody, secret)) {
      res.status(401).send('Invalid webhook signature');
      return;
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).send('Invalid JSON body');
      return;
    }

    const eventType: string = event.event_type;
    const data = event.data;

    const handler = PADDLE_EVENT_HANDLERS[eventType];
    if (handler) {
      console.log(`[Paddle] Received event: ${eventType}`);
    } else if (shouldLogIgnoredEvent) {
      console.debug(`[Paddle] Ignored event: ${eventType}`);
    }

    // Acknowledge receipt immediately — Paddle requires a 200 response within 5 seconds.
    // All business logic runs asynchronously below so we never time out.
    res.status(200).send('OK');

    // Process the event asynchronously after the response is flushed.
    setImmediate(async () => {
      if (!handler) return;

      try {
        await handler(data);
      } catch (error) {
        console.error(`[Paddle] Error processing event "${eventType}":`, error);
      }
    });
  } catch (error) {
    console.error('[Paddle] Webhook handler error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
};