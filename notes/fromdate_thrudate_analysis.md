# Assignment: fromDate & thruDate Analysis in HotWax Commerce OMS

## Table of Contents
- [Part 0: All Scenarios Overview](#part-0-all-scenarios-overview)
- [Part 1: Step-by-Step Data Creation in Each Flow](#part-1-step-by-step-data-creation)
- [Part 2 (T-1): Entities with fromDate & thruDate — Sorted List](#part-2-t-1-entities-with-fromdate--thrudate)
- [Part 3 (T-1): How fromDate/thruDate Affects Datamodel & Business Processes](#part-3-t-1-impact-on-datamodel--business-processes)
- [Part 4 (T-2): User Actions That Trigger New Records & Code for Correct Data Fetching](#part-4-t-2-user-actions--correct-data-fetching)

---

## Part 0: All Scenarios Overview

### A. Order Scenarios

| # | Scenario | Key Characteristics |
|---|----------|-------------------|
| 1 | Online Delivery Order – No Adjustments | Simple shipping order, no discounts/taxes |
| 2 | Online Delivery Order – Shipping, Discounts, Taxes (All Charges) | Full adjustments: shipping charges, discount codes, sales tax |
| 3 | Online Delivery Order – Unfulfilled, Discount Code & Taxes, Address Added | Created status, discount + tax, ship-to address added later |
| 4 | Online Delivery Order – Unfulfilled, Discount Code & Taxes, Address Added (v2) | Variant of #3 with different address flow |
| 5 | Online Mixed Cart Order – No Adjustments | Both shipping + pickup items, no charges |
| 6 | Online Mixed Cart Order – Shipping, Discounts, Taxes (All Charges) | Mixed cart with full adjustments |
| 7 | Online Mixed Cart Order – Pickup at Multiple Locations | Items picked up from different stores |
| 8 | Online Mixed Cart Order – Shipping, Discounts & Taxes (Full Charges Scenario) | Complete mixed cart with all charge types |
| 9 | Online Mixed Cart Order – Items in Multiple Status | Some items completed, some still created/approved |
| 10 | Online Pickup Order – No Adjustments | Pure BOPIS order |
| 11 | Online Order All Items Removed | All items cancelled from order |
| 12 | Online Order with Gift Card Items | Digital gift card items (DIGITAL_GOOD) |
| 13 | POS Completed Order – With Adjustments | In-store sale with discounts/taxes, auto-completed |
| 14 | POS Completed Order – No Adjustments | Simple in-store sale |
| 15 | POS Send Sale – No Adjustments | POS order shipped to customer |
| 16 | POS Send Sale – Cancelled (All Items Removed) | POS send sale fully cancelled |
| 17 | POS Send Sale – Some Items Cancelled | Partial cancellation of POS send sale |
| 18 | POS Mixed Cart – With Adjustments | POS with both pickup and ship items + adjustments |

### B. Return Scenarios

| # | Scenario | Key Characteristics |
|---|----------|-------------------|
| 1 | Web order, Normal Return With Restock by Admin | restockType: RETURN — inventory goes back |
| 2 | Web order, Fulfilled Item Refund by Admin, No Restock | restockType: NO_RESTOCK — inventory not returned |
| 3 | Web order, Unfulfilled Item canceled by Admin, No Restock | Unfulfilled item cancelled and refunded |
| 4 | Web order, Unfulfilled Order Cancelled Refunded No Restock | Entire unfulfilled order cancelled |
| 5 | Web order, Unfulfilled Order Cancelled by Admin With Restock | Cancelled with inventory restock |
| 6 | Web order, Unfulfilled Order Cancelled by Admin No Restock | Cancelled without restock |
| 7 | Web Order, Returned include Restocking Fees | Return with restocking fee deducted |
| 8 | Web order, Appeasement by Admin Refund only | Refund without physical return |
| 9 | SendSale order, Unfulfilled Items Cancelled and Refunded with Shipping | Send sale cancellation with shipping refund |
| 10 | POS Order Custom Gift Card Returned on POS | NO_RESTOCK — gift card return |
| 11 | POS Order Returned on Web | restockType: RETURN |
| 12 | POS Order Refunded on Web | restockType: RETURN |
| 13-18 | POS/Web Equal/Lesser/Greater Exchanges | Various exchange scenarios on POS and Web |
| 19-21 | POS Order Instant Equal/Lesser/Greater Return And Exchange | Instant exchange at POS |
| 22 | POS Partially Paid Order Instant Refund | restockType: RETURN |
| 23-25 | Web Order Equal/Lesser/Greater Exchange On Web | Web-initiated exchanges |
| 26-28 | Loop Return/Exchange scenarios | Loop RMS integration flows |

---

## Part 1: Step-by-Step Data Creation

### Flow 1: Online Delivery Order (Full Charges)

Each step below shows **which entities get records created or updated**.

#### Step 1: Order Import from Shopify
When the `Import Orders` job runs, the Shopify order is transformed via `prepareTransformedShopifyOrderPayload.groovy` and persisted:

| Entity | Operation | Key Data |
|--------|-----------|----------|
| `OrderHeader` | **INSERT** | orderId, externalId, statusId=ORDER_CREATED, orderDate, grandTotal, productStoreId, currencyUomId |
| `OrderStatus` | **INSERT** | orderId, statusId=ORDER_CREATED, statusDatetime |
| `OrderItem` (per line item) | **INSERT** | orderId, orderItemSeqId, productId, quantity, unitPrice, statusId=ITEM_CREATED |
| `OrderItemShipGroup` | **INSERT** | orderId, shipGroupSeqId, facilityId, shipmentMethodTypeId, carrierPartyId |
| `OrderItemShipGroupAssoc` | **INSERT** | orderId, orderItemSeqId, shipGroupSeqId, quantity |
| `OrderContactMech` | **INSERT** | orderId, contactMechId (shipping address), contactMechPurposeTypeId |
| `OrderAdjustment` (per adj) | **INSERT** | orderId, orderAdjustmentTypeId (SHIPPING_CHARGES, SALES_TAX, EXT_PROMO_ADJUSTMENT), amount |
| ⭐ `OrderIdentification` | **INSERT** | orderId, orderIdentificationTypeId (SHOPIFY_ORD_ID/SHOPIFY_ORD_NAME/SHOPIFY_ORD_NO), idValue, **fromDate=now** |
| ⭐ `OrderRole` | **INSERT** | orderId, partyId, roleTypeId (BILL_TO_CUSTOMER/SHIP_TO_CUSTOMER), **fromDate=now** |
| `OrderPaymentPreference` | **INSERT** | orderId, paymentMethodTypeId, maxAmount, manualRefNum |
| `OrderAttribute` | **INSERT** | orderId, attrName, attrValue |
| `PartyIdentification` | **INSERT** | partyId, partyIdentificationTypeId=SHOPIFY_CUST_ID, idValue |
| ⭐ `PartyContactMech` | **INSERT** | partyId, contactMechId, **fromDate=now** |
| `ContactMech` / `PostalAddress` | **INSERT** | contactMechId, address details |

> [!IMPORTANT]
> Entities marked with ⭐ have `fromDate` & `thruDate` fields. These are the temporal entities where the "from/thru date pattern" applies.

#### Step 2: Order Approval
| Entity | Operation | Key Data |
|--------|-----------|----------|
| `OrderHeader` | **UPDATE** | statusId → ORDER_APPROVED |
| `OrderStatus` | **INSERT** | statusId=ORDER_APPROVED, statusDatetime |
| `OrderItem` | **UPDATE** | statusId → ITEM_APPROVED |
| `OrderStatus` | **INSERT** | per item: statusId=ITEM_APPROVED |

#### Step 3: Brokering / Inventory Allocation
| Entity | Operation | Key Data |
|--------|-----------|----------|
| `OrderItemShipGroup` | **INSERT/UPDATE** | new ship group if facility changes |
| `OrderItemShipGroupAssoc` | **UPDATE** | reassigned to new shipGroupSeqId |
| `OrderFacilityChange` | **INSERT** | routing history log |
| `FacilityOrderCount` | **INSERT/UPDATE** | daily order count for facility |
| `InventoryItem` | **INSERT/RETRIEVE** | product-to-facility mapping |
| `OrderItemShipGrpInvRes` | **INSERT** | inventory reservation record |
| `InventoryItemDetail` | **INSERT** | ATP diff = -quantity |

#### Step 4: Store Fulfillment (Pack & Ship)
| Entity | Operation | Key Data |
|--------|-----------|----------|
| `Shipment` | **INSERT** | shipmentId, statusId, originFacilityId, destinationFacilityId |
| `ShipmentItem` | **INSERT** | shipmentId, productId, quantity |
| `ShipmentRouteSegment` | **INSERT** | trackingIdNumber, carrierPartyId |
| `ShipmentPackageContent` | **INSERT** | shipmentId, packageSeqId, quantity |
| `ShipmentStatus` | **INSERT** | shipmentId, statusId=SHIPMENT_SHIPPED |
| `OrderItem` | **UPDATE** | statusId → ITEM_COMPLETED |
| `OrderHeader` | **UPDATE** | statusId → ORDER_COMPLETED (when all items completed) |
| `OrderStatus` | **INSERT** | statusId=ORDER_COMPLETED |
| `InventoryItemDetail` | **INSERT** | QOH diff = -quantity (physical stock leaves) |
| ⭐ `ShipmentContent` | **INSERT** | shipmentId, contentId, **fromDate=now** (if shipping label content attached) |

#### Step 5: Address Added Later (Unfulfilled scenario)
| Entity | Operation | Key Data |
|--------|-----------|----------|
| `ContactMech` / `PostalAddress` | **INSERT** | new contactMechId |
| ⭐ `PartyContactMech` (old) | **UPDATE** | **thruDate=now** (expire the old record) |
| ⭐ `PartyContactMech` (new) | **INSERT** | partyId, contactMechId, **fromDate=now** |
| `OrderContactMech` | **UPDATE** | new contactMechId |

### Flow 2: POS Completed Order
POS orders arrive as already-completed:
| Entity | Operation | Key Data |
|--------|-----------|----------|
| `OrderHeader` | **INSERT** | statusId=ORDER_COMPLETED, salesChannelEnumId=POS_CHANNEL |
| `OrderStatus` | **INSERT** | ORDER_COMPLETED |
| `OrderItem` | **INSERT** | statusId=ITEM_COMPLETED |
| All other entities same as order import but with shipmentMethodTypeId=POS_COMPLETED |

### Flow 3: Return (Normal Return with Restock)
| Entity | Operation | Key Data |
|--------|-----------|----------|
| `ReturnHeader` | **INSERT** | returnId, statusId=RETURN_REQUESTED, destinationFacilityId, returnChannelEnumId |
| `ReturnItem` (per item) | **INSERT** | returnId, returnItemSeqId, orderId, orderItemSeqId, productId, returnQuantity, returnPrice |
| `ReturnStatus` | **INSERT** | returnId, statusId=RETURN_REQUESTED |
| ⭐ `ReturnIdentification` | **INSERT** | returnId, returnIdentificationTypeId=SHOPIFY_RTN_ID, idValue, **fromDate=now** |
| When completed (restockType=RETURN): |
| `ReturnItem` | **UPDATE** | statusId → RETURN_COMPLETED, receivedQuantity, expectedItemStatus=INV_RETURNED |
| `ReturnStatus` | **INSERT** | statusId=RETURN_COMPLETED |
| `ReturnAdjustment` | **INSERT** | taxes, shipping refund, discount adjustments on return |
| `ReturnItemResponse` | **INSERT** | orderPaymentPreferenceId (refund transaction link) |
| `InventoryItemDetail` | **INSERT** | QOH/ATP diff = +quantity (inventory restocked) |

### Flow 4: Exchange (e.g., POS Equal Exchange)
All return flow entities PLUS:
| Entity | Operation | Key Data |
|--------|-----------|----------|
| New `OrderHeader` | **INSERT** | exchange order, linked to original |
| New `OrderItem` | **INSERT** | the exchanged product |
| `OrderPaymentPreference` | **INSERT** | paymentMethodTypeId=EXCHANGE_CREDIT or EXCHANGE_PAYMENT |
| `ReturnItemResponse` | **UPDATE** | replacementOrderId linked |
| `CommunicationEvent` | **INSERT** | original order reference note |
| `CommunicationEventReturn` | **INSERT** | links comm event to return |

---

## Part 2 (T-1): Entities with fromDate & thruDate

### Sorted Master List

> [!NOTE]
> **PK** = `fromDate` is part of the Primary Key (composite key pattern).
> **Non-PK** = `fromDate` is a regular field (not part of PK).
> Entities are grouped by domain and sorted alphabetically within each group.

### Order Domain
| Entity | fromDate is PK? | Relevance to Order/Return Flow |
|--------|:---:|---|
| `OrderContent` | ✅ PK | Content (documents/images) attached to orders |
| `OrderIdentification` | ✅ PK | **CRITICAL** — Maps external IDs (SHOPIFY_ORD_ID) to internal orderId |
| `OrderRole` | ✅ PK | **CRITICAL** — Party roles on orders (BILL_TO_CUSTOMER, SHIP_TO_CUSTOMER) |
| `ExcludedOrderFacility` | ✅ PK | Facilities excluded from brokering for specific order items |

### Return Domain
| Entity | fromDate is PK? | Relevance to Order/Return Flow |
|--------|:---:|---|
| `ReturnIdentification` | ✅ PK | **CRITICAL** — Maps external IDs (SHOPIFY_RTN_ID) to internal returnId |
| `ReturnTypeReasonGrpMember` | ✅ PK | Reason groups for returns |

### Product Domain
| Entity | fromDate is PK? | Relevance to Order/Return Flow |
|--------|:---:|---|
| `GoodIdentification` | ✅ PK | **CRITICAL** — Maps SKU/UPC to productId. Used in order import & returns |
| `ProdCatalogCategory` | ✅ PK | **CRITICAL** — Links catalogs to categories (pre-order/backorder detection) |
| `ProductAssoc` | ✅ PK | **CRITICAL** — Product relationships (PRODUCT_VARIANT, PRODUCT_COMPONENT for marketing packages) |
| `ProductCategoryMember` | ✅ PK | Product-to-category membership |
| `ProductCategoryRollup` | ✅ PK | Category hierarchy |
| `ProductCategoryContent` | ✅ PK | Content on categories |
| `ProductContent` | ✅ PK | Content on products |
| `ProductFeatureAppl` | ✅ PK | Feature applications (size, color) on products |
| `ProductPrice` | ✅ PK | Product pricing (by type, purpose, currency, date range) |
| `ProductStoreCatalog` | ✅ PK | Links store to catalog |
| `ProductStoreFacility` | ✅ PK | **CRITICAL** — Which facilities belong to which store |
| `ProductStoreRole` | ✅ PK | Party roles on stores |
| `ProductStoreFacilityGroup` | ✅ PK | Facility groups for stores |
| `ProductAverageCost` | ✅ PK | Average cost tracking |

### Facility Domain
| Entity | fromDate is PK? | Relevance to Order/Return Flow |
|--------|:---:|---|
| `FacilityCalendar` | ✅ PK | Operating calendars for facilities |
| `FacilityContactMech` | ✅ PK | **CRITICAL** — Facility addresses (used for ship-from in orders) |
| `FacilityContactMechPurpose` | ✅ PK | Purpose of facility contact info |
| `FacilityContent` | ✅ PK | Content on facilities |
| `FacilityGroupMember` | ✅ PK | Facility-to-group membership |
| `FacilityIdentification` | ✅ PK | External IDs for facilities |
| `FacilityParty` | ✅ PK | Party roles on facilities |

### Party Domain
| Entity | fromDate is PK? | Relevance to Order/Return Flow |
|--------|:---:|---|
| `PartyContactMech` | ✅ PK | **CRITICAL** — Customer addresses/emails/phones. Expired when address changes |
| `PartyContactMechPurpose` | ✅ PK | Purpose of party contact info |
| `PartyCarrierAccount` | ✅ PK | Carrier accounts for parties |
| `PartyClassification` | ✅ PK | Customer segments/classifications |
| `PartyContent` | ✅ PK | Content on parties |
| `PartyRelationship` | ✅ PK | Relationships between parties |
| `CommEventContentAssoc` | ✅ PK | Content attached to communication events |
| `CommunicationEventRole` | ✅ PK | Roles on communication events |
| `ContentAssoc` | ✅ PK | Content-to-content associations |
| `ContentRole` | ✅ PK | Roles on content records |

### Shipment Domain
| Entity | fromDate is PK? | Relevance to Order/Return Flow |
|--------|:---:|---|
| `PicklistRole` | ✅ PK | Party roles on picklists |
| `ShipmentContent` | ✅ PK | Content attached to shipments |

### Security Domain
| Entity | fromDate is PK? | Relevance to Order/Return Flow |
|--------|:---:|---|
| `UserLoginSecurityGroup` | ✅ PK | User security group membership |
| `SecurityGroupPermission` | ✅ PK | Permissions for security groups |
| `UserLoginPasswordHistory` | ✅ PK | Password change history |

### Other
| Entity | fromDate is PK? | Relevance |
|--------|:---:|---|
| `EnumerationGroupMember` | ✅ PK | Enumeration grouping |
| `RoleTypeGroupMember` | ✅ PK | Role type grouping |
| `UserSearchPreference` | ✅ PK | User search prefs |
| `RequirementInventoryTransfer` | ✅ PK | Transfer order requirements |
| `DataManagerMapping` | ❌ Non-PK | Data mapping configuration |
| `ShopifyShopScript` | ❌ Non-PK | Shopify scripts |

---

## Part 3 (T-1): Impact on Datamodel & Business Processes

### Why fromDate & thruDate Exist — The Temporal Pattern

> [!IMPORTANT]
> The `fromDate`/`thruDate` pattern implements **temporal versioning** in the data model. Instead of updating a record in-place (losing history), a new record is created with a new `fromDate`, and the old record's `thruDate` is set to "now". This preserves **full audit history** of every change.

#### Pattern Rules:
1. **`fromDate` as PK** → The entity supports **multiple concurrent valid records** for the same logical relationship, differentiated by time
2. **`thruDate = NULL`** → The record is **currently active/valid**
3. **`thruDate = <timestamp>`** → The record was **expired/superseded** at that time
4. **New record** → A new row with `fromDate = now` and `thruDate = NULL` replaces the old active record

### How This Changes the Business Process

#### 1. Order Identification Lookup
When the system needs to find an order by its Shopify ID:
- **Without date filter**: Could return expired/old mappings if a Shopify order ID was remapped
- **With date filter**: Returns only the current valid mapping

#### 2. Product SKU Lookup (GoodIdentification)
When resolving a product from a SKU during order import:
- A product's SKU can change over time (new `GoodIdentification` row, old one expired)
- Must filter by date to get the **current** SKU→productId mapping

#### 3. Customer Address Changes (PartyContactMech)
When a customer updates their address:
- Old `PartyContactMech` gets `thruDate = now`
- New `PartyContactMech` inserted with `fromDate = now`
- Ship-to resolution must use date filter to get the current address

#### 4. Facility-Store Mapping (ProductStoreFacility)
When a facility is added/removed from a store:
- Old mapping gets expired
- During brokering, only currently-active facilities should be considered

#### 5. Product Category Membership (ProductCategoryMember, ProdCatalogCategory)
Pre-order/backorder detection relies on category membership:
- A product can be moved in/out of pre-order category
- Must check current membership, not historical

---

## Part 4 (T-2): User Actions & Correct Data Fetching

### Critical Question: When does a user action create a NEW record in a temporal entity?

| User Action | Entity Affected | What Happens |
|-------------|----------------|-------------|
| **Customer changes address** | `PartyContactMech` | Old record: thruDate=now. New record: fromDate=now |
| **Customer changes phone/email** | `PartyContactMech` | Same as above |
| **Admin changes facility address** | `FacilityContactMech` | Old expired, new created |
| **SKU/UPC updated for a product** | `GoodIdentification` | Old SKU mapping expired, new one created |
| **Product price changed** | `ProductPrice` | Old price expired, new price with fromDate=now |
| **Product moved to pre-order category** | `ProductCategoryMember` | New membership with fromDate=now |
| **Product removed from pre-order category** | `ProductCategoryMember` | thruDate=now on existing record |
| **Facility added to store** | `ProductStoreFacility` | New record: fromDate=now |
| **Facility removed from store** | `ProductStoreFacility` | thruDate=now on existing |
| **Return re-identified** | `ReturnIdentification` | Old expired, new created |
| **Order re-identified** | `OrderIdentification` | Old expired, new created |
| **Facility added/removed from group** | `FacilityGroupMember` | Temporal create/expire |
| **Product variant association changed** | `ProductAssoc` | Old expired, new created |

### Code Patterns for Correct Date-Filtered Data Fetching

The codebase uses **two primary patterns** to ensure only current (non-expired) records are fetched:

#### Pattern 1: `filterByDate()` — Post-Query Filter
```groovy
// Used AFTER fetching a list, filters in-memory
List results = ec.entity.find("EntityName")
    .condition([field: value])
    .list()
    .filterByDate("fromDate", "thruDate", ec.user.nowTimestamp)
```

**Real examples from the codebase:**

```groovy
// 1. Looking up ReturnIdentification to find existing return
//    File: createShopifyInProgressReturn.groovy:42
List<Map> returnIdentifications = ec.entity.find("co.hotwax.order.return.ReturnIdentification")
    .condition([returnIdentificationTypeId: "SHOPIFY_RTN_ID", idValue: shopifyReturnId])
    .list().filterByDate("fromDate", "thruDate", nowTs)

// 2. Looking up GoodIdentification to resolve product from SKU
//    File: createShopifyInProgressReturn.groovy:172
List fallbackProductIds = ec.entity.find("org.apache.ofbiz.product.product.GoodIdentification")
    .condition([goodIdentificationTypeId: "SKU", idValue: sku])
    .list().filterByDate("fromDate", "thruDate", nowTs)

// 3. Checking ProdCatalogCategory for pre-order detection
//    File: prepareTransformedShopifyOrderPayload.groovy:640
def prodCatalogCategories = ec.entity.find("org.apache.ofbiz.product.catalog.ProdCatalogCategory")
    .condition("prodCatalogId", productCatalogId)
    .condition("prodCatalogCategoryTypeId", categoryTypeId)
    .useCache(true).list().filterByDate("fromDate", "thruDate", ec.user.nowTimestamp)
```

#### Pattern 2: `conditionDate()` — Query-Level Filter
```groovy
// Used as part of the query builder, filters at DB level (more efficient)
List results = ec.entity.find("EntityName")
    .condition([field: value])
    .conditionDate("fromDate", "thruDate", null)  // null = now
    .list()
```

**Real examples:**

```groovy
// 1. Finding product associations (marketing package components) during return restocking
//    File: createShopifyCompletedReturn.groovy:286
List<Map> productAssocs = ec.entity.find("org.apache.ofbiz.product.product.ProductAssocAndFrom")
    .condition([productId: productId, productTypeId: "MARKETING_PKG_PICK",
                productAssocTypeId: "PRODUCT_COMPONENT"])
    .conditionDate("fromDate", "thruDate", null)
    .selectField("productIdTo,quantity")
    .list()

// 2. Security group permission check during login
//    File: OfbizShiroRealm.groovy:191
.conditionDate("fromDate", "thruDate", eci.user.getNowTimestamp())
.disableAuthz().orderBy("-fromDate").list()

// 3. Product feature lookups in PDF templates
//    File: PdfTemplateData.xml:108
ec.entity.find("co.hotwax.product.feature.ProductFeatureAndAppl")
    .condition("productId", productId)
    .conditionDate("fromDate", "thruDate", ec.user.getNowTimestamp())
    .list()
```

### What Goes Wrong Without Date Filtering?

> [!CAUTION]
> **If `filterByDate` / `conditionDate` is NOT used on temporal entities, the following bugs occur:**

| Scenario | Bug | Impact |
|----------|-----|--------|
| Customer changed address, order imported | Old address fetched for ship-to | Order shipped to wrong address |
| Product SKU changed, return created | Old product resolved from SKU | Wrong product on return item |
| Facility removed from store, brokering runs | Removed facility still considered | Orders allocated to inactive facility |
| Product moved out of pre-order category | Still treated as pre-order | Order stuck in Pre-Order Parking |
| Product variant association changed | Old component products used | Wrong items in marketing package |
| Return re-identified with new Shopify ID | Duplicate return created | Financial reconciliation errors |

### The Fix: Always Apply Date Filters

> [!TIP]
> **Rule of thumb**: Any time you query an entity that has `fromDate`/`thruDate` and you want the **current** record, you MUST use one of:
> - `.list().filterByDate("fromDate", "thruDate", timestamp)` — for in-memory post-filtering
> - `.conditionDate("fromDate", "thruDate", timestamp)` — for DB-level filtering (preferred for large datasets)
>
> Use `null` as the timestamp parameter to default to "now".

### Summary: Entities Most Critical in Order/Return Flows

These are the entities with `fromDate`/`thruDate` that are **actively queried with date filtering** in the order import, return creation, and fulfillment code:

| Entity | Where Used | Filter Method |
|--------|-----------|---------------|
| `ReturnIdentification` | Return lookup by Shopify ID | `filterByDate` |
| `GoodIdentification` | Product resolution by SKU/UPC | `filterByDate` |
| `ProdCatalogCategory` | Pre-order/backorder category check | `filterByDate` |
| `ProductAssoc` | Marketing package component lookup during restock | `conditionDate` |
| `PartyContactMech` | Customer address resolution | `conditionDate` |
| `FacilityContactMech` | Facility address for ship-from | `conditionDate` |
| `ProductStoreFacility` | Store-to-facility mapping for brokering | `conditionDate` |
| `ProductFeatureAppl` | Product feature lookup for labels/picking | `conditionDate` |
| `SecurityGroupPermission` | User authorization during API calls | `conditionDate` |
| `UserLoginSecurityGroup` | User login group membership | `filterByDate` |

---

## Key Takeaways

1. **fromDate/thruDate is NOT just metadata** — it is a core part of the Primary Key in most temporal entities, meaning the same logical relationship can have multiple rows differentiated only by time.

2. **Every user action that "changes" a temporal relationship** creates a new row (fromDate=now) and expires the old row (thruDate=now), rather than updating in place.

3. **Data fetching code MUST always use `filterByDate` or `conditionDate`** when querying temporal entities to avoid stale/expired data.

4. **Two patterns exist**: `filterByDate` (post-query, in-memory) and `conditionDate` (query-level, DB-side). The latter is more efficient for large datasets.

5. **The most impactful temporal entities** in the order/return flow are: `GoodIdentification`, `ReturnIdentification`, `OrderIdentification`, `ProductAssoc`, `PartyContactMech`, `ProductStoreFacility`, and `ProdCatalogCategory`.
