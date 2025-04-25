# OAuth Flow Comparison: Traditional vs. PKCE

This document compares the traditional OAuth 2.0 flow with the PKCE-enhanced OAuth flow for native applications like the Obsidian Reminder plugin.

## Comparison Table

| Feature                         | Traditional OAuth                     | OAuth with PKCE                       | Benefit                                                                               |
| ------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| **Client Secret**               | Required                              | Not required                          | Eliminates the security risk of embedding a client secret in native app code          |
| **Authorization Code Security** | Vulnerable to interception            | Protected by code_verifier            | Even if authorization code is intercepted, it can't be used without the code_verifier |
| **Front Channel Security**      | Lower                                 | Higher                                | The authorization code is bound to the original client via the code_challenge         |
| **CSRF Protection**             | Requires state parameter              | Enhanced with code_challenge/verifier | More robust protection against cross-site request forgery                             |
| **Implementation Complexity**   | Simpler                               | Slightly more complex                 | Additional steps for code_verifier generation and code_challenge creation             |
| **Token Exchange**              | Client ID + Client Secret + Auth Code | Client ID + Auth Code + Code Verifier | The code_verifier serves as proof of the client's identity                            |
| **Suitability for Native Apps** | Poor (client secret can be extracted) | Excellent                             | Designed specifically for public clients like native apps                             |
| **Server Trust Requirement**    | Higher                                | Lower                                 | Server doesn't need to trust the client based on a shared secret                      |

## Visual Comparison

### Traditional OAuth Flow

```
+--------+                               +---------------+
|        |--(A)- Authorization Request ->|   Resource    |
|        |                               |     Owner     |
|        |<-(B)-- Authorization Grant ---|               |
|        |                               +---------------+
|        |
|        |                               +---------------+
|        |--(C)-- Authorization Grant -->| Authorization |
| Client |                               |     Server    |
|        |<-(D)----- Access Token -------|               |
|        |                               +---------------+
|        |
|        |                               +---------------+
|        |--(E)----- Access Token ------>|    Resource   |
|        |                               |     Server    |
|        |<-(F)--- Protected Resource ---|               |
+--------+                               +---------------+
```

### OAuth with PKCE

```
+--------+                                           +---------------+
|        |--(A)- Authorization Request + code_challenge ->|   Resource    |
|        |                                           |     Owner     |
|        |<-(B)-- Authorization Grant ----------------|               |
|        |                                           +---------------+
|        |
|        |                                           +---------------+
|        |--(C)-- Authorization Grant + code_verifier->| Authorization |
| Client |                                           |     Server    |
|        |<-(D)----- Access Token ---------------------|               |
|        |                                           +---------------+
|        |
|        |                                           +---------------+
|        |--(E)----- Access Token ------------------>|    Resource   |
|        |                                           |     Server    |
|        |<-(F)--- Protected Resource ---------------|               |
+--------+                                           +---------------+
```

## Key Differences Explained

### 1. Initial Authorization Request

**Traditional OAuth:**

- Client redirects to authorization server with client_id and redirect_uri
- No additional security parameters required

**OAuth with PKCE:**

- Client generates a code_verifier (random string)
- Client creates a code_challenge by hashing the code_verifier
- Client redirects to authorization server with client_id, redirect_uri, and code_challenge

### 2. Token Exchange

**Traditional OAuth:**

- Client sends authorization code, client_id, and client_secret to token endpoint
- Security relies on keeping client_secret confidential (problematic for native apps)

**OAuth with PKCE:**

- Client sends authorization code, client_id, and code_verifier to token endpoint
- Server computes challenge from verifier and compares to original challenge
- Security relies on the verifier only being known to the legitimate client

### 3. Security Model

**Traditional OAuth:**

- For confidential clients (with backend): Effective and secure
- For public clients (native apps): Security weaknesses due to inability to protect client_secret

**OAuth with PKCE:**

- Designed specifically for public clients
- Eliminates need for client_secret in native apps
- Protects against authorization code interception attacks
- Maintains high security even when code is exposed through reverse engineering

## Why PKCE is Essential for the Obsidian Reminder Plugin

The Obsidian Reminder plugin is a native application that cannot securely store a client secret. Using traditional OAuth would pose the following risks:

1. A malicious actor could extract the client secret from the plugin's code
2. Authorization codes could be intercepted and used to obtain tokens

By implementing PKCE:

1. No client secret is needed in the plugin's code
2. Even if authorization codes are intercepted, they cannot be used without the code_verifier
3. The plugin can securely authenticate with the Google Tasks API

This approach aligns with OAuth 2.0 best practices and Google's recommendations for native applications.
