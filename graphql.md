# GraphQL (Facebook) (2015)

Tool: Apollo GraphQL

---

## Table of Contents
- [Before: REST API](#before-rest-api)
  - [2 Problems](#2-problems)
    - [1. Overfetching](#1-overfetching)
    - [2. Underfetching](#2-underfetching)
- [Core Concepts of GQL](#core-concepts-of-gql)
  - [1) Schema](#1-schema)
  - [2) Query](#2-query)
  - [3) Resolver](#3-resolver)
  - [4) Mutation](#4-mutation)
  - [5) Subscription](#5-subscription)
- [Flow](#flow)
- [RestAPI](#restapi)
  - [Developer Benefits](#developer-benefits)
- [Summary](#summary)

---

## Before: REST API

### 2 Problems

#### 1. Overfetching

* really want username
* but got user obj.

For much data → slow

#### 2. Underfetching

* want user + its posts + comments
* but need 3 API hits for this.

[Null problem]

Too many trips.

---

## Core Concepts of GQL

### 1) Schema

* contract b/w client and server.
* define every type of data that exists.
* blueprint.

### 2) Query

* how client reads data.
* server responds in the shape.

Example:

```graphql
query {
  user(id: "42") {
    id
    name
  }
}
```

### 3) Resolver

* function that fetches data for any specific field.

Example:

```graphql
const resolver = {
  Query: {
    user: (_, { id }) =>
      db.users.findById(id)
  },

  User: {
    posts: (user) =>
      db.posts.find(user.id)
  }
}
```

### 4) Mutation

* how you write data → create, update, delete.
* like query, but changing data on db.

### 5) Subscription

* client subscribe to an event.
* like websocket but in GQL.

---

## Flow

```text
Client
(send query)
(HTTP POST)
        ↓
Parse
(query string → AST)
        ↓
Validate
(schema check)
        ↓
Execute (Resolvers)
        ↓
Data layer
(DB, RestAPI, Cache...)
        ↓
Response
(JSON with data)
```

---

## RestAPI

* Representational State Transfer
* bridge b/w client & server.
* uses HTTP methods → to perform CRUD operations.

### Developer Benefits

Because the schema is explicitly defined upfront:

- **Tooling can provide autocompletion** for writing queries (e.g., in GraphiQL, Insomnia, Postman).
- The API is **self-documenting** — developers can explore available types and fields directly.
- It's easier to **discover and consume** the API without extensive external documentation.

---

## Summary

| Concept | Key Takeaway |
|---|---|
| **Definition** | A query language + type system for APIs |
| **vs REST** | Single endpoint, no over/under-fetching |
| **Schema** | Defined with `type` keyword; fields and relationships declared |
| **Query** | Used for reading data |
| **Mutation** | Used for writing/modifying data |
| **Tooling** | Schema enables autocompletion and API exploration |

---

*Notes taken from a GraphQL introductory video.*

