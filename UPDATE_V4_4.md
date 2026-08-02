# LabTrack v0.4.4 — Equipment Maintenance Approval Workflow

## Added

### User maintenance requests
- Every approved user now has a **Maintenance** sidebar section.
- Users can select equipment/non-consumable materials from their own department.
- Users can submit:
  - Maintenance type
  - Current or expected condition
  - Maintenance/service date
  - Next maintenance due date
  - Service provider
  - Technician/person assigned
  - Estimated cost
  - Maintenance notes
- User entries are saved as **pending** and do not change the official equipment record until an administrator approves them.
- Users can see their pending, approved, and rejected maintenance requests.

### Administrator controls
- The admin Maintenance page now displays pending and reviewed maintenance requests.
- Admins can approve a request, which updates the equipment's condition, last-maintenance date, next due date, and maintenance note.
- Admins can reject a request with a visible rejection reason.
- Admins can use **Add maintenance record** to create an approved maintenance entry immediately.
- The previous quick equipment maintenance update remains available.
- Approved/direct maintenance actions create an audit entry in the material logs.

### Notifications and badges
- The user Maintenance tab shows the user's pending-request count.
- The admin Maintenance tab combines due-equipment and pending-request counts.
- Pending maintenance requests are included in the admin notification center.

## Appwrite update

A new collection is required:

- `maintenance_requests`

The setup script uses the existing `labtrack` database and **never creates another database**.
