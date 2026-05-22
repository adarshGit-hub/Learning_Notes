# Webhooks

## Table of Contents
- [Why?](#why)
- [Webhook](#webhook)
- [Visual Flow](#visual-flow)
- [Step-by-Step Flow](#step-by-step-flow)
- [Implementation Details](#implementation-details)

---

## Why?

* your server keeps asking did anything changed x3 every few seconds to other server.
* every few seconds.
* (in polling)
* its waste of resources.

---

## Webhook

* flips this, the provider tells you whenever something is changed.
* you just give a URL ← it sends a HTTP POST.

---

# Flow

## Step 1

Register your webhook URL.
(to any service Shopify)

## Step 2

Event occur on the service → step 3
(a order gets registered)

## Step 3

Server (service) sends a HTTP POST to your URL.

* also sends a signature header for verification.

---

## Crucial Step 4

Respond with a HTTP 200 fast, schedule job for processing data, as if not responded fast it will try again.

In b/w of responding back you have to do step 5 (verify).

---

## Step 5

* anyone on internet can POST to your URL.
* always verify signature.
* using webhook secret.

---

## Implementation Details


* we saw, as parsing changes the bytes. (express.json() × on.raw)
* so you get original HMAC Buffer Verification.