import * as nock from "nock";
import * as jose from "jose";
import axios from "axios";
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

// Ensure nock is active and network connections are disabled
nock.disableNetConnect();
nock.cleanAll();

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

      // Set up nock using just protocol://hostname (no port)
      // Nock will match requests regardless of whether they include the default port
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

      // For non-default ports, we need to include the port
      const fullBaseUrl = parsedUrl.port
        ? `${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port}`
        : baseUrl;

      // Log for debugging CI issues
      if (process.env.CI) {
        console.log(`[TEST] Setting up nock for: ${fullBaseUrl}${parsedUrl.pathname}${parsedUrl.search}`);
        console.log(`[TEST] Active mocks before: ${nock.activeMocks()}`);
      }

      const scope = nock(fullBaseUrl)
        .post(parsedUrl.pathname + parsedUrl.search)
        .reply(200, {
          access_token: "test-token",
          expires_in: 300,
        });

      if (process.env.CI) {
        console.log(`[TEST] Active mocks after: ${nock.activeMocks()}`);
      }

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
        axios, // Use global axios instance that nock can intercept
        mockTelemetryConfig,
      );

      try {
        await credentials.getAccessTokenHeader();

        if (process.env.CI) {
          console.log(`[TEST] Request succeeded. Scope done: ${scope.isDone()}`);
        }
      } catch (error: any) {
        if (process.env.CI) {
          console.error(`[TEST] Request failed: ${error.message}`);
          console.error(`[TEST] Pending mocks: ${nock.pendingMocks()}`);
          console.error(`[TEST] Active mocks: ${nock.activeMocks()}`);
        }
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
        axios, // Use global axios instance that nock can intercept
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

      // Set up nock using just protocol://hostname (no port)
      // Nock will match requests regardless of whether they include the default port
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

      // For non-default ports, we need to include the port
      const fullBaseUrl = parsedUrl.port
        ? `${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port}`
        : baseUrl;

      // Log for debugging CI issues
      if (process.env.CI) {
        console.log(`[TEST JWT] Setting up nock for: ${fullBaseUrl}${parsedUrl.pathname}`);
        console.log(`[TEST JWT] Active mocks before: ${nock.activeMocks()}`);
      }

      const scope = nock(fullBaseUrl)
        .post(parsedUrl.pathname, (body: string) => {
          const params = new URLSearchParams(body);
          const clientAssertion = params.get("client_assertion") as string;
          const decoded = jose.decodeJwt(clientAssertion);
          expect(decoded.aud).toBe(`${expectedAudience}`);
          return true;
        })
        .reply(200, {
          access_token: "test-token",
          expires_in: 300,
        });

      if (process.env.CI) {
        console.log(`[TEST JWT] Active mocks after: ${nock.activeMocks()}`);
      }

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
        axios, // Use global axios instance that nock can intercept
        mockTelemetryConfig,
      );

      try {
        await credentials.getAccessTokenHeader();

        if (process.env.CI) {
          console.log(`[TEST JWT] Request succeeded. Scope done: ${scope.isDone()}`);
        }
      } catch (error: any) {
        if (process.env.CI) {
          console.error(`[TEST JWT] Request failed: ${error.message}`);
          console.error(`[TEST JWT] Pending mocks: ${nock.pendingMocks()}`);
          console.error(`[TEST JWT] Active mocks: ${nock.activeMocks()}`);
        }
        throw error;
      }

      expect(scope.isDone()).toBe(true);
    });
  });
});
