# PKCE Authentication Flow Diagram

Below is a visualization of the OAuth 2.0 PKCE authentication flow as implemented in the Obsidian Reminder plugin.

```mermaid
sequenceDiagram
    participant User
    participant Plugin as Obsidian Plugin
    participant Browser
    participant Google as Google OAuth Server
    participant API as Google Tasks API

    Note over Plugin: Generate code_verifier
    Note over Plugin: Generate code_challenge from code_verifier using SHA-256

    Plugin->>Plugin: Store code_verifier
    Plugin->>Browser: Open authorization URL with<br/>code_challenge + client_id + redirect_uri
    Browser->>Google: Authorization request
    Google->>User: Present consent screen
    User->>Google: Grant permissions
    Google->>Browser: Redirect with authorization code
    Browser->>Plugin: Return authorization code

    Plugin->>Google: POST token request with<br/>code + code_verifier + client_id
    Note over Google: Verify code_challenge matches<br/>the code_verifier
    Google->>Plugin: Return tokens (access_token, refresh_token)

    Plugin->>Plugin: Securely store tokens

    Plugin->>API: API request with access_token
    API->>Plugin: API response

    Note over Plugin: When access_token expires

    Plugin->>Google: POST refresh token request with<br/>refresh_token + client_id
    Google->>Plugin: Return new access_token

    Plugin->>Plugin: Update stored access_token
    Plugin->>API: Continue API requests with new access_token
```

## Key Security Benefits of PKCE

1. **Protection against Authorization Code Interception**:

   - Even if an attacker intercepts the authorization code, they cannot exchange it for tokens without the code_verifier
   - Only the legitimate app has the original code_verifier

2. **Public Client Security**:

   - Eliminates the need for client secrets in native apps
   - Provides a secure authentication mechanism for clients that cannot protect secrets

3. **Protection against CSRF and Authorization Code Injection**:
   - The code_challenge/code_verifier pair acts as a strong state binding mechanism
   - Prevents attackers from injecting their own authorization codes
