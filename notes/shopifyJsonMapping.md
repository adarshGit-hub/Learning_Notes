# Shopify GraphQL/JSON → HotWax OMS (OFBiz/Moqui) Mapping Reference

This document serves as the technical source of truth for how Shopify order data (queried via GraphQL) is mapped, transformed, and persisted inside the HotWax Order Management System (OMS).

---

## Processing Architecture & Ingestion Flow

The ingestion pipeline is designed to be transactional and atomic. Order payloads are fetched from Shopify, transformed into the target OMS map structure, and then persisted in a single execution unit.

```mermaid
graph TD
    A["Shopify Order GraphQL Response (OrderUnifiedMegaQuery.ftl)"] --> B["prepareTransformedShopifyOrderPayload.groovy"]
    B -->|"1. Parse & Normalize Fields"| C["Calculates Routing & Resolves Geo/Facilities"]    A["Shopify Order GraphQL Response (OrderUnifiedMegaQuery.ftl)"] --> B["prepareTransformedShopifyOrderPayload.groovy"]

    B -->|"2. Split Fulfillments"| D["Groups Items into Ship Group Buckets"]
    B -->|"3. Build Entity Maps"| E["Aggregated Order Payload Map"]
    E --> F["co.hotwax.oms.order.OrderServices.create#SalesOrder"]
    F -->|"Persists Entities"| G[("OMS Database (Moqui / OFBiz Entities)")]
```

> [!NOTE]
> All mapped values are passed into `create#SalesOrder` as a **nested `Map<String, Object>`**. The service handles master-detail persistence, ensuring that all dependent entities (items, adjustments, roles, attributes, contact details) are saved atomically to guarantee referential integrity.

---

## Table of Contents

