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

nock.disableNetConnect();

describe("Credentials", () => {
  const mockTelemetryConfig: TelemetryConfiguration = new TelemetryConfiguration({});

  // Create axios instance with explicit http/https adapter for nock compatibility
  const axiosInstance = axios.create({
    adapter: "http" // Force Node.js http/https adapter that nock can intercept
  });

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

      const scope = nock(baseUrl)
        .post(parsedUrl.pathname + parsedUrl.search)
        .reply(200, {
          access_token: "test-token",
          expires_in: 300,
        });

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
        axiosInstance,
        mockTelemetryConfig,
      );

      await credentials.getAccessTokenHeader();

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
        axiosInstance,
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

      const scope = nock(baseUrl)
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
        axiosInstance,
        mockTelemetryConfig,
      );

      await credentials.getAccessTokenHeader();

      expect(scope.isDone()).toBe(true);
    });
  });
});
