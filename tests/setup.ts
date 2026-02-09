import * as nock from "nock";

/**
 * Global Jest lifecycle hooks for nock 15 (beta) compatibility.
 *
 * ### Why this is needed
 *
 * Nock 15 switched from monkey-patching Node's `http.request` /
 * `http.ClientRequest` to using `@mswjs/interceptors`, which installs a
 * **process-level** `BatchInterceptor` (see `nock/lib/interceptors/builtin.js`).
 * That interceptor hooks into Node's HTTP stack once and forwards every
 * outgoing request to nock's `handleRequest` function, which in turn calls
 * `interceptorsFor()` from `nock/lib/intercept.js` to find matching mocks.
 *
 * Jest runs each test **file** in its own module sandbox but—when workers are
 * reused—multiple files execute in the **same** Node process.  The first file
 * that `import`s nock triggers `activate()`, which applies the
 * `BatchInterceptor`.  When a second file is loaded in the same worker, Node's
 * `require` cache returns the *original* nock module (the interceptor is
 * already applied), but Jest's module sandbox may have cleared the bindings
 * that the interceptor's `request` handler relies on (specifically the
 * `interceptorsFor` function reference inside `handleRequest`).  This causes
 * the `TypeError: interceptorsFor is not a function` error.
 *
 * ### How the fix works
 *
 * - **`afterAll → nock.restore()`** calls `interceptor.dispose()` on the
 *   `@mswjs/interceptors` `BatchInterceptor`, removing it from Node's HTTP
 *   stack entirely.  This ensures the stale handler that references
 *   now-sandboxed module bindings is no longer active.
 *
 * - **`beforeAll → nock.activate()`** re-applies a fresh `BatchInterceptor`
 *   that captures the *current* sandbox's `interceptorsFor` binding, so
 *   request matching works correctly for the new test file.
 *
 * - **`afterAll → nock.cleanAll()`** removes any leftover interceptor
 *   definitions so one suite's mocks never leak into the next.
 *
 * Together this gives every test file a clean nock lifecycle:
 *   activate → run tests → cleanAll + restore
 */

beforeAll(() => {
  if (!nock.isActive()) {
    nock.activate();
  }
});

afterAll(() => {
  nock.cleanAll();
  nock.restore();
});
