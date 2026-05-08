# SSO (Single Sign-On)

SSO allows users to log in once with a single set of credentials and gain access to multiple applications or services without again-n-again login.

---

## ➤ Flow: First Login

```
User → Gmail → Google IdP (Identity Provider)
                    ↓
          User enters password
                    ↓
          IdP gives token for Gmail
  (creates session and sets session-cookie in browser)
```

---

## ➤ Second App Login

```
User → Drive → Google IdP (sees cookie, no login needed)
                    ↓
          Generates new token
                    ↓
          Drive (login automatically)
```

---

## ➤ IdPs (Identity Providers)

| Provider        | Type                        |
|-----------------|-----------------------------|
| Azure AD        | Protocol                    |
| Okta            | Identity-as-a-Service (IDaaS) |
| Google Identity | Protocol                    |
| Auth0           | IDaaS                       |
| OneLogin        | IDaaS                       |

---

## ➤ SP (Service Providers)

- Salesforce
- Slack
- Gmail

---

## ➤ Authentication Protocols

| Protocol         | Description                                      |
|------------------|--------------------------------------------------|
| SAML 2.0         | XML based – enterprise standard                  |
| OAuth 2.0        | Token based authorization                        |
| OpenID Connect   | Built on OAuth 2.0, adds authentication          |