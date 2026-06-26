# Multi-Carrier API Integration Checklist
### FedEx · ShipHawk · Canada Post

> **Who this is for:** Someone building a shipping aggregator that connects to FedEx, ShipHawk, and Canada Post — and wants to know *exactly* what each carrier needs and how they differ.

---

## Table of Contents

1. [What is a Shipping Aggregator?](#1-what-is-a-shipping-aggregator)
2. [Authentication — "Prove who you are"](#2-authentication--prove-who-you-are)
3. [Endpoints & Protocol — "Where do you send requests?"](#3-endpoints--protocol--where-do-you-send-requests)
4. [Rate Request — "Ask for a price quote"](#4-rate-request--ask-for-a-price-quote)
5. [Rate Response — "Reading the quote back"](#5-rate-response--reading-the-quote-back)
6. [Label Generation — "Book the shipment"](#6-label-generation--book-the-shipment)
7. [Document Rendering — "What does the label look like?"](#7-document-rendering--what-does-the-label-look-like)
8. [Error Handling — "When things go wrong"](#8-error-handling--when-things-go-wrong)
9. [Normalisation — "Making all three speak the same language"](#9-normalisation--making-all-three-speak-the-same-language)

---

## 1. What is a Shipping Aggregator?

A **shipping aggregator** sits in the middle between your app and multiple carrier APIs. Instead of your code talking to FedEx, ShipHawk, and Canada Post separately, it talks to *one aggregator* that handles all three.

```
Your App
   │
   ▼
[ Aggregator Layer ]
   │          │          │
FedEx     ShipHawk   Canada Post
```

The goal of this checklist is to document *everything* the aggregator layer needs to know about each carrier.

---

## 2. Authentication — "Prove who you are"

Before you can call any API, you need to prove your identity. Each carrier does this differently.

### How Each Carrier Handles Auth

| What | FedEx | ShipHawk | Canada Post |
|------|-------|----------|-------------|
| **Method** | OAuth 2.0 (token-based) | Static API Key | HTTP Basic Auth |
| **Your Credentials** | `client_id` + `client_secret` | `api_key` (one string) | `username` + `password` |
| **Where to send them** | POST to `/oauth/token` first | In every request header | In every request header |
| **Header you get/use** | `Authorization: Bearer <token>` | `X-Api-Key: <your-key>` | `Authorization: Basic <base64>` |
| **Does it expire?** | Yes — every **1 hour** | No | No |

### FedEx — Step-by-step (it's the most complex)

FedEx requires you to **get a token first**, then use it:

```
Step 1: POST https://apis.fedex.com/oauth/token
        Body: grant_type=client_credentials
              &client_id=YOUR_ID
              &client_secret=YOUR_SECRET

Step 2: You get back: { "access_token": "abc123...", "expires_in": 3600 }

Step 3: Use in every API call:
        Authorization: Bearer abc123...

Step 4: After 55 minutes, repeat Step 1 to get a fresh token.
```

> ⚠️ **Don't** call `/oauth/token` before *every* API request — that wastes time and hits rate limits. Cache the token and refresh it 5 minutes before it expires.

### ShipHawk — Simplest

Just put your key in every request header:
```
X-Api-Key: your_api_key_here
```

### Canada Post — Base64 Encoding

Take your username and password, join them with a colon, and encode as Base64:
```
base64("username:password") → "dXNlcm5hbWU6cGFzc3dvcmQ="

Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=
```

### Sandbox (Test) Credentials

Always test in sandbox before going live. Each carrier has a separate sandbox:

| Carrier | Sandbox URL | How to Get Keys |
|---------|------------|-----------------|
| FedEx | `apis-sandbox.fedex.com` | developer.fedex.com → Create Project |
| ShipHawk | `sandbox.shiphawk.com` | ShipHawk Portal → Developer Settings |
| Canada Post | `ct.soa-gw.canadapost.ca` | canadapost.ca Developer Program |

### Security Rules (for all carriers)
- Never put credentials in your source code
- Store them in a secrets manager (e.g. AWS Secrets Manager)
- Never log tokens or API keys
- Use HTTPS only — all three carriers require it

---

## 3. Endpoints & Protocol — "Where do you send requests?"

### Base URLs

| Environment | FedEx | ShipHawk | Canada Post |
|-------------|-------|----------|-------------|
| **Production** | `https://apis.fedex.com` | `https://shiphawk.com/api/v4` | `https://soa-gw.canadapost.ca/rs` |
| **Sandbox** | `https://apis-sandbox.fedex.com` | `https://sandbox.shiphawk.com/api/v4` | `https://ct.soa-gw.canadapost.ca/rs` |

### Key Endpoints

| Action | FedEx | ShipHawk | Canada Post |
|--------|-------|----------|-------------|
| **Get Rates** | `POST /rate/v1/rates/quotes` | `POST /api/v4/rates` | `POST /rs/{cust}/{mobo}/service` |
| **Create Shipment / Label** | `POST /ship/v1/shipments` | `POST /api/v4/shipments` | `POST /rs/{cust}/{mobo}/shipment` |
| **Cancel Shipment** | `PUT /ship/v1/shipments/{id}/cancel` | `DELETE /api/v4/shipments/{id}` | `POST /rs/{cust}/{mobo}/shipment/{id}/void` |
| **Track Package** | `POST /track/v1/trackingnumbers` | `GET /api/v4/shipments/{id}/track` | `GET /rs/track/ncshippinginquiry/{pin}` |

> Notice: Cancel uses PUT for FedEx, DELETE for ShipHawk, and POST for Canada Post. Your aggregator must route correctly.

### Big Difference — Data Format

This is the most important protocol difference:

| Carrier | Request Format | Response Format |
|---------|---------------|-----------------|
| FedEx | JSON | JSON |
| ShipHawk | JSON | JSON |
| **Canada Post** | **XML** | **XML** |

Canada Post also uses **versioned media types** in headers instead of just `application/json`:
```
Content-Type: application/vnd.cpc.ship.rate-v4+xml
Accept:       application/vnd.cpc.ship.rate-v4+xml
```

> Your aggregator will need an **XML adapter** specifically for Canada Post.

---

## 4. Rate Request — "Ask for a price quote"

A rate request says: *"I want to ship a 2kg box from Toronto to Vancouver — how much?"*

### Required Fields (all carriers need these)

| Field | FedEx (JSON) | ShipHawk (JSON) | Canada Post (XML) | Your Normalised Field |
|-------|-------------|-----------------|-------------------|----------------------|
| Origin postal code | `shipper.address.postalCode` | `origin_zip` | `<origin-postal-code>` | `origin.postalCode` |
| Origin country | `shipper.address.countryCode` | `origin_country` | Inferred (Canada) | `origin.countryCode` |
| Dest postal code | `recipient.address.postalCode` | `destination_zip` | `<postal-code>` | `destination.postalCode` |
| Dest country | `recipient.address.countryCode` | `destination_country` | `<country-code>` | `destination.countryCode` |
| Weight (value) | `weight.value` | `items[].weight` | `<weight>` | `packages[].weight.value` |
| Weight unit | `weight.units` (`LB`/`KG`) | `weight_unit` (`lbs`) | Kilograms only | `packages[].weight.unit` |
| Length | `dimensions.length` | `items[].length` | `<length>` | `packages[].dimensions.length` |
| Width | `dimensions.width` | `items[].width` | `<width>` | `packages[].dimensions.width` |
| Height | `dimensions.height` | `items[].height` | `<height>` | `packages[].dimensions.height` |

### Unit Differences — Watch Out!

| Unit | FedEx | ShipHawk | Canada Post |
|------|-------|----------|-------------|
| Weight | LB or KG (you choose) | lbs by default | **KG only** |
| Dimensions | IN or CM (you choose) | Inches by default | **CM only** |

> Convert everything to the carrier's required unit before sending. For Canada Post: `inches × 2.54 = cm`.

### Optional But Useful Fields

| Field | FedEx | ShipHawk | Canada Post | Normalised |
|-------|-------|----------|-------------|-----------|
| Residential delivery? | `residential: true/false` | `residential: true/false` | Not supported | `destination.isResidential` |
| Ship date | `shipDateStamp` | `ship_date` | `<expected-mailing-date>` | `shipDate` |
| Declared value | `declaredValue.amount` | `insurance_amount` | `<declared-value>` | `packages[].declaredValue` |
| Account number | In `shippingChargesPayment` | Configured in portal | `<customer-number>` | `billingAccount.accountNumber` |

---

## 5. Rate Response — "Reading the quote back"

After sending a rate request, you get back a list of shipping options with prices.

### Key Response Fields

| Field | FedEx | ShipHawk | Canada Post | Normalised |
|-------|-------|----------|-------------|-----------|
| All rate options | `output.rateReplyDetails[]` | `rates[]` | `<price-quotes><price-quote>[]` | `rates[]` |
| Service code | `serviceType` e.g. `FEDEX_GROUND` | `service_name` e.g. `FedEx Ground` | `<service-code>` e.g. `DOM.EP` | `rate.serviceCode` |
| Total price | `totalNetCharge.amount` | `total_amount` (in cents) | `<base>` + adjustments | `rate.totalCharge.amount` |
| Currency | `totalNetCharge.currency` | `currency` (`usd`) | CAD (assumed) | `rate.totalCharge.currency` |
| Transit days | `transitTime` | `transit_days` (int) | `<expected-transit-time>` | `rate.transitDays` |
| Delivery date | `deliveryDate` | `estimated_delivery_date` | `<expected-delivery-date>` | `rate.estimatedDeliveryDate` |
| Rate ID (to book) | ❌ Not returned | ✅ `rates[].id` — valid 2 hrs | ❌ Not returned | `rate.rateId` |
| Fuel surcharge | `surcharges[type='FUEL']` | Included in total | `<adjustment type='FUEL'>` | `rate.surcharges[].fuel` |

> **Important:** ShipHawk is the only carrier that gives you a `rate_id`. Store it — you'll need it to book the shipment. For FedEx and Canada Post, you must re-request rates at booking time.

### Service Code Equivalents

| Speed | FedEx | Canada Post |
|-------|-------|-------------|
| Ground / Economy | `FEDEX_GROUND` | `DOM.EP` (Expedited Parcel) |
| Priority / Overnight | `PRIORITY_OVERNIGHT` | `DOM.PC` (Priority Courier) |
| International Express | `INTERNATIONAL_PRIORITY` | `INT.TP` (Tracked Packet) |

---

## 6. Label Generation — "Book the shipment"

Once a customer picks a rate, you create a shipment. This returns a **tracking number** and a **shipping label**.

### Create Shipment Endpoints

| | FedEx | ShipHawk | Canada Post |
|-|-------|----------|-------------|
| **Endpoint** | `POST /ship/v1/shipments` | `POST /api/v4/shipments` | `POST /rs/{cust}/{mobo}/shipment` |
| **Key Input** | Full address + package + service type | Full address + package + `rate_id` | Full address + package + service code in XML |
| **Tracking # location** | `output.transactionShipments[].masterTrackingNumber` | `shipment.tracking_number` | `<tracking-pin>` |
| **Where's the label?** | Base64 string in `encodedLabel` field | URL link (`shipment.label_url`) | HATEOAS link — GET that URL to get the PDF |

### Multi-Package Shipping

| | FedEx | ShipHawk | Canada Post |
|-|-------|----------|-------------|
| Supported? | ✅ `packageCount > 1` | ✅ Multiple items in array | ⚠️ Must create **separate shipment per package** |
| How? | First call → master tracking ID; subsequent calls reference it | All packages in one `packages[]` array | Repeat the full Create Shipment call for each package |

### Cancelling a Shipment

| | FedEx | ShipHawk | Canada Post |
|-|-------|----------|-------------|
| **How** | `PUT .../cancel` | `DELETE /api/v4/shipments/{id}` | `POST .../void` |
| **Time limit** | Before FedEx picks up the package | Before it's manifested | Before you call "Transmit Shipments" (manifest) |

> ⚠️ **Canada Post specific:** You must call **Transmit Shipments** before Canada Post will accept a pickup. Voiding is only possible *before* transmitting. Once transmitted, labels cannot be voided via API.

---

## 7. Document Rendering — "What does the label look like?"

### Label Formats Supported

| Format | FedEx | ShipHawk | Canada Post | Notes |
|--------|-------|----------|-------------|-------|
| **PDF** | ✅ | ✅ | ✅ Default | Best for regular printers |
| **ZPL II** | ✅ | ✅ | ✅ | For Zebra thermal printers |
| **PNG** | ✅ | ✅ | ❌ | FedEx min 600 DPI |
| **EPL2** | ✅ | ✅ | ❌ | Older Eltron printers |

### Label Sizes

| Size | FedEx | ShipHawk | Canada Post |
|------|-------|----------|-------------|
| 4×6 inch (thermal) | ✅ `STOCK_4X6` | ✅ Default | ✅ |
| 8.5×11 (letter) | ✅ `PAPER_8.5X11_TOP_HALF_LABEL` | ✅ | ✅ `output-format: 8.5x11` |
| 4×8 with doc tab | ✅ `STOCK_4X8` | ⚠️ Varies | ❌ |

### How the Label is Delivered

| | FedEx | ShipHawk | Canada Post |
|-|-------|----------|-------------|
| **Format** | Base64 string in JSON | URL to download | URL in HATEOAS link (GET to receive binary PDF) |
| **What to do** | Decode Base64 → save as file | Fetch the URL, save the file | Follow the link → GET → save binary response |
| **Expiry** | Until shipment is voided | ~24–48 hours | 90 days (return labels: 5 days) |

> **Best practice:** Always save the label to your own storage immediately after creation. Don't rely on carrier links staying alive.

### FedEx Label Certification (Required!)

Before going live with FedEx, you must submit test labels to FedEx for review:
- Submit PDF, PNG, and ZPL formats scanned at 600 DPI
- Email to: `label@fedex.com`
- FedEx will approve before you can use production

---

## 8. Error Handling — "When things go wrong"

### HTTP Status Codes

| Code | Meaning | FedEx | ShipHawk | Canada Post |
|------|---------|-------|----------|-------------|
| `200` | Success | ✅ | ✅ | ⚠️ May still have errors in XML body! |
| `400` | Bad request (your fault) | Invalid fields | Validation errors | Business rule violated |
| `401` | Unauthorized | Token expired | Wrong API key | Wrong credentials |
| `403` | Forbidden | Account can't use this service | Permission issue | Account restricted |
| `404` | Not found | Shipment doesn't exist | Resource missing | Label link expired |
| `429` | Too many requests | Rate limit hit | Rate limit hit | May occur |
| `500` | Server error | FedEx internal error | ShipHawk down | Canada Post down |

> ⚠️ **Canada Post gotcha:** Even a `200 OK` can contain error messages inside the XML `<messages>` block. Always inspect the body, don't trust the status code alone.

### Error Body Formats (they look different!)

**FedEx (JSON):**
```json
{
  "errors": [
    { "code": "WEIGHT.EXCEEDS.MAXIMUM", "message": "Weight exceeds maximum limit" }
  ]
}
```

**ShipHawk (JSON):**
```json
{
  "errors": [{ "message": "weight must be less than 150 lbs" }]
}
```

**Canada Post (XML inside a 400 response):**
```xml
<messages>
  <message>
    <code>7007</code>
    <description>Weight value is invalid</description>
  </message>
</messages>
```

Your aggregator should normalise all of these to a common format:
```json
{ "carrier": "canadapost", "code": "PACKAGE_WEIGHT_EXCEEDED", "message": "...", "retryable": false }
```

### Retry Strategy

| Scenario | What to do |
|----------|-----------|
| `401` on FedEx | Refresh OAuth token → retry once |
| `401` on ShipHawk/Canada Post | Alert ops — key needs rotating; don't retry |
| `429` (rate limit) | Wait, then retry with exponential back-off (1s, 2s, 4s...) |
| `500` / `503` | Retry up to 3 times with back-off |
| `400` (bad request) | Do NOT retry — fix the request first |

**Exponential back-off** means you wait a little longer each time you retry, so you don't hammer the server:
```
Attempt 1 → fail → wait 1 second
Attempt 2 → fail → wait 2 seconds
Attempt 3 → fail → wait 4 seconds → give up
```

---

## 9. Normalisation — "Making all three speak the same language"

This is the hardest part of building an aggregator. Here's a summary of the key differences you must handle.

### The Biggest Differences at a Glance

| Difference | FedEx | ShipHawk | Canada Post | Your Aggregator Handles It By... |
|-----------|-------|----------|-------------|----------------------------------|
| **Payload format** | JSON | JSON | XML | XML adapter for Canada Post |
| **Weight unit** | LB or KG | lbs | **KG only** | Convert to carrier unit on send |
| **Dimension unit** | IN or CM | Inches | **CM only** | Convert: inches × 2.54 = cm |
| **Currency** | USD | USD (cents) | CAD | Store currency code with every amount |
| **Label delivery** | Base64 | URL | URL (HATEOAS) | Normalise to `{ url?, base64? }` |
| **Auth type** | Token (expires) | Static key | Static key | Per-carrier auth adapter |

### Standard Workflow in the Aggregator

Every shipment follows the same steps, regardless of carrier:

```
1. getRates(origin, destination, packages)
      │
      ├─ Translates to FedEx rate request (JSON)
      ├─ Translates to ShipHawk rate request (JSON)
      └─ Translates to Canada Post rate request (XML)
      │
      ▼
2. normaliseRates(fedexRates, shiphawkRates, canadaPostRates)
   → Returns unified list: [{ carrier, serviceCode, totalCharge, transitDays, ... }]
      │
      ▼
3. User selects a rate
      │
      ▼
4. createShipment(selectedRate, addresses, packages)
      │
      ├─ FedEx: POST /ship/v1/shipments
      ├─ ShipHawk: POST /api/v4/shipments (pass rate_id)
      └─ Canada Post: POST /rs/.../shipment (XML)
      │
      ▼
5. getLabel() → normalise to LabelArtifact { url?, base64?, mimeType }
      │
      ▼
6. Save label to your own storage immediately
```

### Mandatory Steps by Carrier

| Step | FedEx | ShipHawk | Canada Post |
|------|-------|----------|-------------|
| Refresh auth token | Required (hourly) | Not needed | Not needed |
| Re-request rates at booking | Required | Not needed (use `rate_id`) | Required |
| Manifest / end-of-day | Optional (Express only) | Auto or manual | **Required before pickup** |
| Label certification | **Required before production** | Not needed | Not needed |

### Service Code Map (start of your registry)

| Delivery Speed | FedEx Code | Canada Post Code | ShipHawk Name |
|---------------|------------|------------------|---------------|
| Ground (3–5 days) | `FEDEX_GROUND` | `DOM.EP` | FedEx Ground |
| 2-Day | `FEDEX_2_DAY` | `DOM.XP` | FedEx 2Day |
| Overnight | `PRIORITY_OVERNIGHT` | `DOM.PC` | FedEx Priority Overnight |
| International Economy | `INTERNATIONAL_ECONOMY` | `USA.EP` | FedEx International Economy |

> Note: Canada Post only ships within Canada and to the US/International. FedEx and ShipHawk are global.

---

## Quick Reference: Where Each Carrier Is Different

| Topic | The Key Difference |
|-------|--------------------|
| Auth | FedEx uses a token that expires; others use static keys |
| Format | Canada Post uses XML; others use JSON |
| Units | Canada Post only accepts kg and cm |
| Rate ID | Only ShipHawk gives you a rate ID to reuse at booking |
| Multi-package | Canada Post requires one shipment per package |
| Manifest | Canada Post requires Transmit Shipments before any pickup |
| Label format | FedEx returns base64; ShipHawk and Canada Post return URLs |
| Certification | FedEx requires label approval before production |
| Tracking | ShipHawk supports webhooks; FedEx and Canada Post require polling |

---

*Checklist prepared for: Multi-Carrier Shipping Aggregator Technical Discovery*
*Carriers covered: FedEx REST API · ShipHawk API v4 · Canada Post REST API*