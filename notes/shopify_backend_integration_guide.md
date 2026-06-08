# Shopify Backend Integration Guide
*A Practical Guide for Backend Engineers — APIs · Webhooks · Functions · Analytics*

---

## 1. Big Picture: What Are Shopify Backend Integration Layers?

Shopify runs your store. But in any real-world setup, Shopify doesn't stand alone — it needs to talk to ERPs, warehouse systems, CRMs, analytics tools, and custom business logic. "Backend integration layers" is just the phrase for the surfaces where those conversations happen.

Think of it like an apartment building's service entrances: different doors for deliveries (data in), trash removal (data out), the maintenance crew (logic running inside), and the security camera feed (analytics). Each entrance has its own rules and is used for different purposes.

### The Four Main Backend Surfaces

| Layer | One-line description |
|---|---|
| Admin API (REST & GraphQL) | Read and write Shopify data from your backend systems. |
| Webhooks | Shopify pushes event notifications to your systems in real time. |
| Shopify Functions | Custom business logic that runs inside Shopify (e.g., checkout discounts). |
| ShopifyQL & Analytics | Query and export Shopify data for reporting and BI. |

---

## 2. Admin API — The Core Backend API

The Admin API is your primary way to read and write Shopify data programmatically. Almost every backend integration starts here.

### What It's Used For

- Sync products from an ERP into Shopify (or vice versa).
- Pull orders into a data warehouse or fulfilment system.
- Update inventory from a WMS when stock levels change.
- Sync customer records to a CRM.
- Create or update discount codes based on external logic.

### REST vs GraphQL — Which Flavour?

The Admin API comes in two flavours. They expose the same data; you choose based on your comfort and use case.

| REST | GraphQL |
|---|---|
| Familiar HTTP verbs: `GET /orders.json` | Single endpoint; you describe exactly what you want. |
| Easier to get started and debug with curl / Postman. | Efficient: fetch only the fields you need in one request. |
| Shopify is deprecating many REST endpoints over time. | Recommended for new integrations; future-proof. |
| Good for quick scripts or simple read/write ops. | Better when you need nested data (order + line items + customer). |

> **Practical advice:** If you're just getting started, REST is fine for a quick proof-of-concept. For anything you'll maintain long-term, start with GraphQL — Shopify's future investment is there. The learning curve is small if you already understand REST.

### Inputs & Outputs

**Inputs:**
- Authenticated HTTPS requests from your backend or integration platform.
- HTTP headers carrying your access token.
- JSON (or query strings for REST) describing what data you want or what change to make.

**Outputs:**
- JSON responses containing Shopify objects: products, orders, customers, inventory, metafields, etc.
- Standard HTTP status codes (200 OK, 422 Unprocessable Entity, 429 Too Many Requests).

### Prerequisites

- A Shopify app — even a private/custom one created in the Partner Dashboard. This is how you get credentials.
- An access token tied to the right OAuth scopes (permissions), e.g., `read_orders`, `write_inventory`.
- An HTTPS-capable backend or scripting environment. No special SDK required, though official SDKs exist for Node, Ruby, Python, etc.

### Rate Limits — The One Rule You Cannot Skip

Shopify enforces rate limits per store per app. Exceed them and you get HTTP 429 responses. The two mechanisms to know:

- **REST:** bucket-based leaky bucket (typically 40 requests/second for Standard plans).
- **GraphQL:** cost-based — each query has a "point" cost; you're allocated a budget that refills over time.

> **Non-negotiable:** Always check for 429 responses and back off (exponential backoff is the standard approach). Shopify's `Retry-After` header tells you how long to wait. Most SDK wrappers handle this automatically — use one if you can.

### Polling vs. Webhooks

A common early question: should I poll the Admin API periodically or use webhooks?

- Polling is fine for non-urgent batch syncs (e.g., nightly inventory reconciliation with your ERP).
- Webhooks are better for near-real-time needs (e.g., acknowledging a new order within seconds).
- Polling + webhooks together is a robust pattern: webhooks handle the real-time signal, a periodic poll catches anything missed.

