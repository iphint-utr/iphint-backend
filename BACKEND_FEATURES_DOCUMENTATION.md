# IpHint Backend - Technical Documentation

**Project**: IpHint - Image Usage Detection Platform  
**Version**: 1.0.0  
**Description**: A comprehensive backend service for detecting image usage across the web, managing subscriptions, generating reports, and providing user analytics.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Technology Stack](#technology-stack)
3. [Core Features](#core-features)
4. [Module Overview](#module-overview)
5. [API Endpoints](#api-endpoints)
6. [Database Models](#database-models)
7. [Authentication & Authorization](#authentication--authorization)
8. [Background Workers](#background-workers)
9. [Deployment & Configuration](#deployment--configuration)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────┐
│           Express.js Application            │
├─────────────────────────────────────────────┤
│   Middlewares (Auth, Admin, Rate Limit)    │
├─────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐   │
│  │     Route Handlers & Controllers    │   │
│  ├─────────────────────────────────────┤   │
│  │ • Auth Module                       │   │
│  │ • Image Search Module               │   │
│  │ • Billing & Subscription Module     │   │
│  │ • Admin Analytics Module            │   │
│  │ • PDF Reports Module                │   │
│  │ • OCR Module                        │   │
│  │ • Referral & Rewards Module         │   │
│  │ • User Details Module               │   │
│  │ • Contact Module                    │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐   │
│  │   Background Workers & Services     │   │
│  ├─────────────────────────────────────┤   │
│  │ • Trial Expiry Worker               │   │
│  │ • Auto-Renewal Reminder Worker      │   │
│  │ • Trial Reminder Worker             │   │
│  │ • Weekly Rescan Worker              │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐   │
│  │   External Services                 │   │
│  ├─────────────────────────────────────┤   │
│  │ • Google Vision API (Image Search)  │   │
│  │ • Google Cloud OCR                  │   │
│  │ • Paddle Payment Gateway            │   │
│  │ • Resend Email Service              │   │
│  │ • Cloudinary CDN                    │   │
│  │ • SerpAPI (Search Indexing)         │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│       MongoDB Database (Mongoose ORM)      │
└─────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend Framework & Runtime
- **Node.js** with TypeScript
- **Express.js** v5.2.1 - Web application framework
- **Mongoose** v9.1.6 - MongoDB ODM for data modeling

### Authentication & Security
- **JWT (jsonwebtoken)** v9.0.3 - Token-based authentication
- **Passport.js** v0.7.0 - Authentication middleware
- **passport-google-oauth20** v2.0.0 - Google OAuth integration
- **bcryptjs** v3.0.3 - Password hashing and encryption
- **helmet** v8.1.0 - Security headers middleware
- **cors** v2.8.6 - Cross-origin request handling
- **express-rate-limit** v8.3.2 - Request rate limiting

### Data Validation & Serialization
- **express-validator** v7.3.2 - Input validation middleware
- **zod** v4.3.6 - Schema validation library

### External Service Integrations
- **@google-cloud/vision** v4.3.3 - Image recognition and OCR
- **googleapis** v173.0.0 - Google APIs client
- **axios** v1.15.0 - HTTP client for API calls
- **resend** v6.12.4 - Email delivery service
- **cloudinary** v2.9.0 - Image hosting and CDN

### File Processing & Generation
- **multer** v2.1.1 - File upload middleware
- **pdfkit** v0.18.0 - PDF document generation
- **puppeteer** v24.40.0 - Headless browser automation
- **form-data** v4.0.5 - FormData builder for requests

### Logging & Monitoring
- **morgan** v1.10.1 - HTTP request logger
- **dotenv** v17.2.3 - Environment variable management

### Development Tools
- **ts-node** v10.9.2 - TypeScript execution for Node.js
- **nodemon** v3.1.14 - File watcher for development
- **ts-node-dev** - TypeScript development with respawn

---

## Core Features

### 1. **Image Search & Detection**
   - **Google Vision API Integration**: Detect where images are used across the web
   - **Exact Match Detection**: Find exact duplicates of uploaded images
   - **Partial Match Detection**: Identify similar but not identical images
   - **Web Pages Detection**: Discover pages containing the image
   - **Plan-Based Access Tiers**:
     - Starter: Limited preview results
     - Pro/Premium: Full URL and page source results

### 2. **User Authentication & Management**
   - **Email/Password Registration**: Secure user account creation with validation
   - **Email Verification**: Token-based email verification system
   - **Google OAuth Integration**: Single sign-on with Google accounts
   - **JWT Token Management**: 30-day token expiration (configurable)
   - **Password Security**: 
     - Minimum 8 characters, maximum 128 characters
     - Required: lowercase, uppercase, digits, special characters
   - **User Profile Management**: Update user details, preferences

### 3. **Subscription & Billing Management**
   - **Paddle Payment Gateway Integration**: Handle recurring payments
   - **Multiple Plan Tiers**:
     - **Starter**: Free tier with limited features
     - **Pro**: Mid-tier with advanced features
     - **Premium**: Full-featured tier with all capabilities
   - **Trial Period Management**: Configurable trial durations
   - **Subscription Status Tracking**: Active, trialing, paused, cancelled, past_due
   - **Automatic Renewal**: Recurring billing cycles
   - **Plan Synchronization**: Dynamic plan catalog from environment configuration

### 4. **Admin Dashboard & Analytics**
   - **Real-time Dashboard Statistics**:
     - Total content analyzed
     - Content under analysis vs. complete
     - Member count and active subscriptions
     - Daily search volume
     - Monthly revenue metrics
     - Recent activity feed
   - **User Management**: List, search, filter, paginate users
   - **Search Analytics**: Track and analyze user searches
   - **Revenue Analytics**: Monitor payment and subscription metrics
   - **Admin Role Authorization**: Restrict endpoints to admin users only

### 5. **PDF Report Generation**
   - **Automated PDF Creation**: Generate search result reports in PDF format
   - **Report Customization**: Include images, metadata, and findings
   - **Email Delivery**: Send reports directly to users
   - **Plan-Based Access**: PDF feature only available in Pro/Premium plans
   - **Secure Storage**: Generated PDFs stored securely

### 6. **Referral & Rewards System**
   - **Unique Referral Codes**: Each user gets a unique referral code
   - **Referral Tracking**: Track successful referrals per user
   - **Milestone Rewards**: 
     - Unlock permanent PDF access after 5 successful referrals
     - Login Pro Access rewards
     - Free Premium Month rewards
   - **Reward Management**: Configurable reward thresholds
   - **Referral Event Completion**: Track referral completion status

### 7. **OCR (Optical Character Recognition)**
   - **Google Cloud Vision OCR**: Extract text from images and PDFs
   - **Multi-format Support**: Process images and PDF documents
   - **Page-by-Page Processing**: Handle multi-page PDFs
   - **Text Extraction**: Accurate text recognition from document images
   - **Error Handling**: Graceful handling of unreadable documents

### 8. **Email Communication**
   - **Resend Email Service**: Reliable email delivery
   - **Email Templates**: HTML and plain text email support
   - **Email Verification**: Verification links with expiration
   - **Report Delivery**: Automated report sending
   - **Notification System**: Trial expiry, renewal reminders

### 9. **Rate Limiting & Security**
   - **IP-Based Rate Limiting**: Prevent abuse through request throttling
   - **Helmet Security Headers**: Protect against common vulnerabilities
   - **CORS Management**: Configurable allowed origins
   - **Request Validation**: Input validation on all endpoints
   - **Error Handling**: Standardized error responses

### 10. **Background Job Processing**
   - **Trial Expiry Worker**: Check and mark expired trials
   - **Auto-Renewal Reminder**: Send reminders before subscription renewal
   - **Trial Reminder Worker**: Notify users about ending trials
   - **Weekly Rescan Worker**: Periodic image rescans for monitoring

---

## Module Overview

### 1. **Auth Module** (`/src/controllers/auth.controller.ts`)
**Responsibilities**: User registration, login, verification, OAuth integration

**Key Functions**:
- `register()` - Create new user account
- `login()` - Authenticate user with credentials
- `verifyEmail()` - Verify email with token
- `googleAuth()` - Google OAuth callback
- `refreshToken()` - Issue new JWT token

**Features**:
- Email validation
- Password strength validation
- Referral code generation
- Automatic trial activation
- Free Premium Month granting

---

### 2. **Image Search Module** (`/src/modules/image-search/`)
**Responsibilities**: Image upload, detection, and results retrieval

**Files**:
- `image-search.controller.ts` - Request handling
- `image-search.service.ts` - Google Vision integration
- `image-search.routes.ts` - Route definitions
- `image-search.types.ts` - TypeScript interfaces

**Key Functions**:
- `uploadImage()` - Accept and validate image upload
- `detectExactMatches()` - Find exact image matches
- `getSearchResults()` - Retrieve paginated results

**Features**:
- Plan-based result filtering
- Exact and partial match detection
- Web page source discovery
- Result caching

---

### 3. **Billing Module** (`/src/modules/billing/`)
**Responsibilities**: Subscription management, payment processing, plan management

**Files**:
- `billing.controller.ts` - Billing operations
- `billing.routes.ts` - API routes
- `billing.constants.ts` - Plan definitions
- `plan-catalog.service.ts` - Plan synchronization
- `auto-renew-reminder.worker.ts` - Renewal notifications
- `trial-expiry.worker.ts` - Trial expiration
- `trial-reminder.worker.ts` - Trial warnings

**Key Functions**:
- `createSubscription()` - Start new subscription
- `updateSubscription()` - Modify subscription
- `cancelSubscription()` - End subscription
- `syncPlanCatalog()` - Update plan catalog from Paddle
- `handlePaddleWebhook()` - Process payment events

**Features**:
- Paddle payment gateway integration
- Multiple subscription statuses
- Automatic webhook handling
- Plan tier synchronization
- Trial period management

---

### 4. **Admin Module** (`/src/modules/admin/`)
**Responsibilities**: Administrative dashboard, user management, analytics

**Files**:
- `admin.controller.ts` - Admin operations
- `admin.routes.ts` - Route definitions
- `admin.types.ts` - TypeScript interfaces
- `admin-analytics.service.ts` - Analytics logic

**Key Functions**:
- `getDashboard()` - Dashboard statistics
- `getUsers()` - List users with pagination
- `getUserDetails()` - Get specific user info
- `getSearches()` - List recent searches
- `getAnalytics()` - Platform analytics

**Features**:
- Real-time dashboard metrics
- User search and filtering
- Revenue tracking
- Activity feed
- Admin-only authorization

---

### 5. **PDF Reports Module** (`/src/modules/pdf/`)
**Responsibilities**: PDF generation, report creation, email delivery

**Files**:
- `reports.controller.ts` - Report requests
- `reports.service.ts` - PDF generation
- `email.service.ts` - Email sending
- `reports.routes.ts` - Route definitions

**Key Functions**:
- `handlePdfGeneration()` - Create PDF report
- `generateSearchPdf()` - Generate PDF file
- `sendReportEmail()` - Email report to user

**Features**:
- Dynamic PDF generation
- Automated email delivery
- Plan-based access control
- Report customization

---

### 6. **Referral Module** (`/src/modules/referral/`)
**Responsibilities**: Referral tracking, rewards, milestone management

**Files**:
- `referral.controller.ts` - Referral operations
- `referral.routes.ts` - Route definitions

**Key Functions**:
- `generateReferralCode()` - Get user referral code
- `getReferralStatus()` - Check referral progress
- `completeReferralEvent()` - Mark referral complete
- `grantLoginProAccess()` - Award Pro access
- `grantFreeMonthPremium()` - Award Premium month

**Features**:
- Unique referral codes
- Milestone tracking (5 referrals)
- Automatic reward granting
- Permanent PDF access unlocking

---

### 7. **OCR Module** (`/src/modules/ocr/`)
**Responsibilities**: Text extraction from images and PDFs

**Files**:
- `ocr.service.ts` - Google Vision OCR
- `ocr.controller.ts` - Request handling
- `ocr.routes.ts` - Route definitions
- `ocr.middleware.ts` - File upload validation

**Key Functions**:
- `extractText()` - Extract text from image/PDF
- `handleOcrRequest()` - Process OCR request

**Features**:
- Multi-format support (PDF, JPEG, PNG)
- Page-by-page PDF processing
- Accurate text recognition
- Error handling for unreadable documents

---

### 8. **User Details Module** (`/src/modules/user-details/`)
**Responsibilities**: User profile information management

**Files**:
- `user-details.controller.ts` - Profile operations
- `user-details.routes.ts` - Route definitions
- `details.helper.ts` - Utility functions

**Key Functions**:
- `getUserProfile()` - Retrieve user profile
- `updateUserProfile()` - Update profile information

**Features**:
- Profile data management
- User preferences storage

---

### 9. **Rewards Module** (`/src/modules/rewards/`)
**Responsibilities**: Reward configuration and management

**Files**:
- `rewards.controller.ts` - Reward operations
- `rewards.routes.ts` - Route definitions

**Key Functions**:
- `getActiveRewards()` - List available rewards
- `getUserRewards()` - Get user's earned rewards

**Features**:
- Configurable reward thresholds
- Active/inactive reward management
- User reward tracking

---

### 10. **Contact Module** (`/src/modules/contact/`)
**Responsibilities**: Contact form submission and inquiry handling

**Files**:
- `contact.controller.ts` - Contact operations
- `contact.routes.ts` - Route definitions

**Key Functions**:
- `submitContactForm()` - Accept contact inquiry

**Features**:
- Contact form validation
- Message delivery

---

### 11. **Additional Image Search Modules**
**Other specialized image search implementations**:
- `image-search-2/yandex.service.ts` - Yandex image search integration
- `image-serp/` - SerpAPI integration for search indexing
- `yandex-search/` - Advanced Yandex search implementation
- `yandex-search2/` - Secondary Yandex search module

---

## API Endpoints

### Base URL
```
/api/v1
```

### Authentication Endpoints (`/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Register new user |
| `POST` | `/auth/login` | Authenticate user |
| `POST` | `/auth/verify-email` | Verify email with token |
| `GET` | `/auth/google` | Google OAuth redirect |
| `GET` | `/auth/google/callback` | Google OAuth callback |
| `POST` | `/auth/refresh-token` | Request new JWT token |

### Image Search Endpoints (`/image-search`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/image-search/upload` | Upload image for search |
| `GET` | `/image-search/:searchId` | Get search results |
| `GET` | `/image-search/:searchId/results` | Get paginated results |
| `DELETE` | `/image-search/:searchId` | Delete search record |

### Billing Endpoints (`/billing`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/billing/create-subscription` | Create new subscription |
| `GET` | `/billing/subscription` | Get user subscription |
| `PUT` | `/billing/subscription` | Update subscription |
| `DELETE` | `/billing/subscription` | Cancel subscription |
| `GET` | `/billing/plans` | List available plans |
| `POST` | `/webhooks/paddle` | Paddle webhook handler |

### Admin Endpoints (`/admin`) *Admin only*

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/dashboard` | Dashboard statistics |
| `GET` | `/admin/users` | List users with pagination |
| `GET` | `/admin/users/:userId` | Get user details |
| `GET` | `/admin/searches` | List searches |
| `GET` | `/admin/analytics` | Platform analytics |

### PDF Report Endpoints (`/pdf`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/pdf/generate` | Generate PDF report |
| `GET` | `/pdf/:reportId` | Download PDF report |
| `POST` | `/pdf/send-email` | Email report to user |

### Referral Endpoints (`/referral`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/referral/generate` | Get referral code |
| `GET` | `/referral/status` | Get referral status |
| `POST` | `/referral/apply` | Apply referral code |

### OCR Endpoints (`/ocr`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/ocr/extract` | Extract text from image/PDF |
| `GET` | `/ocr/status/:jobId` | Get OCR job status |

### User Details Endpoints (`/user-details`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/user-details/profile` | Get user profile |
| `PUT` | `/user-details/profile` | Update profile |

### Rewards Endpoints (`/rewards`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/rewards` | List active rewards |
| `GET` | `/rewards/user` | Get user rewards |

### Contact Endpoints (`/contact`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/contact/submit` | Submit contact form |

---

## Database Models

### 1. **User Model** (`users.ts`)
```typescript
{
  _id: ObjectId
  name: string
  email: string (unique, lowercase)
  password: string (hashed with bcrypt)
  phone: string (optional)
  avatar: string (URL, optional)
  role: 'general' | 'admin'
  googleId: string (optional, for OAuth)
  emailVerified: boolean
  emailVerificationToken: string (optional)
  referralCode: string (unique)
  referralCount: number
  permanentPdfAccess: boolean
  joiningDate: Date
  searchHistory: [Search._id]
  createdAt: Date
  updatedAt: Date
}
```

### 2. **Subscription Model** (`subscriptions.ts`)
```typescript
{
  _id: ObjectId
  userId: User._id
  planId: Plan._id
  paddleSubscriptionId: string (unique)
  billingCycle: 'monthly' | 'yearly'
  status: 'active' | 'trialing' | 'paused' | 'past_due' | 'cancelled'
  trialStartDate: Date
  trialEndDate: Date
  startDate: Date
  renewalDate: Date
  currentBillingPeriodStart: Date
  currentBillingPeriodEnd: Date
  autoRenew: boolean
  createdAt: Date
  updatedAt: Date
}
```

### 3. **Plan Model** (`plan.ts`)
```typescript
{
  _id: ObjectId
  tier: 'starter' | 'pro' | 'premium'
  paddlePriceId: string
  monthlyPrice: number
  yearlyPrice: number
  credits: number
  features: {
    imageSearch: boolean
    exactMatches: boolean
    partialMatches: boolean
    webPages: boolean
    pdfReports: boolean
    emailReports: boolean
    customAlerts: boolean
    prioritySupport: boolean
  }
  createdAt: Date
  updatedAt: Date
}
```

### 4. **Search Model** (`searches.ts`)
```typescript
{
  _id: ObjectId
  userId: User._id
  imageUrl: string
  fileName: string
  fileSize: number
  mimeType: string
  uploadDate: Date
  status: 'processing' | 'completed' | 'failed'
  resultsCount: number
  exactMatches: number
  partialMatches: number
  pages: number
  date: Date
  createdAt: Date
  updatedAt: Date
}
```

### 5. **Result Model** (`results.ts`)
```typescript
{
  _id: ObjectId
  searchId: Search._id
  sourceUrl: string
  pageTitle: string
  matchType: 'exact' | 'partial'
  score: number
  foundDate: Date
  createdAt: Date
}
```

### 6. **Payment Model** (`payment.ts`)
```typescript
{
  _id: ObjectId
  userId: User._id
  paddleTransactionId: string (unique)
  amount: number
  currency: string
  status: 'completed' | 'failed' | 'pending'
  paymentMethod: string
  subscriptionId: Subscription._id (optional)
  description: string
  createdAt: Date
  updatedAt: Date
}
```

### 7. **Referral Event Model** (`referral-event.ts`)
```typescript
{
  _id: ObjectId
  referrerId: User._id
  referredUserId: User._id
  isCompleted: boolean
  completedAt: Date (optional)
  createdAt: Date
}
```

### 8. **Reward Model** (`rewards.ts`)
```typescript
{
  _id: ObjectId
  slug: string (unique)
  title: string
  description: string
  rewardType: 'pdf_access' | 'pro_access' | 'premium_month' | 'credits'
  referralsRequired: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
```

### 9. **Pending Registration Model** (`pending-registrations.ts`)
```typescript
{
  _id: ObjectId
  email: string
  verificationToken: string
  expiresAt: Date
  createdAt: Date
}
```

### 10. **Alert Model** (`alerts.ts`)
```typescript
{
  _id: ObjectId
  userId: User._id
  searchId: Search._id
  alertType: 'exact_match' | 'similar_match' | 'scheduled'
  triggerCondition: string
  isActive: boolean
  createdAt: Date
}
```

### 11. **Monitor Model** (`monitors.ts`)
```typescript
{
  _id: ObjectId
  userId: User._id
  imageUrl: string
  monitoringStatus: 'active' | 'paused' | 'completed'
  lastScannedDate: Date
  createdAt: Date
}
```

### 12. **Folder Model** (`folders.ts`)
```typescript
{
  _id: ObjectId
  userId: User._id
  name: string
  description: string
  searches: [Search._id]
  createdAt: Date
}
```

---

## Authentication & Authorization

### JWT Token Structure
```typescript
{
  id: string (userId)
  iat: number (issued at)
  exp: number (expiration - 30 days default)
}
```

### Token Expiration
- Default: 30 days (configurable via `JWT_EXPIRES_IN`)
- Refresh: Users can request new token via `/auth/refresh-token`

### Authorization Levels

#### 1. **Public Routes**
- `/auth/register`
- `/auth/login`
- `/auth/verify-email`
- `/auth/google/*`
- `/` (health check)

#### 2. **Authenticated Routes** (Requires valid JWT)
- Image search endpoints
- User profile endpoints
- Billing endpoints
- Referral endpoints

#### 3. **Admin Routes** (Requires admin role + JWT)
- `/admin/dashboard`
- `/admin/users`
- `/admin/searches`
- `/admin/analytics`

### Middleware Stack
1. **helmet()** - Security headers
2. **cors()** - CORS handling
3. **morgan()** - Request logging
4. **rateLimit()** - Request throttling
5. **authMiddleware** - JWT verification (on protected routes)
6. **isAdminMiddleware** - Admin role verification (on admin routes)

---

## Background Workers

### 1. **Trial Expiry Worker** (`billing/trial-expiry.worker.ts`)
**Frequency**: Runs at startup and periodically  
**Function**: Checks for expired trial subscriptions and marks them as cancelled

**Logic**:
```
FOR each subscription with status = 'trialing' AND trialEndDate < now:
  - Mark subscription status as 'cancelled'
  - Send expiry notification
```

### 2. **Auto-Renewal Reminder Worker** (`billing/auto-renew-reminder.worker.ts`)
**Frequency**: Daily at configured time  
**Function**: Sends reminder emails before subscription renewal

**Logic**:
```
FOR each subscription with autoRenew = true AND renewalDate within 3 days:
  - Send renewal reminder email
  - Include renewal amount and date
```

### 3. **Trial Reminder Worker** (`billing/trial-reminder.worker.ts`)
**Frequency**: Periodic (configurable)  
**Function**: Warns users about ending trial periods

**Logic**:
```
FOR each subscription with status = 'trialing' AND trialEndDate within 7 days:
  - Send trial ending warning
  - Include upgrade options
```

### 4. **Weekly Rescan Worker** (`notifications/weekly-rescan.worker.ts`)
**Frequency**: Weekly at configured time  
**Function**: Rescans active monitors for new image matches

**Logic**:
```
FOR each monitor with status = 'active':
  - Rescan image with Google Vision API
  - Compare with previous results
  - Send notification if new matches found
```

---

## Environment Configuration

### Required Environment Variables

```bash
# Server Configuration
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://frontend-url.com

# Database
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/database

# Authentication
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=30d

# Google Services
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
GOOGLE_VISION_PROJECT_ID=your-project-id

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Email Service (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxxx

# Payment Gateway (Paddle)
PADDLE_ENVIRONMENT=sandbox|production
PADDLE_API_KEY=your-paddle-api-key
PADDLE_WEBHOOK_SECRET=your-webhook-secret

# Cloudinary (Image CDN)
CLOUDINARY_NAME=your-cloudinary-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# CORS
ALLOWED_ORIGINS=https://frontend1.com,https://frontend2.com

# Plan Configuration
PLAN_STARTER_CREDITS=10
PLAN_PRO_MONTHLY_PRICE=29.99
PLAN_PREMIUM_MONTHLY_PRICE=79.99
```

### Environment-Specific Configurations

**Development**:
```
NODE_ENV=development
PADDLE_ENVIRONMENT=sandbox
ALLOWED_ORIGINS=http://localhost:3000
```

**Production**:
```
NODE_ENV=production
PADDLE_ENVIRONMENT=production
ALLOWED_ORIGINS=https://app.iphint.com
```

---

## Deployment & Configuration

### Docker Support
The application can be containerized using:
- Docker (Node.js 18+ LTS)
- docker-compose for local development

### Build & Run Commands

**Development**:
```bash
npm run dev
```
Runs with ts-node-dev for automatic restart on file changes

**Production Build**:
```bash
npm run build
```
Compiles TypeScript to JavaScript in `dist/` folder

**Production Run**:
```bash
npm start
```
Runs compiled JavaScript from `dist/server.js`

### Server Startup Process

1. **MongoDB Connection**: Connects to MongoDB Atlas
2. **Database Initialization**: Ensures indexes exist on payment collection
3. **Plan Catalog Sync**: Syncs plan definitions from environment variables with Paddle
4. **Background Workers Started**:
   - Trial expiry checker
   - Auto-renewal reminder
   - Trial reminder
   - Weekly rescan monitor
5. **Express Server Start**: Server listens on configured PORT

### Error Handling

Global error handler middleware catches:
- Validation errors (400)
- Authentication errors (401)
- Authorization errors (403)
- Not found errors (404)
- Server errors (500)

**Error Response Format**:
```json
{
  "success": false,
  "message": "Error description",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

### Request Logging
All HTTP requests logged via Morgan middleware with format:
```
[timestamp] method url status response-time
```

---

## Performance Considerations

### 1. **Database Indexing**
- User: `email` (unique)
- Subscription: `userId`, `status`
- Payment: `paddleTransactionId` (unique), `userId`
- Search: `userId`, `date`
- Referral Event: `referrerId`, `referredUserId`

### 2. **Rate Limiting**
- IP-based limiting configured globally
- Trust proxy enabled for reverse proxies (Render, Cloud platforms)

### 3. **Caching Strategies**
- JWT token validation cached per request
- Plan catalog cached in memory after sync
- User subscription cached during request lifecycle

### 4. **Async Operations**
- Parallel database queries using `Promise.all()`
- Non-blocking worker processes
- Async middleware execution

---

## Security Best Practices

1. **Password Security**: 
   - Bcryptjs hashing with salt rounds
   - Minimum 8 characters, maximum 128 characters
   - Required: lowercase, uppercase, digits, special characters

2. **JWT Security**:
   - Signed with secret key
   - Configurable expiration
   - HTTP-only cookie support option

3. **Input Validation**:
   - express-validator on all inputs
   - Zod schema validation
   - Email format validation
   - Phone number format validation

4. **API Security**:
   - CORS restricted to allowed origins
   - Helmet security headers
   - Rate limiting per IP
   - HTTPS enforcement in production

5. **Data Protection**:
   - Sensitive data excluded from responses
   - Admin endpoints strictly protected
   - User data isolation per account

---

## Scalability & Future Enhancements

### Current Limitations
- Single-instance worker processes
- In-memory caching (no Redis)
- Synchronous payment webhook processing

### Recommended Enhancements
1. **Redis Integration**: Distributed caching and session management
2. **Message Queue**: Use Bull/RabbitMQ for async job processing
3. **Horizontal Scaling**: Load balancer for multiple server instances
4. **CDN**: Cloudfront/Cloudflare for static assets
5. **Database Replication**: MongoDB replication set for high availability
6. **Monitoring**: Datadog/New Relic for performance tracking
7. **API Versioning**: Implement versioning strategy for backward compatibility

---

## Troubleshooting

### Common Issues

**1. MongoDB Connection Failed**
```
Error: connect ECONNREFUSED 127.0.0.1:27017
Solution: Verify MONGO_URI is correct, MongoDB service is running
```

**2. Google Vision API Errors**
```
Error: Permission denied on Google Cloud project
Solution: Verify credentials.json path, project ID, and service account permissions
```

**3. Payment Webhook Not Received**
```
Error: Paddle webhook signature verification failed
Solution: Verify PADDLE_WEBHOOK_SECRET matches Paddle dashboard
```

**4. Email Delivery Failed**
```
Error: Resend API key invalid
Solution: Verify RESEND_API_KEY is correct and account is active
```

---

## API Documentation References

- Google Vision API: https://cloud.google.com/vision/docs
- Paddle Payment: https://developer.paddle.com
- Resend Email: https://resend.com/docs
- Mongoose Documentation: https://mongoosejs.com/docs
- Express.js: https://expressjs.com

---

## Contact & Support

**Project Repository**: iphint-backend  
**Owner**: iphint-utr  
**Current Version**: 1.0.0  
**Last Updated**: 2026-06-15

---

*This documentation is generated as a comprehensive technical overview of the IpHint backend system. For latest updates, refer to the source code and inline documentation.*
