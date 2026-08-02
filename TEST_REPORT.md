# LabTrack v0.4.4 Test Report

## Completed checks

- `node --check supabaseClient.js` — passed
- `node --check scripts/setupAppwrite.mjs` — passed
- `node --check scripts/preflight.mjs` — passed
- `npm run preflight` — passed
- `npm run build` — passed
- Vite transformed 1,511 modules and produced the production bundle successfully.
- The package lock uses the public npm registry and contains no internal `applied-caas` links.
- The setup script verifies and reuses the existing `labtrack` database.
- Static checks confirmed the new `maintenance_requests` mapping, schema, indexes, user form, admin direct-add form, and approval/rejection RPC handlers are present.

## Appwrite schema estimate

- `maintenance_requests`: approximately 18,856 bytes out of the 65,535-byte document limit.
- Safety threshold used by the project: 56,000 bytes.

## Runtime test required by project owner

After running `npm run setup:appwrite`, test with one normal approved account and one admin account:

1. User submits a maintenance request.
2. Admin sees the pending badge and request.
3. Admin approves it.
4. Equipment condition and maintenance dates update.
5. User sees the request as approved.
6. Admin creates a direct maintenance record.
7. Admin rejects another request and the user sees the reason.