### Negotiables vs. Non-Negotiables

| Non-Negotiable | Negotiable |
|---|---|
| Handle rate limits and retry on 429. | REST vs GraphQL — pick what you know. |
| Store access tokens securely (env vars / secrets manager, never in code). | How real-time your sync needs to be — minutes vs seconds vs milliseconds. |
| Don't use the Admin API as a live analytics engine (heavy repeated queries degrade performance and burn your rate limit). | Whether to use a Shopify SDK or hand-roll HTTP calls. |

---

## 3. Webhooks — The Event Layer

The Admin API lets you pull data. Webhooks flip this around: Shopify pushes data to you the moment something happens. You register a URL; Shopify sends an HTTP POST to that URL whenever the event fires.

**Example:** The moment a customer places an order, Shopify fires an `orders/create` webhook to your endpoint. Your service receives the order JSON within a second or two.

### How It Works

- You register a webhook subscription specifying a topic (e.g., `orders/create`, `products/update`) and a destination URL.
- When the event occurs, Shopify sends a signed HTTP POST with a JSON body describing what changed.
- You acknowledge with HTTP 200 quickly; Shopify retries if you don't respond in time.

### Inputs & Outputs

**Inputs (what you configure):**
- Which event topics you care about.
- A publicly reachable HTTPS URL on your backend (or an integration platform URL like an AWS API Gateway endpoint).

**Outputs (what Shopify sends you):**
- JSON payloads representing the changed object — e.g., a full order JSON on `orders/create`.
- HMAC signature header (`X-Shopify-Hmac-SHA256`) for verification.

### Prerequisites

- A publicly accessible HTTPS endpoint. (For local development, use a tunnel like ngrok.)
- Logic to verify the HMAC signature — Shopify sends a hash using your shared secret; verify it before trusting the payload.
- Idempotent handlers — Shopify may deliver the same event more than once on retries.

> **Reliability note:** Shopify's webhook delivery is best-effort with retries, but not guaranteed in all edge cases. For critical flows (e.g., fulfilment), treat webhooks as a fast-path signal and use periodic polling as a safety net.

### The Right Way to Handle a Webhook

1. Receive the POST, verify the HMAC signature.
2. Return HTTP 200 immediately — do this within a few seconds.
3. Enqueue a background job to do the actual work (call your ERP, update your DB, etc.).
4. Process the job asynchronously, with retry logic of your own.

Why? Shopify will consider a slow response (> ~5 seconds) a failure and retry. If you do heavy work inline, you'll get duplicate events and timeouts.

### Negotiables vs. Non-Negotiables

| Non-Negotiable | Negotiable |
|---|---|
| Verify HMAC signatures on every incoming request. | Which topics to subscribe to initially — start with just what you need. |
| Make handlers idempotent (safe to run twice for the same event). | Whether to add a polling safety net alongside webhooks. |
| Return 200 immediately; offload heavy work to a queue. | Which queue/background job system you use (SQS, BullMQ, Sidekiq, etc.). |
| Never do slow blocking calls directly in the webhook request handler. | |

---

## 4. Shopify Functions — Business Logic Inside Shopify

Shopify Functions are small pieces of code that run inside Shopify's own infrastructure to customize checkout behaviour — things like discount logic, shipping option filtering, payment customizations, and order routing rules.

The key insight: these run synchronously inside Shopify's critical path (e.g., during checkout). This means they are fast and reliable — but also very constrained. They cannot make slow external API calls.

> **Key mental model:** Functions are decision engines, not workflow engines. They answer yes/no or compute a value based on data Shopify gives them. They don't orchestrate multi-step processes or call your ERP.

### When to Use Functions

- **Discount logic:** "Give 15% off if the cart contains 3+ items from category X."
- **Shipping customization:** "Hide express shipping for PO Box addresses."
- **Payment filtering:** "Don't show COD as an option for orders over $500."
- **Order routing:** Direct orders to different fulfilment locations based on cart contents.

