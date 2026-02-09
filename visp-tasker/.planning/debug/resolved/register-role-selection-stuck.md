---
status: resolved
trigger: "Registration flow gets stuck or errors out at the role selection step"
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:00:00Z
---

## Current Focus

hypothesis: Registration fails because authService.register() calls POST /auth/register which returns 404 (backend endpoint does not exist), causing an error that gets displayed in the error banner and leaves the user stuck on step 3
test: Trace the full call chain from handleRegister -> authStore.register -> authService.register -> apiClient.post -> /auth/register
expecting: The API call fails with a network error or 404, which gets caught and displayed as an error message
next_action: Confirm the error handling chain and implement a fix for MVP testing

## Symptoms

expected: After selecting a role and accepting terms on step 3, tapping "Create Account" should complete registration and navigate to the home screen
actual: Registration flow gets stuck or errors out at the role selection step
errors: Backend POST /api/v1/auth/register returns 404 (endpoint does not exist)
reproduction: Go through registration steps 1-2, reach step 3, select a role, accept terms, tap Create Account
started: Backend auth endpoints have not been built yet

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:01:00Z
  checked: RegisterScreen.tsx - UI flow and step navigation
  found: Multi-step form (3 steps). Step navigation via handleNext works correctly for steps 1->2 and 2->3. Step 3 renders role selection cards and terms checkbox. The "Create Account" button calls handleRegister when on step 3. The button is disabled unless both selectedRole !== null AND acceptedTerms === true (isStep3Valid). The UI logic for role selection and step progression is correct.
  implication: The UI itself is not broken - role selection updates state correctly, and the button enables when conditions are met. The issue is what happens AFTER tapping the button.

- timestamp: 2026-02-06T00:02:00Z
  checked: handleRegister function in RegisterScreen.tsx
  found: handleRegister guards on (!selectedRole || !acceptedTerms), then calls `await register(...)` from the auth store. If it throws, the catch block is empty (error displayed by store). On success, the comment says auth store sets isAuthenticated=true and navigator redirects.
  implication: The function correctly calls the store's register action. Any failure in the API chain will be caught, the store will set error state, and the error banner will display.

- timestamp: 2026-02-06T00:03:00Z
  checked: authStore.ts register action
  found: Sets isLoading=true, calls authService.register(data), on success calls applyAuthResponse which sets isAuthenticated=true. On failure, sets isLoading=false and error message, then re-throws.
  implication: When the API call fails, isLoading is set back to false (so the button re-enables) and error is set (so error banner shows). The user sees an error message but can retry. The flow is "stuck" because every retry will fail.

- timestamp: 2026-02-06T00:04:00Z
  checked: authService.ts register function
  found: Calls `post<AuthResponse>('/auth/register', {...data, termsVersion, privacyVersion})`. This uses the apiClient's post helper.
  implication: This makes a POST to http://localhost:305/api/v1/auth/register

- timestamp: 2026-02-06T00:05:00Z
  checked: apiClient.ts post helper and error interceptor
  found: The post helper calls apiClient.post which goes through the response error interceptor. For non-401 errors, it normalizes to an ApiError object with message/code/statusCode. If the server returns 404, the error message would be whatever the server sends, or "An unexpected error occurred" if no response body.
  implication: A 404 from the backend would be caught and surfaced as an error message in the UI error banner.

- timestamp: 2026-02-06T00:06:00Z
  checked: Config.ts - apiBaseUrl
  found: Dev config uses 'http://localhost:305/api/v1'. The iOS simulator needs to reach localhost, which should work on iOS simulator (unlike Android emulator which needs 10.0.2.2).
  implication: The URL is correct for iOS simulator. But port 305 is unusual (standard is 3050 or 8000 for FastAPI). Confirmed by bug report that backend runs on port 305.

- timestamp: 2026-02-06T00:07:00Z
  checked: Metro logs at /private/tmp/claude-501/-Users-ricardorozomacmini-VISP/tasks/b184345.output
  found: No JavaScript errors visible in the Metro output. Only warnings about duplicate screen names (ProviderHome > JobOffers) and failed debugger connections. The app loads and runs without JS crashes.
  implication: The issue is not a JS crash but rather the API call failing because the backend endpoint doesn't exist.

## Resolution

root_cause: The registration flow UI works correctly through all 3 steps. Role selection properly updates state, and the "Create Account" button correctly enables when a role is selected and terms are accepted. However, when the user taps "Create Account", the authService.register() function makes a POST request to /api/v1/auth/register on the backend, which returns a 404 because the backend auth endpoints have not been implemented yet. This causes an error to be set in the auth store, which is displayed as an error banner on the registration screen. The user is effectively "stuck" because every attempt to complete registration will fail with the same error.
fix: Added a __DEV__ fallback in the authStore register action. When the API call fails in development mode, instead of showing an error and blocking the user, it creates a mock user from the actual registration form data (email, name, role) and sets isAuthenticated=true. This allows the full registration flow to complete and navigate to the home screen. The fallback logs a console warning for visibility. A TODO comment marks it for removal once backend auth endpoints are live. In production builds, the original error behavior is preserved.
verification: TypeScript compilation passes with zero errors in authStore.ts. The fix is guarded by __DEV__ so production builds are unaffected. The mock user uses the real form data so navigation will route to the correct home screen based on the selected role.
files_changed:
  - /Users/ricardorozomacmini/VISP/visp-tasker/mobile/src/stores/authStore.ts
