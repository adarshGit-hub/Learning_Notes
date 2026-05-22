# Shopify API Guide

A reference for Shopify's Admin, Storefront, and Bulk APIs — covering synchronous calls, async patterns, rate limits, and when to use each.

---

## Table of Contents

1. [APIs Overview](#apis-overview)
2. [Synchronous Calls](#synchronous-calls)
   - [GraphQL Admin API](#graphql-admin-api)
   - [REST Admin API (Legacy)](#rest-admin-api-legacy)
   - [Storefront API](#storefront-api)
3. [Asynchronous Patterns](#asynchronous-patterns)
   - [Bulk Operations](#bulk-operations)
   - [Webhooks](#webhooks)
   - [Shopify Functions](#shopify-functions)
4. [Global Limits](#global-limits)
5. [Choosing Sync vs Async](#choosing-sync-vs-async)

---

## APIs Overview

| API | Type | Status | Use For |
|-----|------|--------|---------|
| GraphQL Admin API | GraphQL over HTTP | ✅ Recommended | All admin CRUD — products, orders, customers, metafields |
| REST Admin API | REST over HTTP | ⚠️ Legacy (Oct 2024) | Same domain as GraphQL; migrate to GraphQL for new work |
| Storefront API | GraphQL over HTTP | ✅ Active | Buyer-facing storefronts — products, collections, cart, checkout |
| Bulk Operations | Async (GraphQL-initiated) | ✅ Active | High-volume imports and exports |
| Webhooks | Event-driven (Shopify → you) | ✅ Active | Reacting to events without polling |

---

## Synchronous Calls

Standard request/response HTTP calls — you send a request, Shopify responds, you wait.

### GraphQL Admin API

**Docs:** [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql) · [Rate limits](https://shopify.dev/docs/api/usage/rate-limits#graphql-admin-api)

Use for queries (read) and mutations (write) on admin objects. Rate limiting is cost-based, not requests-per-second.

#### Rate Limits

Each app + store pair has a bucket of points that restores continuously:

| Plan | Points/sec | Restore Rate |
|------|-----------|--------------|
| Standard | 100 | 50/sec |
| Advanced Shopify | 200 | — |
| Shopify Plus | 1,000 | — |
| Commerce Components | 2,000 | — |

> **Hard cap:** A single query can never exceed **1,000 cost points**, regardless of plan. Input arrays are capped at **250 items** each.

#### Throttle Status in Responses

Every response includes throttle info in `extensions.cost` — use it to dynamically throttle your requests:

```json
"extensions": {
  "cost": {
    "requestedQueryCost": 101,
    "actualQueryCost": 46,
    "throttleStatus": {
      "maximumAvailable": 1000,
      "currentlyAvailable": 954,
      "restoreRate": 50
    }
  }
}
```

Use `currentlyAvailable` and `restoreRate` to implement exponential backoff or request queuing before hitting the limit.

---

### REST Admin API (Legacy)

**Docs:** [REST Admin API](https://shopify.dev/docs/api/admin-rest) · [Rate limits](https://shopify.dev/docs/api/usage/rate-limits#rest-admin-api)

Marked legacy as of October 1, 2024. New apps should use GraphQL. Uses a leaky bucket model based on requests per second.

#### Rate Limits

| Plan | Requests/sec | Bucket Size |
|------|-------------|-------------|
| Standard | 2 | 40 |
| Advanced Shopify | 4 | — |
| Shopify Plus | 20 | 400 |
| Commerce Components | 40 | — |

When the bucket is full, Shopify returns `429 Too Many Requests` with a `Retry-After` header. Respect the header before retrying.

---

### Storefront API

**Docs:** [Storefront API](https://shopify.dev/docs/api/storefront) · [Rate limits](https://shopify.dev/docs/api/usage/rate-limits#storefront-api)

Buyer-facing GraphQL API for storefronts. No fixed requests-per-minute limit for real buyer traffic.

Shopify does rate-limit bots and malicious traffic:

- `430 Shopify Security Rejection` for suspicious activity
- Higher limits are available for verified bots via [Web Bot Auth](https://shopify.dev/docs/api/storefront#authentication-web-bot-auth)

---

## Asynchronous Patterns

For large-volume work and event-driven flows, Shopify provides first-class async mechanisms.

### Bulk Operations

**Docs:** [Bulk Operations overview](https://shopify.dev/docs/api/usage/bulk-operations/overview) · [Bulk queries](https://shopify.dev/docs/api/usage/bulk-operations/queries) · [Bulk imports](https://shopify.dev/docs/api/usage/bulk-operations/imports)

Designed for high-volume reads and writes that would exceed normal query cost limits.

**How it works:**

1. Submit a bulk operation via a GraphQL mutation (this initial call is subject to normal cost limits)
2. Shopify processes it in the background asynchronously — no open HTTP connection
3. Poll the operation status until complete
4. Download the result file (for queries) or check completion status (for imports)

> **No cost caps on the operation itself:** Bulk operations don't share the single-query 1,000 point max or standard rate limits. Always use bulk for full catalog exports or mass imports.

**Use bulk operations for:**
- Exporting all products, orders, or customers
- Large catalog syncs or platform migrations
- Any write that would take your entire rate limit bucket for a single operation

---

### Webhooks

**Docs:** [Use webhooks](https://shopify.dev/docs/api/webhooks)

Shopify POSTs to your HTTPS endpoint when a subscribed event occurs (e.g. `orders/create`, `products/update`, `app/uninstalled`).

**Key rules:**

- Respond with `2xx` within a few seconds, or Shopify retries with backoff
- Webhook deliveries do **not** count against your outbound Admin API rate limits
- Any Shopify API calls you make *inside* a webhook handler do count against your limits

**Use webhooks for:**
- Keeping external systems in sync without polling
- Triggering async workflows in your own infrastructure
- Reacting to order, product, inventory, or app lifecycle events

---

### Shopify Functions

**Docs:** [Shopify Functions overview](https://shopify.dev/docs/apps/functions)

WebAssembly functions deployed via the Admin GraphQL API, invoked by Shopify at runtime (e.g. during checkout for discounts, shipping, or payment customizations).

From your app's perspective they're asynchronous — you deploy the function, and Shopify calls it when the relevant event occurs. You don't make a direct API call each time a buyer hits checkout.

Per-function runtime and resource limits are documented on the [Shopify Functions docs](https://shopify.dev/docs/apps/functions) per function type.

---

## Global Limits

These apply across all APIs, regardless of plan.

| Limit | Value | Notes |
|-------|-------|-------|
| Max items per input array | **250** | Applies to all APIs (Admin GraphQL, Storefront, Customer Account, etc.) |
| Max paginated objects | **25,000** | Beyond this, Shopify returns `25001` to signal "more than 25k exist" |
| New variants/day (stores with 50k+ variants) | **1,000** | Applies to `productCreate`, `productUpdate`, `productVariantCreate`; not applicable to Shopify Plus |

**Pagination beyond 25,000 objects:** Use filters to narrow result sets, or switch to [bulk operations](#bulk-operations) for full exports.

---

## Choosing Sync vs Async

| Use Case | Recommended Approach |
|----------|---------------------|
| Create or update a single record | Sync — GraphQL Admin API mutation |
| Fetch specific products, orders, or customers | Sync — GraphQL Admin API query |
| Export all products or all orders | Async — [Bulk operations](#bulk-operations) |
| Mass import / catalog sync | Async — [Bulk operations](#bulk-operations) |
| React to events (order placed, inventory changed) | Event-driven — [Webhooks](#webhooks) |
| Customize checkout, discounts, or shipping logic | [Shopify Functions](#shopify-functions) |

**Decision rule of thumb:**

- **Low to moderate volume + targeted** → synchronous GraphQL
- **Would hit the 1,000-point query cap or drain your bucket** → bulk operations
- **Need to react to something that happened** → webhooks

---

## Resources

- [Compare rate limits by API](https://shopify.dev/docs/api/usage/rate-limits)
- [GraphQL Admin API rate limits](https://shopify.dev/docs/api/usage/rate-limits#graphql-admin-api)
- [REST Admin API rate limits](https://shopify.dev/docs/api/usage/rate-limits#rest-admin-api)
- [Storefront API rate limits](https://shopify.dev/docs/api/usage/rate-limits#storefront-api)
- [Bulk operations with GraphQL Admin API](https://shopify.dev/docs/api/usage/bulk-operations/overview)
- [Use webhooks](https://shopify.dev/docs/api/webhooks)
- [Shopify Functions](https://shopify.dev/docs/apps/functions)# Shopify API Guide

A reference for Shopify's Admin, Storefront, and Bulk APIs — covering synchronous calls, async patterns, rate limits, and when to use each.

---

## Table of Contents

1. [APIs Overview](#apis-overview)
2. [Synchronous Calls](#synchronous-calls)
   - [GraphQL Admin API](#graphql-admin-api)
   - [REST Admin API (Legacy)](#rest-admin-api-legacy)
   - [Storefront API](#storefront-api)
3. [Asynchronous Patterns](#asynchronous-patterns)
   - [Bulk Operations](#bulk-operations)
   - [Webhooks](#webhooks)
   - [Shopify Functions](#shopify-functions)
4. [Global Limits](#global-limits)
5. [Choosing Sync vs Async](#choosing-sync-vs-async)

---

## APIs Overview

| API | Type | Status | Use For |
|-----|------|--------|---------|
| GraphQL Admin API | GraphQL over HTTP | ✅ Recommended | All admin CRUD — products, orders, customers, metafields |
| REST Admin API | REST over HTTP | ⚠️ Legacy (Oct 2024) | Same domain as GraphQL; migrate to GraphQL for new work |
| Storefront API | GraphQL over HTTP | ✅ Active | Buyer-facing storefronts — products, collections, cart, checkout |
| Bulk Operations | Async (GraphQL-initiated) | ✅ Active | High-volume imports and exports |
| Webhooks | Event-driven (Shopify → you) | ✅ Active | Reacting to events without polling |

---

## Synchronous Calls

Standard request/response HTTP calls — you send a request, Shopify responds, you wait.

### GraphQL Admin API

**Docs:** [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql) · [Rate limits](https://shopify.dev/docs/api/usage/rate-limits#graphql-admin-api)

Use for queries (read) and mutations (write) on admin objects. Rate limiting is cost-based, not requests-per-second.

#### Rate Limits

Each app + store pair has a bucket of points that restores continuously:

| Plan | Points/sec | Restore Rate |
|------|-----------|--------------|
| Standard | 100 | 50/sec |
| Advanced Shopify | 200 | — |
| Shopify Plus | 1,000 | — |
| Commerce Components | 2,000 | — |

> **Hard cap:** A single query can never exceed **1,000 cost points**, regardless of plan. Input arrays are capped at **250 items** each.

#### Throttle Status in Responses

Every response includes throttle info in `extensions.cost` — use it to dynamically throttle your requests:

```json
"extensions": {
  "cost": {
    "requestedQueryCost": 101,
    "actualQueryCost": 46,
    "throttleStatus": {
      "maximumAvailable": 1000,
      "currentlyAvailable": 954,
      "restoreRate": 50
    }
  }
}
```

Use `currentlyAvailable` and `restoreRate` to implement exponential backoff or request queuing before hitting the limit.

---

### REST Admin API (Legacy)

**Docs:** [REST Admin API](https://shopify.dev/docs/api/admin-rest) · [Rate limits](https://shopify.dev/docs/api/usage/rate-limits#rest-admin-api)

Marked legacy as of October 1, 2024. New apps should use GraphQL. Uses a leaky bucket model based on requests per second.

#### Rate Limits

| Plan | Requests/sec | Bucket Size |
|------|-------------|-------------|
| Standard | 2 | 40 |
| Advanced Shopify | 4 | — |
| Shopify Plus | 20 | 400 |
| Commerce Components | 40 | — |

When the bucket is full, Shopify returns `429 Too Many Requests` with a `Retry-After` header. Respect the header before retrying.

---

### Storefront API

**Docs:** [Storefront API](https://shopify.dev/docs/api/storefront) · [Rate limits](https://shopify.dev/docs/api/usage/rate-limits#storefront-api)

Buyer-facing GraphQL API for storefronts. No fixed requests-per-minute limit for real buyer traffic.

Shopify does rate-limit bots and malicious traffic:

- `430 Shopify Security Rejection` for suspicious activity
- Higher limits are available for verified bots via [Web Bot Auth](https://shopify.dev/docs/api/storefront#authentication-web-bot-auth)

---

## Asynchronous Patterns

For large-volume work and event-driven flows, Shopify provides first-class async mechanisms.

### Bulk Operations

**Docs:** [Bulk Operations overview](https://shopify.dev/docs/api/usage/bulk-operations/overview) · [Bulk queries](https://shopify.dev/docs/api/usage/bulk-operations/queries) · [Bulk imports](https://shopify.dev/docs/api/usage/bulk-operations/imports)

Designed for high-volume reads and writes that would exceed normal query cost limits.

**How it works:**

1. Submit a bulk operation via a GraphQL mutation (this initial call is subject to normal cost limits)
2. Shopify processes it in the background asynchronously — no open HTTP connection
3. Poll the operation status until complete
4. Download the result file (for queries) or check completion status (for imports)

> **No cost caps on the operation itself:** Bulk operations don't share the single-query 1,000 point max or standard rate limits. Always use bulk for full catalog exports or mass imports.

**Use bulk operations for:**
- Exporting all products, orders, or customers
- Large catalog syncs or platform migrations
- Any write that would take your entire rate limit bucket for a single operation

---

### Webhooks

**Docs:** [Use webhooks](https://shopify.dev/docs/api/webhooks)

Shopify POSTs to your HTTPS endpoint when a subscribed event occurs (e.g. `orders/create`, `products/update`, `app/uninstalled`).

**Key rules:**

- Respond with `2xx` within a few seconds, or Shopify retries with backoff
- Webhook deliveries do **not** count against your outbound Admin API rate limits
- Any Shopify API calls you make *inside* a webhook handler do count against your limits

**Use webhooks for:**
- Keeping external systems in sync without polling
- Triggering async workflows in your own infrastructure
- Reacting to order, product, inventory, or app lifecycle events

---

### Shopify Functions

**Docs:** [Shopify Functions overview](https://shopify.dev/docs/apps/functions)

WebAssembly functions deployed via the Admin GraphQL API, invoked by Shopify at runtime (e.g. during checkout for discounts, shipping, or payment customizations).

From your app's perspective they're asynchronous — you deploy the function, and Shopify calls it when the relevant event occurs. You don't make a direct API call each time a buyer hits checkout.

Per-function runtime and resource limits are documented on the [Shopify Functions docs](https://shopify.dev/docs/apps/functions) per function type.

---

## Global Limits

These apply across all APIs, regardless of plan.

| Limit | Value | Notes |
|-------|-------|-------|
| Max items per input array | **250** | Applies to all APIs (Admin GraphQL, Storefront, Customer Account, etc.) |
| Max paginated objects | **25,000** | Beyond this, Shopify returns `25001` to signal "more than 25k exist" |
| New variants/day (stores with 50k+ variants) | **1,000** | Applies to `productCreate`, `productUpdate`, `productVariantCreate`; not applicable to Shopify Plus |

**Pagination beyond 25,000 objects:** Use filters to narrow result sets, or switch to [bulk operations](#bulk-operations) for full exports.

---

## Choosing Sync vs Async

| Use Case | Recommended Approach |
|----------|---------------------|
| Create or update a single record | Sync — GraphQL Admin API mutation |
| Fetch specific products, orders, or customers | Sync — GraphQL Admin API query |
| Export all products or all orders | Async — [Bulk operations](#bulk-operations) |
| Mass import / catalog sync | Async — [Bulk operations](#bulk-operations) |
| React to events (order placed, inventory changed) | Event-driven — [Webhooks](#webhooks) |
| Customize checkout, discounts, or shipping logic | [Shopify Functions](#shopify-functions) |

**Decision rule of thumb:**

- **Low to moderate volume + targeted** → synchronous GraphQL
- **Would hit the 1,000-point query cap or drain your bucket** → bulk operations
- **Need to react to something that happened** → webhooks

---

## Resources

- [Compare rate limits by API](https://shopify.dev/docs/api/usage/rate-limits)
- [GraphQL Admin API rate limits](https://shopify.dev/docs/api/usage/rate-limits#graphql-admin-api)
- [REST Admin API rate limits](https://shopify.dev/docs/api/usage/rate-limits#rest-admin-api)
- [Storefront API rate limits](https://shopify.dev/docs/api/usage/rate-limits#storefront-api)
- [Bulk operations with GraphQL Admin API](https://shopify.dev/docs/api/usage/bulk-operations/overview)
- [Use webhooks](https://shopify.dev/docs/api/webhooks)
- [Shopify Functions](https://shopify.dev/docs/apps/functions)