# Google Tasks Authentication Documentation

## OAuth 2.0 with PKCE for Native Applications

This document outlines the authentication implementation for the Google Tasks integration in Obsidian Reminder plugin, focusing on the PKCE (Proof Key for Code Exchange) flow for native applications.

## Table of Contents

- [Overview](#overview)
- [PKCE Implementation](#pkce-implementation)
- [Authentication Flow](#authentication-flow)
- [Native App Considerations](#native-app-considerations)
- [Code Examples](#code-examples)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)
- [Additional Resources](#additional-resources)

## Overview

The Obsidian Reminder plugin uses OAuth 2.0 with PKCE to authenticate with the Google Tasks API. PKCE is an extension to the OAuth 2.0 authorization code flow, designed specifically for public clients that cannot securely store client secrets (like desktop applications).

For a detailed comparison between traditional OAuth and OAuth with PKCE, see [OAuth Flow Comparison](oauth-comparison.md).

## PKCE Implementation

### Code Verifier Generation

A code verifier is a high-entropy cryptographic random string with a length between 43 and 128 characters, using only the following characters:

- Uppercase letters (A-Z)
- Lowercase letters (a-z)
- Digits (0-9)
- `-`, `.`, `_`, `~` (Hyphen, period, underscore, tilde)

Example implementation:

```typescript
function generateCodeVerifier(): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const length = 96; // A length between 43-128 characters
  let result = "";

  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);

  for (let i = 0; i < length; i++) {
    result += characters.charAt(randomValues[i] % characters.length);
  }

  return result;
}
```

### Code Challenge Creation

The code challenge is derived from the code verifier using SHA-256 hashing and Base64-URL encoding:

1. Take the SHA-256 hash of the code verifier
2. Base64-URL encode the hash
3. Remove padding characters (`=`)

Example implementation:

```typescript
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  // Convert the code verifier to a buffer
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);

  // Hash the code verifier using SHA-256
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert to Base64-URL
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashString = hashArray
    .map((byte) => String.fromCharCode(byte))
    .join("");
  const base64 = window.btoa(hashString);

  // Convert Base64 to Base64URL by replacing chars that are invalid in URLs
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

## Authentication Flow

1. **Generate Code Verifier and Challenge**:

   - Create a random code verifier
   - Generate the code challenge from the verifier
   - Store the code verifier securely for later use

2. **Request Authorization**:

   - Redirect user to Google's authorization URL with these parameters:
     - `client_id`: Your app's client ID
     - `redirect_uri`: The callback URL in your app
     - `response_type`: Always "code" for authorization code flow
     - `scope`: Requested API permissions (e.g., "<https://www.googleapis.com/auth/tasks>")
     - `code_challenge`: The generated code challenge
     - `code_challenge_method`: "S256" (indicating SHA-256)
     - `access_type`: "offline" (to receive a refresh token)
     - `prompt`: "consent" (to ensure receiving a refresh token)

3. **Handle Authorization Response**:

   - When Google redirects back to your app, extract the authorization code from the URL
   - Use this code in the next step to get tokens

4. **Exchange Code for Tokens**:

   - Make a POST request to Google's token endpoint with:
     - `client_id`: Your app's client ID
     - `redirect_uri`: Must match the one used in step 2
     - `grant_type`: "authorization_code"
     - `code`: The authorization code from step 3
     - `code_verifier`: The original code verifier from step 1

5. **Store and Use Tokens**:

   - Store the returned access token, refresh token, and expiry information securely
   - Use the access token for API requests
   - Refresh the access token when it expires

6. **Token Refresh Process**:
   - When the access token expires, use the refresh token to get a new one
   - Send a POST request to Google's token endpoint with:
     - `client_id`: Your app's client ID
     - `grant_type`: "refresh_token"
     - `refresh_token`: The stored refresh token

For a visual representation of this flow, see the [PKCE Authentication Flow Diagram](diagrams/pkce-flow.md).

## Native App Considerations

### Redirect URI Handling

In a native application (like Obsidian):

1. **Recommended Approach**: Use a custom URI scheme specific to your application

   - Example: `obsidian-reminder://auth/callback`
   - Ensure your application registers to handle this URI scheme

2. **Alternative**: Use `http://localhost` with a random port

   - The application must run a local web server on this port
   - This approach requires network permissions

3. **Implementation Notes**:
   - In Obsidian plugins, you can use a custom callback handler that works with the plugin's context
   - The plugin needs to monitor for the callback URL being triggered

### Secure Token Storage

1. **Best Practices**:

   - Never store tokens in plain text
   - Use Obsidian's secure storage mechanisms when available
   - Consider encrypting tokens before storing them

2. **Storage Options**:
   - Store in Obsidian plugin data using `this.saveData()`
   - For additional security, consider using platform-specific secure storage APIs when available

### Refresh Token Management

1. **Long-term Storage**:

   - Refresh tokens are meant for long-term use
   - They should persist between sessions
   - Be prepared to handle cases where refresh tokens become invalid

2. **Error Handling**:
   - If a refresh token becomes invalid, prompt the user to re-authenticate
   - Implement proper error handling for token refresh failures

## Code Examples

### Complete Authorization Request

```typescript
async function initiateOAuthFlow() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store code verifier for later use
  localStorage.setItem("codeVerifier", codeVerifier);

  // Build authorization URL
  const authUrl = new URL(`https://accounts.google.com/o/oauth2/v2/auth`);
  authUrl.searchParams.append("client_id", CLIENT_ID);
  authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("scope", `https://www.googleapis.com/auth/tasks`);
  authUrl.searchParams.append("code_challenge", codeChallenge);
  authUrl.searchParams.append("code_challenge_method", "S256");
  authUrl.searchParams.append("access_type", "offline");
  authUrl.searchParams.append("prompt", "consent");

  // Redirect to Google's authorization page
  window.open(authUrl.toString(), "_blank");
}
```

### Token Exchange

```typescript
async function exchangeCodeForTokens(authCode: string) {
  // Retrieve the stored code verifier
  const codeVerifier = localStorage.getItem("codeVerifier");

  if (!codeVerifier) {
    throw new Error("Code verifier not found");
  }

  const tokenRequest = await fetch(`https://oauth2.googleapis.com/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  const tokenData = await tokenRequest.json();

  if (tokenData.error) {
    throw new Error(
      `Token exchange failed: ${tokenData.error_description || tokenData.error}`,
    );
  }

  // Store tokens securely (implement according to best practices)
  securelyStoreTokens({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    tokenType: tokenData.token_type,
  });

  return tokenData;
}
```

### Refresh Access Token

```typescript
async function refreshAccessToken(refreshToken: string) {
  try {
    console.log("Attempting to refresh access token...");

    const response = await fetch(`https://oauth2.googleapis.com/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Token refresh failed:", response.status, errorData);
      throw new Error(
        `Token refresh failed: ${errorData.error_description || "Server responded with status " + response.status}`,
      );
    }

    const tokenData = await response.json();
    console.log("Access token refreshed successfully");

    // Update stored tokens
    return {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      // Some providers return a new refresh token, handle if present
      refreshToken: tokenData.refresh_token || refreshToken,
    };
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw error;
  }
}
```

## Troubleshooting

### Common Authentication Issues

1. **"Invalid grant" errors**:

   - **Cause**: The authorization code was already used or expired
   - **Solution**: Generate a new code by re-initiating the auth flow

2. **"Invalid client" errors**:

   - **Cause**: Client ID is incorrect
   - **Solution**: Verify client ID matches what's registered in Google Cloud Console

3. **"redirect_uri_mismatch" errors**:

   - **Cause**: The redirect URI doesn't match what's registered in Google Cloud Console
   - **Solution**: Ensure the redirect URI exactly matches, including case and trailing slashes

4. **"invalid_request" errors with code_challenge**:
   - **Cause**: Improper PKCE implementation
   - **Solution**: Verify code challenge creation follows the proper format (Base64URL encoding, removal of padding)

### Debugging Tips

1. **Enable verbose logging** during development
2. **Store the complete error response** for analysis
3. **Verify all OAuth parameters** against Google's documentation
4. **Check token expiration logic** to ensure timely refreshes

## Testing

### Development Testing

1. **Mock OAuth Flow**:

   - Create a development-specific redirect handler for testing
   - Consider using a simplified flow for development

2. **Test OAuth Endpoints**:

   - Validate with Google's OAuth Playground (<https://developers.google.com/oauthplayground/>)
   - Test each step of the authentication flow independently

3. **Refresh Token Testing**:
   - Manually expire tokens to test refresh mechanism
   - Verify token persistence between sessions

### Security Considerations for Testing

1. Use a separate OAuth client ID for development/testing
2. Do not commit real tokens to source control
3. Consider implementing a "development mode" with simulated tokens

## Additional Resources

- [PKCE Authentication Flow Diagram](diagrams/pkce-flow.md) - Visual representation of the PKCE authentication flow
- [OAuth Flow Comparison](oauth-comparison.md) - Comparison between traditional OAuth and OAuth with PKCE

---

This documentation covers the essential aspects of implementing OAuth 2.0 with PKCE for the Google Tasks API in a native application context. Refer to [Google's OAuth 2.0 documentation](https://developers.google.com/identity/protocols/oauth2) for additional details on their specific implementation requirements.
