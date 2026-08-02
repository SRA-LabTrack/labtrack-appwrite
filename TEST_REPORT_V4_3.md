# LabTrack v0.4.3 Test Report

## Automated checks

- `npm run preflight`: passed
- Appwrite schema budget checks: passed for all 9 collections
- Largest estimated schema: `item_requests` at 43,576 / 65,535 bytes
- `npm run build`: passed with Vite 5.4.21
- 1,511 modules transformed successfully
- Production bundle generated successfully

## Feature checks

- UI wording uses **MR — Material Responsibility** while preserving the existing Appwrite field ID `material_responsible`.
- Cleanup selector includes **Material approval logs only**.
- Approval-log cleanup is limited to `approved` and `rejected` activity records.
- Pending material requests and inventory materials are not deleted by approval-log cleanup.
- Cleanup result message separately reports general logs, approval logs, and chats.
- Motion overrides use transform/opacity instead of blur-heavy reveals.
- No new Appwrite collection or attribute was introduced.

## Deployment impact

This release requires a frontend redeploy because `App.jsx` and `supabaseClient.js` changed. It does not require `npm run setup:appwrite` because the database schema is unchanged.
