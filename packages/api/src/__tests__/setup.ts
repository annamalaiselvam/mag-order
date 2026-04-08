import { vi } from "vitest";

// Mock environment variables before any module loads
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.TWILIO_ACCOUNT_SID = "ACtest123";
process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
process.env.TWILIO_PHONE_NUMBER = "+15551234567";
process.env.ANTHROPIC_API_KEY = "test_anthropic_key";
process.env.DEEPGRAM_API_KEY = "test_deepgram_key";
process.env.BASE_URL = "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.PORT = "0";

// Create a chainable mock DB that resolves as a thenable at any point in the chain.
// When awaited, it resolves with the value set by _nextResult (default []).
// Individual tests can set mockDb._nextResult before the request to control output.
function createChainableMock() {
  let nextResults: any[][] = [];

  const handler: ProxyHandler<any> = {
    get(target, prop) {
      // Allow setting next results for sequential calls
      if (prop === "_pushResult") {
        return (val: any) => nextResults.push(val);
      }
      if (prop === "_clearResults") {
        return () => { nextResults = []; };
      }

      // Make it thenable — when awaited, resolve with next result
      if (prop === "then") {
        const result = nextResults.length > 0 ? nextResults.shift() : [];
        return (resolve: (v: any) => void, reject: (e: any) => void) => {
          resolve(result);
        };
      }

      // For any method call, return the proxy itself to support chaining
      return (..._args: any[]) => proxy;
    },
    apply() {
      return proxy;
    },
  };

  const proxy = new Proxy(function () {}, handler);
  return proxy;
}

const mockDb = createChainableMock();

vi.mock("../db/index.js", () => {
  return { db: mockDb };
});
