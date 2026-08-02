# LabTrack v0.4.2 update

This update adds:

- An **Add material** action for approved administrators in Inventory Management.
- Direct admin material creation into a selected department, without creating an approval request.
- A required **MR — Material Responsible** field for both user material requests and direct admin additions.
- Admins can confirm or replace the proposed MR when approving a user request.
- Directly added materials are automatically marked as approved by the current administrator and create an activity log.

## Appwrite limit safety

This update uses the existing `material_responsible` attributes already present in the v0.4 Appwrite schema. It creates no new collection and no new attribute, so you do not need to rerun `setup:appwrite` if v0.4 setup already completed successfully.

## Install

Replace `App.jsx` in the current v0.4.1 project. Then run:

```bat
npm.cmd run preflight
npm.cmd run build
npm.cmd run dev
```

After local testing, upload the new `App.jsx` to the existing GitHub repository. Vercel will deploy the new frontend automatically.
