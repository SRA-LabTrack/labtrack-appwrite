# LabTrack v0.4.5 — Material approval cleanup fix

## Fixed behavior

The **Material approval history and logs** cleanup option now removes both:

1. Approved/rejected activity entries from the `logs` collection.
2. Approved/rejected history cards from the `item_requests` collection.

It does not remove:

- Pending material requests
- Materials that were already added to inventory
- Any other inventory records

The cleanup now scans records in pages instead of checking only the newest 500 rows. Only approved administrators may run it.

## Apply the update

Replace these files in the current project and GitHub repository:

- `App.jsx`
- `supabaseClient.js`

No Appwrite schema update is needed. Do not rerun `setup:appwrite` for this fix.

After replacing locally:

```bat
npm.cmd run preflight
npm.cmd run build
npm.cmd run dev
```

After uploading both files to GitHub, Vercel should deploy automatically.
