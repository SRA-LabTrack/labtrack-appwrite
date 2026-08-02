# LabTrack v0.4.3

Changes in this release:

- Renamed **MR — Material Responsible** to **MR — Material Responsibility** throughout the interface.
- Added a dedicated **Material approval logs only** cleanup option. It deletes only approved/rejected approval log entries and preserves pending requests and inventory materials.
- Optimized animations by removing blur-heavy reveal effects, shortening transition durations, and using smoother GPU-friendly transforms.
- No Appwrite collections or attributes were added, so this update does not increase schema usage.

## Apply locally

Replace `App.jsx`, `supabaseClient.js`, `package.json`, and `package-lock.json`, then run:

```bat
npm.cmd run preflight
npm.cmd run build
npm.cmd run dev
```

No Appwrite setup rerun is required.