### Inputs & Outputs

**Inputs:**
- A structured JSON input defined by Shopify's schema for that function type (e.g., cart contents, customer details, available shipping methods).
- You cannot pass arbitrary external data in at runtime — any external data must be pre-loaded into Shopify metafields or metaobjects and queried from within the function.

**Outputs:**
- A structured JSON response: discount amounts, allowed/blocked shipping options, etc.
- Must be returned within Shopify's execution time limits (currently ~5ms compute budget, not wall-clock time).

### Prerequisites

- A Shopify app (public or custom) that packages and deploys the Function.
- Functions are written in languages that compile to WebAssembly — officially Rust or JavaScript/TypeScript. If you're a backend engineer already comfortable with TypeScript, this is the natural choice.
- Familiarity with the specific function type's GraphQL input schema — each function category (Discounts, Shipping, etc.) has its own defined input shape.

### What Functions Cannot Do

- Make outbound HTTP calls to external systems at runtime.
- Run for more than a few milliseconds.
- Store state between invocations.

If your logic requires up-to-date data from an external system, the pattern is: **pre-sync that data into Shopify metafields via the Admin API, then read from metafields inside the Function.**

### Negotiables vs. Non-Negotiables

| Non-Negotiable | Negotiable |
|---|---|
| Don't rely on Functions to call external APIs at runtime. | How much discount/pricing logic you move into Functions vs. keeping in external systems. |
| Keep logic simple and deterministic — no side effects, no slow operations. | Whether to use JavaScript/TypeScript or Rust for Function code. |
| Pre-load any external data into Shopify metafields before the Function runs. | Whether you use Functions at all early on — many integrations don't need them initially. |

---

## 5. Data & Analytics — Getting Data Out

Shopify stores a lot of data: orders, customers, products, sessions, revenue. Getting that data out for reporting and BI is a common need.

### Your Options

**Shopify's built-in reports and ShopifyQL**

Shopify has a built-in analytics dashboard and a SQL-like query language called ShopifyQL. ShopifyQL lets you build custom reports inside Shopify's admin — grouping by time, product, geography, etc.

- Good for: standard e-commerce KPIs (revenue, conversion, average order value) that a merchant or analyst wants to explore in Shopify's UI.
- Limitation: not designed for arbitrary joins or exporting large datasets for external BI tools.

**Bulk Operations API (for large data exports)**

When you need to export large volumes of data (e.g., all orders from the past year), use Shopify's Bulk Operations API (GraphQL). It runs a query asynchronously and produces a JSONL file you can download.

- Non-blocking: you kick off the job and poll for completion.
- The right tool for "give me all my orders" — not the regular GraphQL API (which paginates and would take many requests).

**Webhooks for streaming data**

If you want a near-real-time stream of data into your warehouse, webhooks are a reasonable pattern: capture order/customer/product events as they happen and write them to your warehouse as they arrive.

**Third-party connectors**

Many data pipeline tools (Fivetran, Airbyte, Stitch) have pre-built Shopify connectors that handle incremental syncs, pagination, and schema mapping into your warehouse. Often the fastest path if your team already has a warehouse stack.

### When Do You Need a Warehouse?

| Shopify built-in analytics is enough when… | You need a warehouse when… |
|---|---|
| You only need standard e-commerce metrics. | You need to join Shopify data with external data (CRM, ad spend, returns). |
| Your team explores data in Shopify's admin. | You need custom metrics Shopify doesn't expose. |
| You have a small catalog and order volume. | You have complex attribution, cohort, or LTV analysis needs. |
| You don't have a BI tool yet. | You have a BI tool (Looker, Metabase, etc.) and want Shopify as one source. |

### Negotiables vs. Non-Negotiables

