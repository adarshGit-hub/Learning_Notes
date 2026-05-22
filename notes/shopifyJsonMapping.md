# Shopify JSON → OFBiz Entity Mapping

A reference guide that shows how each field from a Shopify Order JSON maps to its corresponding OFBiz (OMS) entity and field.

---

## Table of Contents

1. [Order Header](#1-order-header-main-order-details)
2. [Customer Information](#2-customer-information-bill-to--ship-to-party)
3. [Contact Methods](#3-contact-methods-email-phone)
4. [Addresses](#4-addresses-shipping--billing)
5. [Line Items](#5-line-items-products-ordered)
6. [Shipping Charges & Discounts](#6-shipping-charges--discounts)
7. [Payments & Transactions](#7-payments--transactions)

---

## 1. Order Header (Main Order Details)

**OFBiz Entities:** `OrderHeader` & `OrderIdentification`

| Shopify Field | Example Value | OFBiz Mapping |
|---|---|---|
| `id` | `7103366267197` | `OrderIdentification` — `orderIdentificationTypeId = "SHOPIFY_ORD_ID"`, `idValue = "7103366267197"` |
| `name` | `#HCD1038` | `OrderHeader.orderName` or `OrderHeader.externalId` |
| `createdAt` | `2026-05-01T...` | `OrderHeader.orderDate` |
| `currencyCode` | `USD` | `OrderHeader.currencyUom` |
| `sourceName` | `web` | `OrderHeader.salesChannelEnumId` (mapped to an Enum, e.g., `WEB_SALES_CHANNEL`) |
| `currentTotalPriceSet.amount` | `69.0` | `OrderHeader.grandTotal` |
| `displayFulfillmentStatus` | `UNFULFILLED` | `OrderHeader.statusId` (usually maps to `ORDER_APPROVED` at creation) |

---

## 2. Customer Information (Bill To / Ship To Party)

**OFBiz Entities:** `Party`, `Person`, `OrderRole`

| Shopify Field | Example Value | OFBiz Mapping |
|---|---|---|
| `customer.id` | `10122241212733` | `PartyIdentification` — `partyIdentificationTypeId = "SHOPIFY_CUST_ID"` |
| `customer.firstName` | `Shrishti` | `Person.firstName` |
| `customer.lastName` | `Jain` | `Person.lastName` |

> **Linking to Order:** The resolved `partyId` is linked to the order via the `OrderRole` table with `roleTypeId = "PLACING_CUSTOMER"` and `"BILL_TO_CUSTOMER"`.

---

## 3. Contact Methods (Email, Phone)

**OFBiz Entities:** `ContactMech`, `OrderContactMech`

| Shopify Field | Example Value | OFBiz Mapping |
|---|---|---|
| `email` | `jainshrishti1002@gmail.com` | `ContactMech` — type `EMAIL_ADDRESS` |

> **Linking to Order:** The `ContactMech` record is linked to the order in the `OrderContactMech` table with `contactMechPurposeTypeId = "ORDER_EMAIL"`.

---

## 4. Addresses (Shipping & Billing)

**OFBiz Entities:** `PostalAddress`, `OrderContactMech`

Shopify's `shippingAddress` and `billingAddress` objects map as follows:

| Shopify Field | Example Value | OFBiz Mapping |
|---|---|---|
| `address1` | `132 My Street` | `PostalAddress.address1` |
| `city` | `Kingston` | `PostalAddress.city` |
| `provinceCode` | `NY` | `PostalAddress.stateProvinceGeoId` |
| `countryCodeV2` | `US` | `PostalAddress.countryGeoId` |
| `zip` | `12401` | `PostalAddress.postalCode` |

> **Linking to Order:** Each address is linked in `OrderContactMech`:
> - Shipping → `contactMechPurposeTypeId = "SHIPPING_LOCATION"`
> - Billing → `contactMechPurposeTypeId = "BILLING_LOCATION"`

---

## 5. Line Items (Products Ordered)

**OFBiz Entity:** `OrderItem`

Each object in the Shopify `lineItems` array becomes one `OrderItem` record:

| Shopify Field | Example Value | OFBiz Mapping |
|---|---|---|
| `sku` | `MH12-XS-Blue` | Used to look up `Product.productId` (via `GoodIdentification` where type = `SKU`); stored in `OrderItem.productId` |
| `quantity` | `1` | `OrderItem.quantity` |
| `originalUnitPriceSet.amount` | `69.0` | `OrderItem.unitPrice` |
| `name` | `Ajax Full-Zip Sweatshirt...` | `OrderItem.itemDescription` |
| `id` | `17238703636797` | `OrderItem.externalId` or `OrderItemIdentification` |

---

## 6. Shipping Charges & Discounts

**OFBiz Entity:** `OrderAdjustment`

| Shopify Field | Example Value | OFBiz Mapping |
|---|---|---|
| `shippingLines[0].originalPriceSet.amount` | `0.0` | `OrderAdjustment` — `orderAdjustmentTypeId = "SHIPPING_CHARGES"`, `amount = 0.0` |
| `discountApplications` / `discountAllocations` | *(if present)* | `OrderAdjustment` — `orderAdjustmentTypeId = "PROMOTION_ADJUSTMENT"` |

---

## 7. Payments & Transactions

**OFBiz Entities:** `OrderPaymentPreference`, `PaymentGatewayResponse`

Payment status is captured from the Shopify `transactions` array:

| Shopify Field | Example Value | OFBiz Mapping |
|---|---|---|
| `kind` | `AUTHORIZATION` | `OrderPaymentPreference.statusId = "PAYMENT_AUTHORIZED"` |
| `gateway` | `bogus` | `OrderPaymentPreference.paymentMethodTypeId` (e.g., `"EXT_BOGUS"` or as defined in OMS) |
| `amountSet.amount` | `69.0` | `OrderPaymentPreference.maxAmount` |
| `status` | `SUCCESS` | Transaction success flag in `PaymentGatewayResponse` |

---

## Development Note

OFBiz (OMS) uses a single service — typically `storeOrder` or a similar XML/Groovy service — to persist all of the above entities together in one database transaction.

All mapped values are passed into this service as a **nested `Map<String, Object>`**, where each key corresponds to a field or sub-map for a related entity. This keeps the import atomic and ensures referential integrity across all linked tables.
