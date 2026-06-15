# IpHint Subscription & Billing System - Technical Documentation

**Last Updated**: June 15, 2026  
**Version**: 1.0.0

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Plan Tiers & Features](#plan-tiers--features)
3. [Subscription Lifecycle](#subscription-lifecycle)
4. [Payment Processing](#payment-processing)
5. [Data Models](#data-models)
6. [API Endpoints](#api-endpoints)
7. [Paddle Webhook Events](#paddle-webhook-events)
8. [Workflow Diagrams](#workflow-diagrams)
9. [Configuration](#configuration)
10. [Background Workers](#background-workers)

---

## System Overview

### Architecture

The IpHint billing system uses **Paddle** as the payment gateway provider, which handles:
- Recurring subscription management
- Trial period configuration
- Automatic billing and renewals
- Payment collection and reminders
- Refund and adjustment handling
- Multi-currency support

The system stores subscription state locally in MongoDB while using Paddle as the source of truth for payment transactions.

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Application                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              IpHint Backend (Express.js)                     │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │   Billing Module (/modules/billing)                     │ │
│ │ • Manage subscriptions                                   │ │
│ │ • Handle plan selection                                 │ │
│ │ • Create Paddle checkout                                │ │
│ │ • Cancel/update subscriptions                           │ │
│ │ • Manage billing history                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │   Paddle Module (/modules/paddle)                       │ │
│ │ • Webhook handler                                       │ │
│ │ • Event processing                                      │ │
│ │ • Signature verification                                │ │
│ │ • Subscription sync from Paddle                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │   MongoDB (Subscriptions, Payments, Plans)             │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────┬────────────────┘
                                              │
                                              ▼
                    ┌─────────────────────────────────────┐
                    │   Paddle Payment Gateway            │
                    │ • Process payments                  │
                    │ • Manage subscriptions              │
                    │ • Send webhooks                     │
                    │ • Refund processing                 │
                    └─────────────────────────────────────┘
```

---

## Plan Tiers & Features

### Available Plans

The system supports three subscription tiers, each with different feature sets and pricing:

#### 1. **Starter Plan**
| Feature | Value |
|---------|-------|
| **Tier Name** | Starter |
| **Image Upload Limit** | 10 searches/month |
| **Result View Limit** | 1,000 results per search |
| **Alert Limit** | 1,000 cumulative alerts/month |
| **PDF Reports** | ❌ Not Available |
| **Weekly Email Alerts** | ✅ Available |
| **Pricing (Monthly)** | $6.62/month |
| **Pricing (Annual)** | $5.30/month (billed annually) |
| **Trial Days** | Configurable (env: `TRIAL_DAYS_STARTER`) |
| **Paddle Price IDs** | `PADDLE_STARTER_MONTHLY_PRICE_ID`, `PADDLE_STARTER_ANNUAL_PRICE_ID`, `PADDLE_STARTER_TRIAL_PRICE_ID` |

**Features Included:**
- Monitor up to 10 registered items
- View up to 1,000 results per search
- 1,000 cumulative discovery alerts
- Automatic duplicate filtering
- Content exposure risk analysis
- In-app notifications

---

#### 2. **Pro Plan**
| Feature | Value |
|---------|-------|
| **Tier Name** | Pro |
| **Image Upload Limit** | 50 searches/month |
| **Result View Limit** | 5,000 results per search |
| **Alert Limit** | 5,000 cumulative alerts/month |
| **PDF Reports** | ✅ Available |
| **Weekly Email Alerts** | ✅ Available |
| **Pricing (Monthly)** | $19.39/month |
| **Pricing (Annual)** | $13.57/month (billed annually) |
| **Trial Days** | Configurable (env: `TRIAL_DAYS_PRO`) |
| **Paddle Price IDs** | `PADDLE_PRO_MONTHLY_PRICE_ID`, `PADDLE_PRO_ANNUAL_PRICE_ID`, `PADDLE_PRO_TRIAL_PRICE_ID` |

**Features Included:**
- Monitor up to 50 registered items
- View up to 5,000 results per search
- 5,000 cumulative discovery alerts
- Automatic duplicate filtering
- Content exposure risk analysis
- **PDF report generation**
- In-app notifications

---

#### 3. **Premium Plan**
| Feature | Value |
|---------|-------|
| **Tier Name** | Premium |
| **Image Upload Limit** | 100 searches/month |
| **Result View Limit** | Unlimited |
| **Alert Limit** | Unlimited |
| **PDF Reports** | ✅ Available |
| **Weekly Email Alerts** | ✅ Available |
| **Pricing (Monthly)** | $32.77/month |
| **Pricing (Annual)** | $25.36/month (billed annually) |
| **Trial Days** | Configurable (env: `TRIAL_DAYS_PREMIUM`) |
| **Paddle Price IDs** | `PADDLE_PREMIUM_MONTHLY_PRICE_ID`, `PADDLE_PREMIUM_ANNUAL_PRICE_ID`, `PADDLE_PREMIUM_TRIAL_PRICE_ID` |

**Features Included:**
- Monitor up to 100 registered items
- **Unlimited result visibility** per search
- **Unlimited discovery alerts**
- Automatic duplicate filtering
- Content exposure risk analysis
- PDF report generation
- 1:1 dedicated manager
- In-app notifications

---

### Plan Synchronization

Plans are automatically synced from environment variables at server startup:

```typescript
// Called in server.ts during bootstrap
await syncPlanCatalogFromEnv();
```

**Process:**
1. Read plan definitions from `PLAN_DEFINITIONS` (billing.constants.ts)
2. Extract Paddle Price IDs from environment variables
3. Upsert plans into MongoDB with `findOneAndUpdate()`
4. Maintain backward compatibility with existing subscriptions

**Environment Variables Required:**
```bash
# Starter Plan
PADDLE_STARTER_MONTHLY_PRICE_ID=pri_...
PADDLE_STARTER_ANNUAL_PRICE_ID=pri_...
PADDLE_STARTER_TRIAL_PRICE_ID=pri_...

# Pro Plan
PADDLE_PRO_MONTHLY_PRICE_ID=pri_...
PADDLE_PRO_ANNUAL_PRICE_ID=pri_...
PADDLE_PRO_TRIAL_PRICE_ID=pri_...

# Premium Plan
PADDLE_PREMIUM_MONTHLY_PRICE_ID=pri_...
PADDLE_PREMIUM_ANNUAL_PRICE_ID=pri_...
PADDLE_PREMIUM_TRIAL_PRICE_ID=pri_...

# Trial Configuration
TRIAL_DAYS_DEFAULT=14
TRIAL_DAYS_STARTER=14
TRIAL_DAYS_PRO=14
TRIAL_DAYS_PREMIUM=14

# Result View Limits
STARTER_RESULT_VIEW_LIMIT=1000
PRO_RESULT_VIEW_LIMIT=5000
PREMIUM_RESULT_VIEW_LIMIT=0  # 0 = unlimited
```

---

## Subscription Lifecycle

### Subscription States

```
                    ┌─────────────────────────────┐
                    │  New User Registration      │
                    │  (Trial Eligible)           │
                    └────────────┬────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Starts Free Trial      │
                    │  Status: "trialing"     │
                    │  Duration: 14 days      │
                    └────────────┬────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                                 │
    ┌───────────▼────────────┐        ┌──────────▼──────────┐
    │  Trial Ends            │        │  Upgrades Plan      │
    │  Auto-Cancel           │        │  Payment Successful │
    │  Status: "cancelled"   │        │  Status: "active"   │
    └────────────────────────┘        └──────────┬──────────┘
                                                  │
                                    ┌─────────────▼──────────┐
                                    │  Active Subscription   │
                                    │  Auto-Renews Monthly   │
                                    │  Status: "active"      │
                                    └──────────┬─────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
        ┌───────────▼────────────┐  ┌─────────▼────────┐    ┌────────────▼────────┐
        │  User Pauses           │  │  User Cancels    │    │  Payment Failed     │
        │  Status: "paused"      │  │  Status:         │    │  Status: "past_due" │
        │  Can Resume Anytime    │  │  "cancelled"     │    │  Auto-Retry Billing │
        └────────────────────────┘  └──────────────────┘    └─────────────────────┘
```

### Subscription Status Values

| Status | Description | Renewable | Auto-Bills |
|--------|-------------|-----------|-----------|
| `pending` | Subscription created but not yet active | ❌ | ❌ |
| `trialing` | Free trial period active | ✅ | ❌ (converts to active) |
| `active` | Active paid subscription | ✅ | ✅ |
| `past_due` | Payment failed, awaiting retry | ✅ | ✅ (auto-retry) |
| `paused` | User paused subscription temporarily | ✅ | ❌ |
| `cancelled` | Subscription ended | ❌ | ❌ |
| `expired` | Trial or subscription period expired | ❌ | ❌ |

---

### Subscription Model Schema

```typescript
{
  userId: ObjectId                          // Reference to User
  planId: ObjectId                          // Reference to Plan
  
  // Billing Information
  billingCycle: 'monthly' | 'annual'        // Renewal frequency
  status: SubscriptionStatus                // Current subscription state
  grantSource: 'trial' | 'referral' | 'paid' // How subscription was obtained
  
  // Dates
  activationDate: Date                      // When subscription started
  currentPeriodEnd: Date                    // End of current billing cycle
  trialEndDate: Date (optional)             // Trial expiration date
  nextBillingDate: Date (optional)          // Next renewal date
  cancelDate: Date (optional)               // When subscription was cancelled
  
  // Paddle Integration
  paddleSubscriptionId: string (optional)   // Paddle subscription ID
  paddleCustomerId: string (optional)       // Paddle customer ID
  
  // Pending Changes
  pendingPlanTier: 'starter' | 'pro' | 'premium' (optional)
  pendingBillingCycle: 'monthly' | 'annual' (optional)
  pendingChangeEffectiveAt: Date (optional) // When change takes effect
  
  // Bonus Allocations
  bonusSearches: number                     // Extra searches added on upgrade
  bonusAlerts: number                       // Extra alerts added on upgrade
  
  // Notification Tracking
  autoRenewReminderStages: number[]         // Days left when reminders sent
  trialReminderStages: number[]             // Days left when trial reminders sent
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
}
```

---

## Payment Processing

### Paddle Integration Flow

#### 1. **Trial Signup**

```
User Registration
    ↓
Check Trial Eligibility (isTrialEligible)
    ↓
Get/Create Paddle Customer (getOrCreatePaddleCustomer)
    ↓
Create Paddle Checkout with Trial Price
    ↓
Redirect to Paddle Payment Page
    ↓
User confirms trial (no payment required)
    ↓
Paddle webhook: "subscription.trialing"
    ↓
Create Subscription record with status: "trialing"
    ↓
Set trialEndDate to trial period end
    ↓
User has 14 days free access (default)
```

#### 2. **Trial to Paid Conversion**

When trial period ends, Paddle handles the automatic conversion:

```
Trial Period Ends (after 14 days)
    ↓
Paddle automatically charges payment method
    ↓
If payment succeeds:
    ├─ Paddle webhook: "subscription.activated"
    ├─ Update Subscription status: "active"
    ├─ Set nextBillingDate to 30 days from now
    └─ Send confirmation email to user
    
If payment fails:
    ├─ Paddle webhook: "subscription.past_due"
    ├─ Update Subscription status: "past_due"
    ├─ Send payment retry notification
    └─ Retry billing up to 10 times over 3 days
```

#### 3. **Paid Subscription (Monthly)**

```
Active Subscription
    ↓
Every 30 days: Renewal Date Approaches
    ├─ Auto-Renewal Reminder Worker triggers (3 days before)
    ├─ Send reminder email to user
    └─ Include renewal amount and date
    ↓
Renewal Date Arrives
    ├─ Paddle automatically charges payment method
    ├─ Payment succeeds → Status remains "active"
    └─ Payment fails → Status becomes "past_due"
    ↓
Repeat cycle every 30 days
```

#### 4. **Plan Upgrade/Downgrade**

```
User requests plan change (e.g., Starter → Pro)
    ↓
Validate new plan and billing cycle
    ↓
Call Paddle API to update subscription items
    ↓
Paddle calculates proration
    ├─ Charge difference for upgrade
    └─ Refund difference for downgrade
    ↓
Paddle webhook: "subscription.updated"
    ↓
Update Subscription record:
    ├─ planId → new plan
    ├─ bonusSearches → carry-over unused searches
    └─ bonusAlerts → carry-over unused alerts
    ↓
Confirm upgrade/downgrade to user
```

#### 5. **Cancellation**

```
User requests cancellation
    ↓
Two options:
├─ Immediate: Status changes to "cancelled" immediately
└─ At Period End: Mark with scheduled_change (status "cancelled" on renewal date)
    ↓
If scheduled at period end:
    ├─ Status remains "active" until renewal date
    ├─ Send cancellation confirmation
    └─ On renewal date, Paddle triggers "subscription.canceled" webhook
    ↓
Update Subscription record:
    ├─ status → "cancelled"
    ├─ cancelDate → current date or scheduled date
    └─ Clear trial/reminder stages
    ↓
User loses access to premium features at expiry
```

---

### Payment Model Schema

```typescript
{
  userId: ObjectId                          // User who made payment
  subscriptionPlanId: ObjectId (optional)   // Related subscription
  
  // Payment Details
  amount: number                            // Payment amount in cents/pennies
  currency: string                          // Currency code (default: "USD")
  status: 'completed' | 'failed' | 'refunded'
  
  // Paddle References
  paddleTransactionId: string (unique)      // Paddle transaction ID
  paddleSubscriptionId: string (optional)   // Associated subscription
  
  // Timestamps
  createdAt: Date
}
```

---

## Data Models

### Plan Model

```typescript
interface IPlan {
  tier: 'starter' | 'pro' | 'premium'
  
  // Naming & Limits
  name: string
  imageUploadLimit: number
  resultViewLimit: number
  alertLimit: number
  
  // Features
  pdfEnabled: boolean
  weeklyEmailAlerts: boolean
  
  // Pricing
  monthlyPrice: number                      // Monthly cost in USD
  annualPrice: number                       // Annual cost per month (when billed yearly)
  
  // Trial Configuration
  trialDays: number                         // Trial period length
  
  // Paddle Price IDs
  paddleMonthlyPriceId?: string
  paddleAnnualPriceId?: string
  paddleTrialPriceId?: string               // Optional trial-specific price with pre-configured trial
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
}
```

### User Model (Billing Fields)

```typescript
interface BillingFieldsOnUser {
  subscriptionId: ObjectId                  // Current active subscription
  subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused'
  paddleCustomerId: string (optional)       // Cached Paddle customer ID
  paddleSubscriptionId: string (optional)   // Cached Paddle subscription ID
}
```

---

## API Endpoints

### Base Path
```
/api/v1/billing
```

### 1. **Get Available Plans**

**Endpoint:** `GET /plans`  
**Auth:** Public (no authentication required)  
**Description:** Get list of all available plans with features and pricing

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "plan_id_1",
      "tier": "starter",
      "name": "Starter",
      "imageUploadLimit": 10,
      "resultViewLimit": 1000,
      "alertLimit": 1000,
      "pdfEnabled": false,
      "monthlyPrice": 6.62,
      "annualPrice": 5.30,
      "trialDays": 14,
      "features": [...]
    },
    // ... pro and premium plans
  ]
}
```

---

### 2. **Get User's Active Subscription**

**Endpoint:** `GET /subscription`  
**Auth:** Required (JWT token)  
**Description:** Get current subscription details for authenticated user

**Response:**
```json
{
  "success": true,
  "data": {
    "subscription": {
      "_id": "sub_id",
      "userId": "user_id",
      "planId": "plan_id",
      "plan": {
        "tier": "pro",
        "name": "Pro",
        "imageUploadLimit": 50,
        "pdfEnabled": true
      },
      "status": "active",
      "billingCycle": "monthly",
      "activationDate": "2026-06-01T00:00:00Z",
      "currentPeriodEnd": "2026-07-01T00:00:00Z",
      "nextBillingDate": "2026-07-01T00:00:00Z",
      "paddleSubscriptionId": "sub_paddle_123"
    },
    "trialEndsIn": null,
    "renewsIn": 16,
    "renewalAmount": 19.39,
    "currency": "USD"
  }
}
```

---

### 3. **Get Plan Limits**

**Endpoint:** `GET /plan-limits`  
**Auth:** Required  
**Description:** Get current plan limits for authenticated user

**Response:**
```json
{
  "success": true,
  "data": {
    "planTier": "pro",
    "limits": {
      "imageUploadLimit": 50,
      "resultViewLimit": 5000,
      "alertLimit": 5000,
      "pdfEnabled": true
    },
    "usage": {
      "searchesUsed": 23,
      "searchesRemaining": 27,
      "alertsUsed": 1200,
      "alertsRemaining": 3800
    }
  }
}
```

---

### 4. **Create Paddle Checkout**

**Endpoint:** `POST /paddle/checkout`  
**Auth:** Required  
**Body:**
```json
{
  "planTier": "pro",
  "billingCycle": "monthly"
}
```

**Description:** Initiate Paddle checkout session for new subscription or upgrade

**Response:**
```json
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.paddle.com/checkout/...",
    "checkoutSessionId": "session_123"
  }
}
```

**Process:**
1. Validate user eligibility (trial users only)
2. Get or create Paddle customer
3. Build checkout URL based on plan and trial eligibility
4. Return URL for frontend redirect

---

### 5. **Update Subscription**

**Endpoint:** `PATCH /subscription`  
**Auth:** Required  
**Body:**
```json
{
  "planTier": "premium",
  "billingCycle": "annual"
}
```

**Description:** Upgrade or downgrade subscription plan

**Response:**
```json
{
  "success": true,
  "data": {
    "subscription": {
      "planTier": "premium",
      "billingCycle": "annual",
      "status": "active"
    },
    "proratedAmount": 25.50,
    "effective": "immediately"
  }
}
```

---

### 6. **Cancel Subscription**

**Endpoint:** `POST /cancel`  
**Auth:** Required  
**Body:**
```json
{
  "effective": "immediately" // or "at_period_end"
}
```

**Description:** Cancel user's subscription

**Response:**
```json
{
  "success": true,
  "data": {
    "subscription": {
      "status": "cancelled",
      "cancelledAt": "2026-06-15T10:30:00Z",
      "lastAccessDate": "2026-07-01T00:00:00Z"
    }
  }
}
```

---

### 7. **Pause Subscription**

**Endpoint:** `POST /pause`  
**Auth:** Required  
**Description:** Pause subscription (temporarily stop billing)

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "paused",
    "pausedAt": "2026-06-15T10:30:00Z",
    "message": "Subscription paused. You can resume anytime."
  }
}
```

---

### 8. **Resume Subscription**

**Endpoint:** `POST /resume`  
**Auth:** Required  
**Description:** Resume a paused subscription

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "active",
    "resumedAt": "2026-06-15T10:30:00Z",
    "nextBillingDate": "2026-07-01T00:00:00Z"
  }
}
```

---

### 9. **Resume Auto-Renew**

**Endpoint:** `POST /resume-auto-renew`  
**Auth:** Required  
**Description:** Resume automatic renewal for scheduled cancellations

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Auto-renewal resumed",
    "nextBillingDate": "2026-07-01T00:00:00Z"
  }
}
```

---

### 10. **Get Payment History**

**Endpoint:** `GET /history`  
**Auth:** Required  
**Query Params:**
- `limit` (default: 10, max: 50) - Items per page
- `offset` (default: 0) - Pagination offset

**Description:** Get user's payment history

**Response:**
```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "id": "payment_1",
        "amount": 19.39,
        "currency": "USD",
        "status": "completed",
        "date": "2026-06-01T00:00:00Z",
        "description": "Pro - Monthly",
        "paddleTransactionId": "txn_123"
      }
    ],
    "total": 1,
    "limit": 10,
    "offset": 0
  }
}
```

---

### 11. **Get Update Payment URL**

**Endpoint:** `GET /payment-method`  
**Auth:** Required  
**Description:** Get Paddle billing portal URL to update payment method

**Response:**
```json
{
  "success": true,
  "data": {
    "portalUrl": "https://billing.paddle.com/...",
    "expiresIn": 3600
  }
}
```

---

### 12. **Get Billing Portal URL**

**Endpoint:** `GET /portal`  
**Auth:** Required  
**Description:** Get Paddle billing portal URL for full account management

**Response:**
```json
{
  "success": true,
  "data": {
    "portalUrl": "https://billing.paddle.com/...",
    "expiresIn": 3600
  }
}
```

---

### 13. **Sync Subscription from Paddle**

**Endpoint:** `POST /sync`  
**Auth:** Required  
**Description:** Manually sync subscription state from Paddle (use if webhook doesn't fire)

**Response:**
```json
{
  "success": true,
  "data": {
    "subscription": {
      "status": "active",
      "planTier": "pro",
      "nextBillingDate": "2026-07-01T00:00:00Z",
      "synced": true
    }
  }
}
```

---

## Paddle Webhook Events

### Webhook Configuration

**Endpoint:** `/api/v1/webhooks/paddle`  
**Method:** `POST`  
**Authentication:** Signature verification (HMAC-SHA256)

### Event Processing

All webhook events are:
1. **Verified** - Signature validation using `PADDLE_WEBHOOK_SECRET`
2. **Acknowledged** - Immediate 200 response to prevent retries
3. **Processed Asynchronously** - Business logic runs after response

### Supported Events

#### Transaction Events

**`transaction.completed`**
- User completed payment
- Updates Payment record with status "completed"
- Triggers subscription activation if applicable

**`transaction.payment_failed`**
- Payment declined
- Updates Subscription status to "past_due"
- Sends payment failure notification

#### Subscription Events

**`subscription.created`**
- New subscription created in Paddle
- Creates local Subscription record with status "pending"
- Links user to subscription

**`subscription.trialing`**
- Trial period started
- Status: "trialing"
- Sets trialEndDate based on trial length
- Sends welcome email with trial end date

**`subscription.activated`**
- Trial converted to paid OR new paid subscription activated
- Status: "active"
- Sets currentPeriodEnd and nextBillingDate
- Sends confirmation email
- Cancels any other active subscriptions for same user

**`subscription.updated`**
- Subscription modified (plan change, billing cycle change, etc.)
- Recalculates plan features
- Updates billing dates if changed
- Carries over unused credits/alerts

**`subscription.past_due`**
- Payment failed, awaiting retry
- Status: "past_due"
- Sends payment retry notification
- Paddle auto-retries up to 10 times

**`subscription.paused`**
- User paused subscription
- Status: "paused"
- No automatic billing occurs

**`subscription.resumed`**
- Paused subscription resumed
- Status: "active"
- Sets new nextBillingDate

**`subscription.canceled`**
- Subscription cancelled by user or system
- Status: "cancelled"
- Sets cancelDate
- Sends cancellation confirmation

#### Adjustment Events

**`adjustment.created`**
- Refund, credit, or debit issued
- Creates Payment record
- Updates user credits/alerts if applicable

**`adjustment.updated`**
- Adjustment modified
- Updates Payment record

### Webhook Signature Verification

```typescript
// Header: paddle-signature
// Format: ts=<timestamp>;h1=<hmac>
// Secret: PADDLE_WEBHOOK_SECRET

// Verification Process:
1. Extract timestamp (ts) and HMAC (h1) from header
2. Check timestamp within 5-minute tolerance window (replay protection)
3. Calculate HMAC-SHA256 of "ts:rawBody" using secret
4. Compare calculated HMAC with header HMAC (timing-safe comparison)
```

### Webhook Payload Example

```json
{
  "event_type": "subscription.activated",
  "event_id": "evt_123abc",
  "occurred_at": "2026-06-15T10:30:00Z",
  "data": {
    "id": "sub_paddle_123",
    "customer_id": "cust_paddle_456",
    "status": "active",
    "billing_cycle": {
      "interval": "month",
      "frequency": 1
    },
    "items": [
      {
        "price": {
          "id": "pri_abc123def",
          "name": "Pro - Monthly",
          "type": "recurring"
        },
        "quantity": 1
      }
    ],
    "current_billing_period": {
      "starts_at": "2026-06-15T00:00:00Z",
      "ends_at": "2026-07-15T00:00:00Z"
    },
    "next_billed_at": "2026-07-15T00:00:00Z",
    "custom_data": {
      "userId": "user_id_123"
    }
  }
}
```

---

## Workflow Diagrams

### User Registration to Active Subscription

```
┌─────────────────────────────────────────────────────────────────────┐
│                    New User Registration                             │
│                                                                       │
│  1. User signs up with email/password                               │
│  2. Trigger trial eligibility check (isTrialEligible)              │
│  3. Get or create Paddle customer (getOrCreatePaddleCustomer)      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │  Select Plan & Billing Cycle       │
        │  (Starter, Pro, or Premium)         │
        │  (Monthly or Annual)                │
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────▼──────────────────────────────────────┐
        │  Redirect to Paddle Checkout                           │
        │  Create checkout with trial price if eligible         │
        │  Include custom_data with userId                       │
        └──────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────▼──────────────────────────────────────┐
        │  Paddle Payment Process                                │
        │  ├─ No payment for trial                               │
        │  └─ Payment processed (or trial confirmed)             │
        └──────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────▼──────────────────────────────────────┐
        │  Paddle Sends Webhook Event                            │
        │  "subscription.trialing" (for new trials)             │
        │  or "subscription.activated" (for paid)               │
        └──────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────▼──────────────────────────────────────┐
        │  Backend Processing                                    │
        │  ├─ Verify webhook signature                           │
        │  ├─ Create/update Subscription record                  │
        │  ├─ Set status to "trialing" or "active"              │
        │  ├─ Set trial/billing dates                            │
        │  ├─ Link user to subscription                          │
        │  └─ Send confirmation/welcome email                    │
        └──────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────▼──────────────────────────────────────┐
        │  User Access Granted                                   │
        │  ├─ Full plan features unlocked                        │
        │  ├─ Can upload images                                  │
        │  ├─ Can view search results                            │
        │  └─ Can generate reports (if tier allows)             │
        └──────────────────────────────────────────────────────────┘
```

### Trial Period Management

```
┌──────────────────────────────────────────────────────────────┐
│              Trial Period: 14 Days                            │
│                                                               │
│  Status: "trialing"                                          │
│  trialEndDate: Current Date + 14 Days                        │
└──────────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
    ┌─────────▼─────────┐  ┌─────────▼─────────┐
    │  Day 7-10         │  │  Day 14           │
    │                   │  │                   │
    │  Trial Reminder   │  │  Trial Ending     │
    │  Worker Runs      │  │  Auto-Convert     │
    │  Send reminder    │  │  Charge payment   │
    │  email to user    │  │                   │
    └───────────────────┘  └─────────┬─────────┘
                                     │
                         ┌───────────┴───────────┐
                         │                       │
              ┌──────────▼──────────┐ ┌──────────▼──────────┐
              │  Payment Succeeds   │ │  Payment Fails      │
              │                     │ │                     │
              │  Status: "active"   │ │  Status: "past_due" │
              │  Set billing dates  │ │  Send retry notice  │
              │  Send confirmation  │ │  Auto-retry 10 times│
              │                     │ │  Over 3 days        │
              └─────────────────────┘ └─────────────────────┘
```

### Auto-Renewal Process

```
┌────────────────────────────────────────────────────────────┐
│         Active Subscription (Monthly)                      │
│                                                            │
│  Status: "active"                                         │
│  Current Period End: June 15, 2026                        │
│  Next Billing Date: June 15, 2026                         │
└────────────────────────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
    ┌───────▼──────────┐   ┌────────▼─────────┐
    │  June 12         │   │  June 15         │
    │  (3 Days Before) │   │  (Renewal Date)  │
    │                  │   │                  │
    │  Auto-Renewal    │   │  Paddle Charges  │
    │  Reminder Worker │   │  Payment Method  │
    │  Sends email     │   │                  │
    │  with amount     │   │                  │
    │  and date        │   │                  │
    └──────────────────┘   └────────┬─────────┘
                                    │
                        ┌───────────┴───────────┐
                        │                       │
              ┌─────────▼─────────┐   ┌────────▼─────────┐
              │  Payment Success  │   │ Payment Failed   │
              │                   │   │                  │
              │  Webhook:         │   │ Webhook:         │
              │  subscription.    │   │ subscription.    │
              │  updated          │   │ past_due         │
              │                   │   │                  │
              │  Status: "active" │   │ Status: "past_due"
              │  Period extended  │   │ Auto-retry (10x) │
              │  to July 15       │   │                  │
              └───────────────────┘   └──────────────────┘
```

---

## Configuration

### Required Environment Variables

```bash
# Paddle Environment
PADDLE_ENVIRONMENT=sandbox|production
PADDLE_API_KEY=your-paddle-api-key
PADDLE_WEBHOOK_SECRET=your-webhook-secret

# Plan Price IDs (from Paddle dashboard)
PADDLE_STARTER_MONTHLY_PRICE_ID=pri_...
PADDLE_STARTER_ANNUAL_PRICE_ID=pri_...
PADDLE_STARTER_TRIAL_PRICE_ID=pri_...

PADDLE_PRO_MONTHLY_PRICE_ID=pri_...
PADDLE_PRO_ANNUAL_PRICE_ID=pri_...
PADDLE_PRO_TRIAL_PRICE_ID=pri_...

PADDLE_PREMIUM_MONTHLY_PRICE_ID=pri_...
PADDLE_PREMIUM_ANNUAL_PRICE_ID=pri_...
PADDLE_PREMIUM_TRIAL_PRICE_ID=pri_...

# Trial Configuration (days)
TRIAL_DAYS_DEFAULT=14
TRIAL_DAYS_STARTER=14
TRIAL_DAYS_PRO=14
TRIAL_DAYS_PREMIUM=14

# Result View Limits
STARTER_RESULT_VIEW_LIMIT=1000
PRO_RESULT_VIEW_LIMIT=5000
PREMIUM_RESULT_VIEW_LIMIT=0  # 0 = unlimited

# Webhook Debug (optional)
PADDLE_WEBHOOK_DEBUG_IGNORED=false

# Database
MONGO_URI=mongodb+srv://...
```

---

## Background Workers

### Trial Expiry Worker

**File:** `modules/billing/trial-expiry.worker.ts`  
**Frequency:** Runs at server startup and periodically  
**Function:** Check for expired trial subscriptions

**Logic:**
```
FOR each subscription with status = 'trialing' AND trialEndDate < now:
  1. Update subscription status to 'cancelled'
  2. Update subscription cancelDate to now
  3. Send expiry notification email (if available)
  4. Log expiry event
```

**Trigger Points:**
- Server startup (immediate check)
- Scheduled interval (hourly check)

---

### Auto-Renewal Reminder Worker

**File:** `modules/billing/auto-renew-reminder.worker.ts`  
**Frequency:** Daily at configurable time  
**Function:** Send reminders before subscription renewal

**Logic:**
```
FOR each subscription with autoRenew = true:
  IF nextBillingDate is within 3 days AND not already reminded:
    1. Calculate days until renewal
    2. Send renewal reminder email with:
       - Renewal amount
       - Renewal date
       - Ability to pause/cancel
    3. Track reminder in autoRenewReminderStages
```

**Reminder Content:**
- Amount to be charged
- Renewal date
- Link to billing portal
- Option to pause/cancel

---

### Trial Reminder Worker

**File:** `modules/billing/trial-reminder.worker.ts`  
**Frequency:** Periodic (configurable)  
**Function:** Warn users about ending trials

**Logic:**
```
FOR each subscription with status = 'trialing':
  IF trialEndDate is within 7 days AND not already reminded:
    1. Calculate days until trial ends
    2. Send trial ending warning with:
       - Days remaining
       - Plan features they'll lose
       - Upgrade options
       - Payment method requirement
    3. Track reminder in trialReminderStages
```

**Reminder Stages:**
- 7 days before expiry
- 3 days before expiry  
- 1 day before expiry

---

### Weekly Rescan Worker

**File:** `modules/notifications/weekly-rescan.worker.ts`  
**Frequency:** Weekly (configurable day/time)  
**Function:** Rescan active monitors for new image matches

**Logic:**
```
FOR each monitor with status = 'active':
  1. Retrieve original search image
  2. Run Google Vision API for new matches
  3. Compare with previous results
  4. IF new matches found:
     a. Create new Result records
     b. Send notification to user
     c. Update monitor lastScannedDate
```

---

## Summary

The IpHint billing system is a comprehensive subscription management platform built around Paddle, featuring:

✅ **Three tiered plans** with different feature sets  
✅ **Flexible billing cycles** (monthly or annual)  
✅ **Trial period management** with automatic conversion  
✅ **Paddle webhook integration** for real-time updates  
✅ **Automatic renewals** with payment retry logic  
✅ **Plan upgrades/downgrades** with proration  
✅ **Subscription management** (pause, resume, cancel)  
✅ **Background workers** for reminders and expiry management  
✅ **Comprehensive audit trail** of all transactions  
✅ **Secure payment processing** with signature verification

---

*For latest API documentation, refer to the source code in `/src/modules/billing/`*