| Non-Negotiable | Negotiable |
|---|---|
| Never use the transactional Admin API for heavy analytics queries — use Bulk Operations instead. | Whether you build a warehouse pipeline early or wait until you outgrow built-in analytics. |
| Plan for pagination — the regular API returns data in pages; handle this correctly. | Which BI tool or warehouse you use (Snowflake, BigQuery, Redshift — all fine). |

---

## 6. Putting It Together — Simple Integration Patterns

### Example 1: Small Brand + One External System (e.g., ERP or Inventory System)

> **Scenario:** You have an ERP or inventory management system. You want Shopify and the ERP to stay in sync: products, stock levels, and orders.

**Integration layers used:** Admin API (GraphQL) + Webhooks.

**How the layers divide responsibility:**

- **Product sync:** A scheduled job (cron) calls the Admin API every hour to push product data from the ERP into Shopify (or vice versa).
- **Inventory updates:** The WMS/ERP calls the Admin API to update inventory levels whenever stock changes.
- **Order capture:** Subscribe to the `orders/create` webhook so your ERP receives new orders within seconds of placement. A polling fallback job runs every 15 minutes to catch any missed events.
- **Order status back-sync:** When fulfilment is complete in the ERP, call the Admin API to update fulfilment status in Shopify.

> **What you don't need yet:** Shopify Functions (no custom checkout logic), ShopifyQL/warehouse (built-in Shopify reporting is probably fine for now).

---

### Example 2: Brand with Custom Discount and Pricing Logic

> **Scenario:** You have complex tiered pricing — wholesale customers get different prices, and multi-buy discounts depend on customer tags and product collections.

**Integration layers used:** Shopify Functions + Admin API + Webhooks.

**How the layers divide responsibility:**

- **Customer segmentation data** (wholesale flag, tier) lives as metafields on the customer, synced from your CRM via the Admin API.
- **A Discount Function** reads those metafields at checkout time and computes the correct discount without needing to call out to your CRM.
- **The `orders/create` webhook** fires when an order is placed, triggering downstream fulfilment and CRM sync in your backend.

> **What you still don't need:** A data warehouse — Shopify's built-in analytics covers revenue and discount reporting at this stage.

---

## 7. Summary — Negotiables vs. Non-Negotiables

### Non-Negotiable Basics

- **Respect Admin API rate limits.** Always handle 429 responses with backoff and retry. Don't spam the API.
- **Verify webhook signatures.** Every incoming webhook must have its HMAC signature checked before you act on it.
- **Make webhook handlers idempotent.** The same event may arrive twice. Your handler must be safe to run twice with the same payload.
- **Return 200 from webhook handlers immediately.** Do not process the payload synchronously inside the request. Enqueue a background job.
- **Don't block checkout on slow external calls.** If you need custom checkout logic, use Shopify Functions — not a synchronous call to your backend.
- **Store secrets securely.** Access tokens and webhook signing secrets go in environment variables or a secrets manager — never hardcoded.
- **Use Bulk Operations for large data exports.** Don't paginate through the regular API to fetch thousands of orders for analytics.

### Negotiable Design Choices

- **REST vs GraphQL.** Start with whichever you know. Migrate to GraphQL eventually.
- **How real-time your sync needs to be.** Minutes vs. seconds vs. milliseconds — usually minutes is fine to start.
- **How much logic to put in Shopify Functions vs. external systems.** Start with simple external logic; move into Functions when checkout performance or reliability demands it.
- **Whether and when to build a dedicated analytics pipeline.** Start with Shopify's built-in analytics; invest in a warehouse when you have cross-system reporting needs.
- **Which background job or queue system you use.** SQS, BullMQ, Sidekiq, Cloud Tasks — all fine. Pick what your team knows.

---

> **Final thought:** Shopify's backend integration model is well-designed — the Admin API handles data, webhooks handle events, Functions handle in-checkout logic, and Bulk Operations handles analytics export. Understand which surface to reach for and you'll avoid the most common mistakes. Start simple, validate in production, and add layers only as you need them.
