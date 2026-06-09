# 📚 Learning Notes & Technical Guides

Welcome to this engineering learning notes repository. It serves as a centralized wiki and reference for key backend integration patterns, system architectures, and framework deep-dives.

A static portal site is compiled from these files using [build.js](build.js) and is outputted to the `_site/` directory.

---

## 🗺️ Topic Catalog

### 🛍️ Shopify Integration
Comprehensive reference materials for connecting external systems (such as HotWax OMS) with Shopify.
- **[Shopify Backend Integration Guide](notes/shopify-backend-integration-guide.html)**: Deep dive into GraphQL API usage, Webhook subscription patterns, HMAC verification, cost-based rate limiting, and delivery reliability.
- **[Shopify API Guide](notes/shopify-api-guide.html)**: Quick-reference overview of Shopify Admin API interfaces, authentication, and core constraints.
- **[Shopify JSON Mapping](notes/shopifyJsonMapping.md)**: Data mapping guidelines for syncing orders, inventory, and fulfillment payloads with HotWax systems.

### ⚛️ GraphQL
- **[GraphQL Concepts](notes/graphql.md)**: Introduction to queries, mutations, schemas, and differences compared to REST.

### ⚡ gRPC & Microservices
- **[Microservices & Communication](notes/microServices%20%26%20communication.md)**: Distributed messaging, event-driven architectures, and communication patterns.
- **[gRPC Technical Guide](notes/gRPC.md)**: Detailed dive into HTTP/2 transport, Protocol Buffers, service definitions, and stream types.

### 🛡️ Security & Auth
- **[SSO (Single Sign-On)](notes/SSO.md)**: Security patterns, authentication flows, SAML, and OAuth mechanisms.

### 🔔 Webhooks
- **[Webhooks Overview](notes/webhooks.md)**: Introduction to HTTP push delivery, common failure modes, and retry architectures.

### 🔌 Integrations
- **[Callback URLs & STP/SFTP File Transfers](notes/CallbackURLs%20STP%20SFTP.md)**: Standard protocols for file transfer workflows and webhook callbacks.

### ⚙️ Infrastructure & Frameworks
- **[Moqui Architecture Deep Dive](notes/moqui_architecture_deep_dive.md)**: Comprehensive architectural breakdown of the Moqui ecosystem, including database mapping (Entity Engine), the Service Engine, Screen rendering, and performance optimizations.
- **[Quartz Scheduler & OS Concepts](notes/quartzScheduler-OS.md)**: Mapping Quartz scheduler logic to core operating system process scheduling concepts.

---

## 🛠️ Static Site Compilation

This project compiles these documents into a unified HTML dashboard:

```bash
# Install dependencies (Marked)
npm install

# Build static site
npm run build
```

The output compiles into the `_site/` directory, including custom search indices and cross-linking sidebars.
