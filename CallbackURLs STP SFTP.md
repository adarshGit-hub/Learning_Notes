# 📘 Callback URL, FTP & SFTP Notes

---

## 🔁 Callback URL

You already know webhooks from a previous lesson. A **callback URL** is essentially the same idea at the core — but it's a broader, more general pattern used in many different contexts.

### Definition
A callback URL is a URL you provide to a third party saying:

> "When you're done with something, hit this URL and tell me the result."

The third party does their work **asynchronously**, and when finished, makes an **HTTP request** to your callback URL with the outcome.

### 💡 Key Insight
Your system:
- Does **not wait**
- Does **not poll**
- Continues doing other tasks

The third party:
- Completes the task
- Calls you back with the result

### Common Scenarios
- OAuth Login  
- Payment Gateway  
- Async Jobs  

---

## 📂 FTP — File Transfer Protocol

Understanding FTP requires knowing one unusual design choice:

It uses **two separate TCP connections simultaneously**

###  How FTP Works
- One connection → **Commands (Control)**
- One connection → **Data Transfer**

Most protocols use **one connection**, but FTP uses **two**, which led to complications.

### Problems with FTP
- Causes issues with **firewalls**
- Introduces **Active vs Passive mode complexity**

####  Major Security Flaw
> Everything is sent in **plain text**

This includes:
- Username  
- Password  
- File contents  

Anyone on the same network can intercept and read everything.

**Conclusion:** FTP should NOT be used for sensitive data.

---

## 🔐 SFTP — SSH File Transfer Protocol

SFTP is **not "FTP with SSL"** (that is FTPS, a different protocol).

SFTP is a completely different protocol built as a **subsystem of SSH**.

###  What SFTP Fixes
- Uses a **single connection**
- Fully **encrypted**
- Firewall-friendly
- No active/passive mode complexity

---

## FTP vs SFTP Comparison

| Feature | FTP | SFTP |
|--------|-----|------|
| **Ports** | Port 21 (control) + Port 20 / random (data) | Port 22 only |
| **Connections** | Two separate TCP connections | Single TCP connection |
| **Authentication** | Username + Password only | Password or SSH key pair |
| **Security** | Plain text (unencrypted) | Fully encrypted |
| **Modes** | Active vs Passive complexity | No such complexity |
| **Firewall Compatibility** | Difficult (especially active mode) | Simple (single port) |

---

## Final Takeaways

- **Callback URLs** enable async communication without polling  
- **FTP is outdated and insecure** due to plain-text transmission  
- **SFTP is the modern, secure alternative**, built on SSH  

---