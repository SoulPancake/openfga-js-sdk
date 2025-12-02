# Debug Logging for CI Test Failures

## Overview

Extensive debug logging has been added to help diagnose the credential test failures in CI environments. The logging is automatically enabled when `NODE_ENV=test` or when running in CI (`process.env.CI` is set).

## What's Been Added

### 1. Test File Logging (`tests/credentials.test.ts`)

Each failing test now logs:
- Input `apiTokenIssuer` value
- Expected URL that should be requested
- Parsed URL components (protocol, hostname, host, port, pathname, search)
- Nock setup details (baseUrl, path, full mock URL)
- Active nock interceptors before and after scope creation
- Request success/failure status
- Scope completion status
- Remaining/pending mocks

**Example output:**
```
=== Token Refresh Test Debug Info ===
Input apiTokenIssuer: issuer.fga.example
Expected URL: https://issuer.fga.example/oauth/token
Parsed URL details:
  - protocol: https:
  - hostname: issuer.fga.example
  - host: issuer.fga.example
  - port:
  - pathname: /oauth/token
  - search:
Nock setup:
  - baseUrl: https://issuer.fga.example:443
  - path: /oauth/token
  - full mock URL: https://issuer.fga.example:443/oauth/token
Active nock interceptors: []
Nock scope created, active mocks: [ 'POST https://issuer.fga.example:443/oauth/token' ]
```

### 2. Credentials Service Logging (`credentials/credentials.ts`)

The `buildApiTokenUrl` method logs:
- Input `apiTokenIssuer`
- Normalized URL (after adding https:// prefix)
- URL object details (protocol, hostname, host, port, pathname, search)
- Final URL returned by `url.toString()`

The `refreshAccessToken` method logs:
- The URL being requested
- HTTP method
- Request payload keys (without sensitive values)

**Example output:**
```
[Credentials.buildApiTokenUrl] Debug info:
  Input apiTokenIssuer: issuer.fga.example
  Normalized: https://issuer.fga.example
  URL object details:
    - protocol: https:
    - hostname: issuer.fga.example
    - host: issuer.fga.example
    - port:
    - pathname: /oauth/token
    - search:
  Final URL (toString): https://issuer.fga.example/oauth/token

[Credentials.refreshAccessToken] About to make request:
  URL: https://issuer.fga.example/oauth/token
  Method: POST
  Payload keys: [ 'client_id', 'client_secret', 'audience', 'grant_type' ]
```

### 3. HTTP Request Logging (`common.ts`)

The `attemptHttpRequest` function logs:
- Request URL
- HTTP method
- Base URL (if set)
- Request headers
- Success/failure status
- Error details (code, message, response status)

**Example output:**
```
[attemptHttpRequest] Request config:
  URL: https://issuer.fga.example/oauth/token
  Method: POST
  BaseURL: undefined
  Headers: {
    "Content-Type": "application/x-www-form-urlencoded"
  }
[attemptHttpRequest] Request succeeded!
```

## Key Insights from Logs

The logs revealed the ACTUAL issue (confirmed from CI):

1. **Nock mock was set up with**: `POST https://issuer.fga.example:443/oauth/token` (with explicit port `:443`)
2. **Actual axios request**: `https://issuer.fga.example/oauth/token` (WITHOUT port, because it's default)
3. **Nock interceptor sees**: `"issuer.fga.example:443/oauth/token"` (hostname WITH port in the connection string)

The mismatch occurs because:
- Node.js's `URL.toString()` **omits** default ports (443 for HTTPS, 80 for HTTP)
- Axios passes the URL without the port to the HTTP library
- But internally, the HTTP connection is made to `hostname:443`
- Nock's interceptor captures this as `"issuer.fga.example:443/oauth/token"`
- When nock base URL includes `:443`, it doesn't match because nock is looking for `"issuer.fga.example:443:443/oauth/token"` (double port!)

## Solution

**DO NOT include default ports in the nock base URL**. Only include ports when they are non-default.

```typescript
let baseUrl;
if (parsedUrl.port) {
  // Non-default port: include it
  baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port}`;
} else {
  // Default port: omit it to match axios behavior
  baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
}
```

This way:
- For `https://example.com/path`: nock base = `https://example.com` → matches `"example.com:443/path"`
- For `https://example.com:8080/path`: nock base = `https://example.com:8080` → matches `"example.com:8080/path"`

## Using the Logs

When tests fail in CI:

1. Look for the log sections marked with `===` or `[MethodName]`
2. Compare the "Nock setup" URL with the "Final URL (toString)" 
3. Check the "Active nock interceptors" to see what nock is expecting
4. Compare with the actual request being made in `[attemptHttpRequest]`
5. Look for any "NetConnectNotAllowedError" messages to see what URL nock couldn't match

## Next Steps

Based on the CI logs, we can:
1. Determine if the issue is port-related (default ports being included/excluded)
2. See if there are differences in how URLs are constructed between local and CI
3. Adjust the nock matching strategy accordingly
4. Consider using more flexible nock matchers if needed

## Cleanup

Once the issue is resolved, you can:
1. Remove the debug logging by reverting changes to:
   - `tests/credentials.test.ts`
   - `credentials/credentials.ts`
   - `common.ts`
2. Or keep minimal logging for production debugging (guard with `process.env.DEBUG`)