1. [Order Header & Metadata](#1-order-header--metadata)
2. [Customer Profile & Roles](#2-customer-profile--roles)
3. [Contact Methods](#3-contact-methods)
4. [Addresses (Shipping & Billing)](#4-addresses-shipping--billing)
5. [Ship Groups (Routing & Bucketing)](#5-ship-groups-routing--bucketing)
6. [Line Items & Attributes](#6-line-items--attributes)
7. [Financial Adjustments (Taxes, Promos, Shipping, Tips)](#7-financial-adjustments-taxes-promos-shipping-tips)
8. [Payments, Transactions & Terms](#8-payments-transactions--terms)

---

## 1. Order Header & Metadata

**OMS Entities:** `org.apache.ofbiz.order.order.OrderHeader`, `org.apache.ofbiz.order.order.OrderIdentification`, `org.apache.ofbiz.order.order.OrderAttribute`, `org.apache.ofbiz.order.order.OrderHeaderNote`, `org.apache.ofbiz.common.note.NoteData`, `org.apache.ofbiz.order.order.OrderContent`

| Shopify GraphQL/JSON Field | OMS Target Entity | OMS Target Field | Transformation & Mapping Logic |
|---|---|---|---|
| `legacyResourceId` (or `id`) | `OrderIdentification`<br>`OrderHeader` | `idValue` (type: `SHOPIFY_ORD_ID`) <br>`externalId` | Shopify GraphQL Global ID is resolved to a numeric ID using `ShopifyHelper.resolveShopifyGid()`. |
| `name` | `OrderHeader`<br>`OrderIdentification` | `orderName`<br>`idValue` (type: `SHOPIFY_ORD_NAME`) | Maps the user-visible identifier (e.g., `#HCD1038`). |
| `number` | `OrderIdentification` | `idValue` (type: `SHOPIFY_ORD_NO`) | Maps the sequential order number (e.g., `1038`). |
| `createdAt` | `OrderHeader` | `orderDate`, `entryDate` | Parsed to a SQL `Timestamp` using `ZonedDateTime` or `OffsetDateTime`. |
| `closedAt` | `OrderHeader` | `orderStatusDatetime` | Used as the status change timestamp if the order is completed at import. |
| `currencyCode` / `currency` | `OrderHeader` | `currencyUom` | Mapped directly (e.g., `"USD"`). |
| `presentmentCurrencyCode` | `OrderHeader` | `presentmentCurrencyUom` | Mapped directly from the presentment currency field. |
| `sourceName` | `OrderHeader` | `salesChannelEnumId` | Resolved using `ShopifyShopTypeMapping` (type: `SHOPIFY_ORDER_SOURCE`). Fallback is `UNKNWN_SALES_CHANNEL`. |
| `currentTotalPriceSet` / `totalPriceSet` | `OrderHeader` | `grandTotal` | Mapped from shop money or presentment money amount. |
| `displayFulfillmentStatus` | `OrderHeader` | `statusId` | If `'FULFILLED'`, maps to `ORDER_COMPLETED`. Otherwise, defaults to `ORDER_CREATED`. |
| `tags` | `NoteData`<br>`OrderHeaderNote` | `noteInfo`<br>`internalNote = 'Y'` | Filtered using regex to strip HTML tags. Used dynamically to skip order sync or assign routing categories. |
| `userId` or `staffMember.id` | `OrderAttribute` | `attrName = "shopify_user_id"`, `attrValue` | Identifies the Shopify staff member or user who placed the order. |
| `customAttributes` (order-level) | `OrderAttribute` | `attrName`, `attrValue` | Appends custom attributes as order-level attributes. Limits key length to 59 chars and value to 999 chars. |
| `note` | `CommunicationEvent`<br>`CommunicationEventOrder` | `content`<br>`communicationEventTypeId = "ORDER_NOTE"` | Order notes are stripped of HTML/comments and stored as communication events. |
| `statusPageUrl` | `DataResource`<br>`ElectronicText`<br>`Content`<br>`OrderContent` | `dataResourceName = "Order Status URL"`, `textData`, `contentTypeId = "DOCUMENT"`, `orderContentTypeId = "ORDER_STATUS_URL"` | Stores the Shopify order status URL in data resource and links it via `OrderContent`. |

---

## 2. Customer Profile & Roles

**OMS Entities:** `org.apache.ofbiz.party.party.Party`, `org.apache.ofbiz.party.party.Person`, `org.apache.ofbiz.party.party.PartyIdentification`, `org.apache.ofbiz.party.party.PartyClassification`, `org.apache.ofbiz.order.order.OrderRole`

When an order is synced, the customer profile is resolved or created. If customer data changes, the target `Person` record is updated.

| Shopify GraphQL/JSON Field | OMS Target Entity | OMS Target Field | Transformation & Mapping Logic |
|---|---|---|---|
| `customer.legacyResourceId` | `Party`<br>`PartyIdentification` | `externalId`<br>`idValue` (type: `SHOPIFY_CUST_ID`) | Linked as the customer's unique external ID mapping. |
| `customer.firstName` | `Person` | `firstName` | Customer first name (sanitized, defaults to `"NA"` if null). |
| `customer.lastName` | `Person` | `lastName` | Customer last name (sanitized). |
| `tags` (matching classification) | `PartyClassification` | `partyClassificationGroupId` | Resolved via `ShopifyShopTypeMapping` (type: `SHOP_ORD_CUST_CLASS`) to categorize customers (e.g. VIP, Wholesale). |

> [!IMPORTANT]
> **Order Role Bindings:** The resolved `partyId` is linked to the order via the `OrderRole` entity with the following system roles:
> - `PLACING_CUSTOMER` (The customer placing the order)
> - `BILL_TO_CUSTOMER` (Billing contact party)
> - `END_USER_CUSTOMER` (End user party)
> - `SHIP_TO_CUSTOMER` (Shipping destination party)

---

## 3. Contact Methods

**OMS Entities:** `org.apache.ofbiz.party.contact.ContactMech`, `org.apache.ofbiz.order.order.OrderContactMech`

| Shopify GraphQL/JSON Field | OMS Target Entity | OMS Target Purpose | Transformation & Mapping Logic |
|---|---|---|---|
| `email` or `customer.email` | `ContactMech` | `ORDER_EMAIL` / `PRIMARY_EMAIL` | Created as `EMAIL_ADDRESS` contact mech type. |
| `phone` or `customer.phone` | `ContactMech` | `PRIMARY_PHONE` | Created as `TELECOM_NUMBER` contact mech type. |

---

## 4. Addresses (Shipping & Billing)

**OMS Entities:** `org.apache.ofbiz.party.contact.PostalAddress`, `org.apache.ofbiz.party.contact.TelecomNumber`, `moqui.basic.GeoPoint`, `org.apache.ofbiz.order.order.OrderContactMech`

| Shopify GraphQL/JSON Field | OMS Target Entity | OMS Target Field | Transformation & Mapping Logic |
|---|---|---|---|
| `address1` | `PostalAddress` | `address1`, `additionalPurpose` | Sanitized. Suffixes `(R)` or `(B)` are stripped to set `additionalPurpose` to `HOME_LOCATION` or `WORK_LOCATION`. |
| `address2` | `PostalAddress` | `address2` | Sanitized secondary address lines. |
| `city` | `PostalAddress` | `city` | Sanitized city name. |
| `provinceCode` | `PostalAddress` | `stateProvinceGeoId` | Resolved dynamically using `moqui.basic.Geo` & `moqui.basic.GeoAssocAndToDetail` filtered by country. |
| `countryCodeV2` / `countryCode` | `PostalAddress` | `countryGeoId` | Looked up in `moqui.basic.Geo` by 2-character or 3-character alpha code. |
| `zip` / `postalCode` | `PostalAddress` | `postalCode` | Maps ZIP or postal code. |
| `latitude` / `longitude` | `GeoPoint` | `latitude`, `longitude` | Created with `dataSourceId = "GEOPT_GOOGLE"` and linked to `PostalAddress.geoPointId`. |
| `name` / `firstName` + `lastName` | `PostalAddress` | `toName` | Concatenated and sanitized. |

> [!NOTE]
> **Linking Addresses:**
> - Shipping Address is linked via `OrderContactMech` with `contactMechPurposeTypeId = "SHIPPING_LOCATION"` and associated to the ship group.
> - Billing Address is linked via `OrderContactMech` with `contactMechPurposeTypeId = "BILLING_LOCATION"`.
> - Billing Email and Billing Phone are mapped as `BILLING_EMAIL` and `PHONE_BILLING` purposes respectively.

---

## 5. Ship Groups (Routing & Bucketing)

**OMS Entity:** `org.apache.ofbiz.order.order.OrderItemShipGroup`

Rather than mapping straight from Shopify shipping lines, the Groovy script groups items into dynamic **Ship Groups** based on their fulfillment status, routing preferences, and pickup attributes.

```
Ship Group Key = [bucketFacilityId] | [shipmentMethodTypeId] | [carrierPartyId] | [splitType]
```

### Routing Logic Variables

1. **Facility ID Resolution:**
   - **Retail Location:** If `retailLocation.legacyResourceId` is present (and no `SENDSALE` tag is found), it is resolved to an OMS facility using `co.hotwax.shopify.ShopifyShopLocation`.
   - **Store Pickup:** If an item attribute has `pickupstore` or matches `storepickup.item.property.name`, it is routed to that store's facility.
   - **Fulfillment Services:** Mapped via `ShopifyShopTypeMapping` (type: `SHOP_FULL_SRVC_ALLOC`) for third-party fulfillment services.
   - **Fallback:** Defaults to the `ProductStore.inventoryFacilityId` or `_NA_`.
2. **Shipment Method & Carrier Resolution:**
   - Mapped from `shippingLines[0].title` using `co.hotwax.shopify.ShopifyShopCarrierShipment`.
   - Fallback is `STANDARD` method and store-configured carrier.
   - POS cash sales default to `POS_COMPLETED` method and `_NA_` carrier.
   - Pickup orders default to `STOREPICKUP` method and `_NA_` carrier.
3. **Fulfillment Split Type (`splitType`):**
   - Items are split into `FULFILLED` (`ITEM_COMPLETED` status) and `UNFULFILLED` (`ITEM_CREATED` status) buckets depending on the difference between total quantity, unfulfilled quantity, and non-fulfillable quantity.

### Entity Mappings

| Resolved Routing Attribute | OMS Target Entity | OMS Target Field | Description |
|---|---|---|---|
| Resolved Facility | `OrderItemShipGroup` | `facilityId` | The inventory facility from which the group will ship. |
| Target Facility | `OrderItemShipGroup` | `orderFacilityId` | The original routing destination (e.g. for `SHIP_TO_STORE`). |
| Resolved Carrier | `OrderItemShipGroup` | `carrierPartyId` | Target shipping carrier (e.g. `USPS`, `FEDEX`, `_NA_`). |
| Resolved Shipping Method | `OrderItemShipGroup` | `shipmentMethodTypeId` | Target shipping method (e.g. `STANDARD`, `STOREPICKUP`). |
| `ProductStore.allowSplit` | `OrderItemShipGroup` | `maySplit` | Maps to `Y` or `N`. |
| Gift Status | `OrderItemShipGroup` | `isGift` | Mapped to `Y` if any item in the group is marked as a gift. |
| Facility Contact details | `OrderItemShipGroup` | `shipFrom` | Nested map containing facility postal, email, and phone IDs. |
| Customer Contact details | `OrderItemShipGroup` | `shipTo` | Nested map containing customer destination postal, email, and phone IDs. |

---

## 6. Line Items & Attributes

**OMS Entities:** `org.apache.ofbiz.order.order.OrderItem`, `org.apache.ofbiz.order.order.OrderItemAttribute`, `org.apache.ofbiz.order.order.OrderItemAssoc`, `org.apache.ofbiz.product.product.GoodIdentification`, `org.apache.ofbiz.product.product.Product`

| Shopify GraphQL/JSON Field | OMS Target Entity | OMS Target Field | Transformation & Mapping Logic |
|---|---|---|---|
| `variant.legacyResourceId` | `OrderItem`<br>`Product` | `productId` | Looks up the mapping in `co.hotwax.shopify.ShopifyShopProduct`. |
| `variant.sku` / `variant.barcode` | `OrderItem`<br>`GoodIdentification` | `productId` | Looks up matching catalog ID using configured store lookup rules (`GoodIdentification` type `SKU` or `UPCA`). |
| *(None - Lookup Fallback)* | `Product` | `productId` | If no matching product is found, a placeholder is auto-created (`productTypeId = "FINISHED_GOOD"` or `"DIGITAL_GOOD"`) and mapped to variant ID. |
| `quantity` / `unfulfilledQuantity` | `OrderItem` | `quantity` | Splitted into separate ship-group items with corresponding status IDs based on fulfillment splits. |
| `originalUnitPriceSet` / `price` | `OrderItem` | `unitPrice`, `unitListPrice` | Maps item base unit price. |
| `name` / `title` | `OrderItem` | `itemDescription` | Descriptive item line title. |
| `id` | `OrderItem` | `externalId` | Shopify Line Item Global ID. |
| `taxable` | `OrderItem` | `taxCode` | Stores taxable flag status. |
| `isGift` | `OrderItem` | `isGift` | Mapped to `'Y'` or `'N'`. |
| `deliveryDetails` | `OrderItem` | *(Flat Map)* | Maps nested delivery details directly to item properties. |
| `preorderTag` (Matching) | `OrderItemAttribute` | `attrName = "PreOrderItemProperty"`, `attrValue` | Set if item belongs to pre-order product store categories or has preorder tag custom attributes. |
| `backorderTag` (Matching) | `OrderItemAttribute` | `attrName = "BackOrderItemProperty"`, `attrValue` | Set if item belongs to back-order product store categories or has backorder tag custom attributes. |
| `storePickupProperty` (Matching) | `OrderItemAttribute` | `attrName = "StorePickupItemProperty"`, `attrValue` | Set if item properties match store pickup indicators. |
| `customAttributes` | `OrderItemAttribute` | `attrName`, `attrValue` | Line item level properties. Values are truncated to 250 characters. |
| `customAttributes` with key `original_line_item_id` | `OrderItemAssoc` | `toOrderId`, `toOrderItemSeqId`, `toShipGroupSeqId`, `orderItemAssocTypeId = "EXCHANGE"`, `quantity` | Creates an exchange line association to link returns/exchanges to their parent order item. |

---

## 7. Financial Adjustments (Taxes, Promos, Shipping, Tips)

**OMS Entities:** `org.apache.ofbiz.order.order.OrderAdjustment`, `org.apache.ofbiz.order.order.OrderAdjustmentAttribute`

Adjustments are parsed and generated at both the line item level and the order header level. Negative amounts indicate discounts, while positive amounts indicate fees, taxes, or tips.

| Adjustment Origin | OMS Adjustment Type | Target Field mapping | Transformation & Mapping Logic |
|---|---|---|---|
| Line Item discounts (`discountAllocations`) | `EXT_PROMO_ADJUSTMENT` | `amount = -discountedAmount` <br>`comments` = promo code | Mapped to line level. Promo code is stored via `OrderAdjustmentAttribute` (`attrName = "discount_code"`). |
| Line Item taxes (`taxLines`) | `SALES_TAX` | `amount = taxAmount` <br>`sourcePercentage = rate` <br>`comments = title` | Mapped to line level. Contains tax rate percentage. |
| Order shipping charges (`shippingLines`) | `SHIPPING_CHARGES` | `amount = price` <br>`comments = title` | Mapped to order level. Represents the base shipping fee. |
| Order shipping taxes (`shippingLines[].taxLines`) | `SHIPPING_SALES_TAX` | `amount = taxPrice` <br>`sourcePercentage = rate` <br>`comments = title` | Mapped to order level. Sales tax charged on shipping fees. |
| Order shipping discounts (`discountApplications` targeting `SHIPPING_LINE`) | `EXT_SHIP_ADJUSTMENT` | `amount = -discountAmount` <br>`comments` = promo code | Mapped to order level. Promo code is stored via `OrderAdjustmentAttribute` (`attrName = "discount_code"`). |
| Order tips (`totalTipReceivedSet`) | `DONATION_ADJUSTMENT` | `amount = tipAmount` <br>`comments = "Tip"` | Mapped to order level. Represents customer tip donations. |

---

## 8. Payments, Transactions & Terms

**OMS Entities:** `org.apache.ofbiz.order.order.OrderPaymentPreference`, `org.apache.ofbiz.order.order.OrderTerm`, `co.hotwax.shopify.ShopifyTransactionHistory`

Transactions on the Shopify order are converted to payment preferences. In addition, payment terms (outstanding invoice amounts) are set up.

### Transaction to Payment Preference Mapping

| Shopify Transaction Field | OMS Target Entity | OMS Target Field | Transformation & Mapping Logic |
|---|---|---|---|
| `amountSet` (Presentment/Shop) | `OrderPaymentPreference` | `maxAmount`, `presentmentAmount` | Transaction total amount. |
| `amountSet.presentmentMoney.currencyCode` | `OrderPaymentPreference` | `presentmentCurrencyUom` | Currency code. Checked against `moqui.basic.Uom` where `uomTypeEnumId = "UT_CURRENCY_MEASURE"`. |
| `receiptJson` | `OrderPaymentPreference` | `exchangeRate` | Parsed from receipt json attributes (e.g., `exchange_rate`). |
| `gateway` or `paymentDetails.company` | `OrderPaymentPreference` | `paymentMethodTypeId` | Resolved via `ShopifyShopTypeMapping` (type: `SHOPIFY_PAYMENT_TYPE`). Fallback is `EXT_SHOP_OTHR_GTWAY`. |
| `id` | `OrderPaymentPreference` | `manualRefNum` | Resolved external transaction numeric ID. |
| `parentTransaction.id` | `OrderPaymentPreference` | `parentRefNum` | Linked parent transaction for refunds or captures. |
| `status` and `kind` combination | `OrderPaymentPreference` | `statusId` | Mapped using two priority lookup maps as defined below. |

```groovy
// Status ID resolve mappings based on status and transaction kind
shopifyTransactionStatusMapping = [success: 'PAYMENT_SETTLED', pending: 'PAYMENT_NOT_RECEIVED', error: 'PAYMENT_DECLINED', failure: 'PAYMENT_DECLINED']
shopifyTransactionKindMapping   = [authorization: 'PAYMENT_AUTHORIZED', capture: 'PAYMENT_SETTLED', emv_authorization: 'PAYMENT_AUTHORIZED', refund: 'PAYMENT_REFUNDED', sale: 'PAYMENT_SETTLED', void: 'PAYMENT_CANCELLED']
```

> [!NOTE]
> Mapped transaction records are also registered in the audit table `ShopifyTransactionHistory` containing `shopId`, `shopifyOrderId`, `shopifyTransactionId`, `status`, and `processedDate`.

### Payment Terms mapping

| Shopify GraphQL Field | OMS Target Entity | OMS Target Field | Transformation & Mapping Logic |
|---|---|---|---|
| `paymentTerms.paymentTermsName` | `OrderTerm` | `termTypeId` | Resolved via `ShopifyShopTypeMapping` (type: `SHOPIFY_PAYMENT_TERM`). |
| `totalOutstandingSet` | `OrderTerm` | `termValue` | Stored as the term value (outstanding amount) at order header level (`orderItemSeqId = "_NA_"`). |
