# LabTrack v0.4.4 Update Guide

## 1. Replace the project files

Use the complete v0.4.4 project, or replace these files in your current project:

- `App.jsx`
- `supabaseClient.js`
- `appwrite/collections.json`
- `scripts/setupAppwrite.mjs`
- `scripts/preflight.mjs`
- `package.json`
- `package-lock.json`

## 2. Add a temporary Appwrite API key locally

Your local `.env` must contain:

```env
VITE_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=6a595e1200207471ab14
VITE_APPWRITE_DATABASE_ID=labtrack

APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=6a595e1200207471ab14
APPWRITE_DATABASE_ID=labtrack
APPWRITE_API_KEY=PASTE_A_NEW_TEMPORARY_KEY_HERE
```

Do not upload `.env` to GitHub or Vercel.

## 3. Run the update

In Command Prompt inside the v0.4.4 project folder:

```bat
npm.cmd install --registry=https://registry.npmjs.org/
npm.cmd run preflight
npm.cmd run setup:appwrite
```

The setup output must finish with `Done.`. Existing collections/attributes may say `already exists`; that is normal. The script creates only the new `maintenance_requests` collection inside the existing `labtrack` database.

After `Done.`, revoke the temporary API key.

## 4. Test locally

```bat
npm.cmd run build
npm.cmd run dev
```

Open the local address printed by Vite. Keep the terminal open while testing.

## 5. Publish online

Upload the updated project files to the existing GitHub repository. Never upload `.env`, `node_modules`, or `dist`. Vercel will automatically deploy the new commit.

The Vercel environment variables remain:

```env
VITE_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=6a595e1200207471ab14
VITE_APPWRITE_DATABASE_ID=labtrack
```
