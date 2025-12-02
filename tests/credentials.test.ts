import * as nock from "nock";
import * as jose from "jose";
import { Credentials, CredentialsMethod, DEFAULT_TOKEN_ENDPOINT_PATH } from "../credentials";
import { AuthCredentialsConfig } from "../credentials/types";
import { TelemetryConfiguration } from "../telemetry/configuration";
import {
  OPENFGA_API_AUDIENCE,
  OPENFGA_CLIENT_ASSERTION_SIGNING_KEY,
  OPENFGA_CLIENT_ID,
  OPENFGA_CLIENT_SECRET,
} from "./helpers/default-config";
import {FgaValidationError} from "../errors";

nock.disableNetConnect();

describe("Credentials", () => {
  const mockTelemetryConfig: TelemetryConfiguration = new TelemetryConfiguration({});

  describe("Refreshing access token", () => {
    afterEach(() => {
      nock.cleanAll();
    });

    test.each([
      {
        description: "should use default scheme and token endpoint path when apiTokenIssuer has no scheme and no path",
        apiTokenIssuer: "issuer.fga.example",
        expectedUrl: `https://issuer.fga.example/${DEFAULT_TOKEN_ENDPOINT_PATH}`,
      },
      {
        description: "should use default token endpoint path when apiTokenIssuer has root path and no scheme",
        apiTokenIssuer: "https://issuer.fga.example/",
        expectedUrl: `https://issuer.fga.example/${DEFAULT_TOKEN_ENDPOINT_PATH}`,
      },
      {
        description: "should preserve custom token endpoint path when provided",
        apiTokenIssuer: "https://issuer.fga.example/some_endpoint",
        expectedUrl: "https://issuer.fga.example/some_endpoint",
      },
      {
        description: "should preserve custom token endpoint path with nested path when provided",
        apiTokenIssuer: "https://issuer.fga.example/api/v1/oauth/token",
        expectedUrl: "https://issuer.fga.example/api/v1/oauth/token",
      },
      {
        description: "should add https:// prefix when apiTokenIssuer has no scheme",
        apiTokenIssuer: "issuer.fga.example/some_endpoint",
        expectedUrl: "https://issuer.fga.example/some_endpoint",
      },
      {
        description: "should preserve http:// scheme when provided",
        apiTokenIssuer: "http://issuer.fga.example/some_endpoint",
        expectedUrl: "http://issuer.fga.example/some_endpoint",
      },
      {
        description: "should use default path when apiTokenIssuer has https:// scheme but no path",
        apiTokenIssuer: "https://issuer.fga.example",
        expectedUrl: `https://issuer.fga.example/${DEFAULT_TOKEN_ENDPOINT_PATH}`,
      },
      {
        description: "should preserve custom path with query parameters",
        apiTokenIssuer: "https://issuer.fga.example/some_endpoint?param=value",
        expectedUrl: "https://issuer.fga.example/some_endpoint?param=value",
      },
      {
        description: "should preserve custom path with port number",
        apiTokenIssuer: "https://issuer.fga.example:8080/some_endpoint",
        expectedUrl: "https://issuer.fga.example:8080/some_endpoint",
      },
      {
        description: "should use default path when path has multiple trailing slashes",
        apiTokenIssuer: "https://issuer.fga.example///",
        expectedUrl: `https://issuer.fga.example/${DEFAULT_TOKEN_ENDPOINT_PATH}`,
      },
      {
        description: "should use default path when path only consists of slashes",
        apiTokenIssuer: "https://issuer.fga.example//",
        expectedUrl: `https://issuer.fga.example/${DEFAULT_TOKEN_ENDPOINT_PATH}`,
      },
      {
        description: "should preserve custom path with consecutive/trailing slashes",
        apiTokenIssuer: "https://issuer.fga.example/oauth//token///",
        expectedUrl: "https://issuer.fga.example/oauth//token///",
      },
    ])("$description", async ({ apiTokenIssuer, expectedUrl }) => {
      const parsedUrl = new URL(expectedUrl);

      // IMPORTANT: In Node.js 20 and earlier, nock's @mswjs/interceptors sees requests
      // with explicit default ports (443 for HTTPS, 80 for HTTP).
      // We must include the port in the nock base URL to match what the interceptor sees.
      let baseUrl;
      if (parsedUrl.port) {
        // Non-default port: include it
        baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port}`;
      } else {
        // Default port: include it explicitly to match what nock's interceptor sees
        const defaultPort = parsedUrl.protocol === "https:" ? "443" : "80";
        baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}:${defaultPort}`;
      }

      // Extensive logging for CI debugging
      console.log("=== Token Refresh Test Debug Info ===");
      console.log("Input apiTokenIssuer:", apiTokenIssuer);
      console.log("Expected URL:", expectedUrl);
      console.log("Parsed URL details:");
      console.log("  - protocol:", parsedUrl.protocol);
      console.log("  - hostname:", parsedUrl.hostname);
      console.log("  - host:", parsedUrl.host);
      console.log("  - port:", parsedUrl.port);
      console.log("  - pathname:", parsedUrl.pathname);
      console.log("  - search:", parsedUrl.search);
      console.log("Nock setup:");
      console.log("  - baseUrl:", baseUrl);
      console.log("  - path:", parsedUrl.pathname + parsedUrl.search);
      console.log("  - full mock URL:", baseUrl + parsedUrl.pathname + parsedUrl.search);
      console.log("Active nock interceptors:", nock.activeMocks());

      const scope = nock(baseUrl)
        .post(parsedUrl.pathname + parsedUrl.search)
        .reply(200, {
          access_token: "test-token",
          expires_in: 300,
        });

      console.log("Nock scope created, active mocks:", nock.activeMocks());

      const credentials = new Credentials(
        {
          method: CredentialsMethod.ClientCredentials,
          config: {
            apiTokenIssuer,
            apiAudience: OPENFGA_API_AUDIENCE,
            clientId: OPENFGA_CLIENT_ID,
            clientSecret: OPENFGA_CLIENT_SECRET,
          },
        } as AuthCredentialsConfig,
        undefined,
        mockTelemetryConfig,
      );

      try {
        await credentials.getAccessTokenHeader();
        console.log("Request succeeded!");
        console.log("Scope done?", scope.isDone());
        console.log("Remaining active mocks:", nock.activeMocks());
      } catch (error) {
        console.error("Request failed with error:", error);
        console.error("Nock pending mocks:", nock.pendingMocks());
        console.error("Nock active mocks:", nock.activeMocks());
        throw error;
      }

      expect(scope.isDone()).toBe(true);
    });

    test.each([
      {
        description: "malformed url",
        apiTokenIssuer: "not a valid url::::",
      },
      {
        description: "empty string",
        apiTokenIssuer: "",
      },
      {
        description: "whitespace-only issuer",
        apiTokenIssuer: "   ",
      },
    ])("should throw FgaValidationError when $description", ({ apiTokenIssuer }) => {
      expect(() => new Credentials(
        {
          method: CredentialsMethod.ClientCredentials,
          config: {
            apiTokenIssuer,
            apiAudience: OPENFGA_API_AUDIENCE,
            clientId: OPENFGA_CLIENT_ID,
            clientSecret: OPENFGA_CLIENT_SECRET,
          },
        } as AuthCredentialsConfig,
        undefined,
        mockTelemetryConfig,
      )).toThrow(FgaValidationError);
    });

    test.each([
      {
        description: "HTTPS scheme",
        apiTokenIssuer: "https://issuer.fga.example/some_endpoint",
        expectedUrl: "https://issuer.fga.example/some_endpoint",
        expectedAudience: "https://issuer.fga.example/some_endpoint/",
      },
      {
        description: "HTTP scheme",
        apiTokenIssuer: "http://issuer.fga.example/some_endpoint",
        expectedUrl: "http://issuer.fga.example/some_endpoint",
        expectedAudience: "http://issuer.fga.example/some_endpoint/",
      },
      {
        description: "No scheme",
        apiTokenIssuer: "issuer.fga.example/some_endpoint",
        expectedUrl: "https://issuer.fga.example/some_endpoint",
        expectedAudience: "https://issuer.fga.example/some_endpoint/",
      }
    ])("should normalize audience from apiTokenIssuer when using PrivateKeyJWT client credentials ($description)", async ({ apiTokenIssuer, expectedUrl, expectedAudience }) => {
      const parsedUrl = new URL(expectedUrl);

      // IMPORTANT: In Node.js 20 and earlier, nock's @mswjs/interceptors sees requests
      // with explicit default ports (443 for HTTPS, 80 for HTTP).
      // We must include the port in the nock base URL to match what the interceptor sees.
      let baseUrl;
      if (parsedUrl.port) {
        // Non-default port: include it
        baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port}`;
      } else {
        // Default port: include it explicitly to match what nock's interceptor sees
        const defaultPort = parsedUrl.protocol === "https:" ? "443" : "80";
        baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}:${defaultPort}`;
      }

      // Extensive logging for CI debugging
      console.log("=== PrivateKeyJWT Test Debug Info ===");
      console.log("Input apiTokenIssuer:", apiTokenIssuer);
      console.log("Expected URL:", expectedUrl);
      console.log("Expected audience:", expectedAudience);
      console.log("Parsed URL details:");
      console.log("  - protocol:", parsedUrl.protocol);
      console.log("  - hostname:", parsedUrl.hostname);
      console.log("  - host:", parsedUrl.host);
      console.log("  - port:", parsedUrl.port);
      console.log("  - pathname:", parsedUrl.pathname);
      console.log("Nock setup:");
      console.log("  - baseUrl:", baseUrl);
      console.log("  - path:", parsedUrl.pathname);
      console.log("  - full mock URL:", baseUrl + parsedUrl.pathname);
      console.log("Active nock interceptors:", nock.activeMocks());

      const scope = nock(baseUrl)
        .post(parsedUrl.pathname, (body: string) => {
          console.log("Nock interceptor body matcher called with body:", body);
          const params = new URLSearchParams(body);
          const clientAssertion = params.get("client_assertion") as string;
          const decoded = jose.decodeJwt(clientAssertion);
          console.log("Decoded JWT audience:", decoded.aud);
          expect(decoded.aud).toBe(`${expectedAudience}`);
          return true;
        })
        .reply(200, {
          access_token: "test-token",
          expires_in: 300,
        });

      console.log("Nock scope created, active mocks:", nock.activeMocks());

      const credentials = new Credentials(
        {
          method: CredentialsMethod.ClientCredentials,
          config: {
            apiTokenIssuer,
            apiAudience: OPENFGA_API_AUDIENCE,
            clientId: OPENFGA_CLIENT_ID,
            clientAssertionSigningKey: OPENFGA_CLIENT_ASSERTION_SIGNING_KEY,
          },
        } as AuthCredentialsConfig,
        undefined,
        mockTelemetryConfig,
      );

      try {
        await credentials.getAccessTokenHeader();
        console.log("Request succeeded!");
        console.log("Scope done?", scope.isDone());
        console.log("Remaining active mocks:", nock.activeMocks());
      } catch (error) {
        console.error("Request failed with error:", error);
        console.error("Nock pending mocks:", nock.pendingMocks());
        console.error("Nock active mocks:", nock.activeMocks());
        throw error;
      }

      expect(scope.isDone()).toBe(true);
    });
  });
});
