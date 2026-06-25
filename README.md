# QC Planner

QC Planner is a production-ready React + Vite + TypeScript web app for QC schedule planning, analyst assignments, assay workflows, GMP-style audit history, Firebase Authentication, Google Cloud Firestore, and GitHub Pages deployment.

Theme: clean quality operations dashboard

## Features

- Firebase Authentication login
- Personnel-based role access for Analyst, Supervisor, and Admin functions
- Signed-in user password changes
- Google Cloud Firestore data storage
- Dashboard with filters and summary metrics
- Product and protocol master data
- Protocol-level QC Sample IDs copied into scheduled assay details
- QC Sample Plan and EM Protocol sub-protocols
- QC Stability programs with separate stability protocol builder
- Stability time points with custom target windows and per-time-point QC tests
- Laboratory materials and reagent lot inventory with expiration and minimum-stock monitoring
- Equipment inventory with calibration due-date monitoring
- Assay-level material, reagent, and equipment usage with GMP audit entries
- EM Protocol test delta days from Day 0 Harvest
- Dynamic assay workflow steps per protocol
- Main analyst, optional trainee analyst, QC reviewer, and schedule dates
- Calendar views: day, week, month, and list
- Status badges and progress tracking
- GMP audit/history log for schedule changes
- Email invite request queue and `.ics` draft generation
- Weekly QC Stability reminder workflow for a `Stability Admin` personnel record
- Admin settings page
- Firestore security rules
- GitHub Pages deployment workflow
- `.env.example` with safe Firebase config placeholders

## Firestore Structure

```text
products/{productId}
protocols/{protocolId}
stabilityProtocols/{stabilityProtocolId}
stabilityPrograms/{stabilityProgramId}
labResources/{resourceId}
assayResourceUsage/{usageId}
personnel/{personId}
schedules/{scheduleId}
schedules/{scheduleId}/auditTrail/{auditId}
auditTrail/{auditId}
mailRequests/{requestId}
adminSettings/general
adminSettings/users/records/{uid}
accessProfiles/{normalizedEmail}
```

## User Roles

Firebase Authentication users are matched to active Personnel records by the first email address in the Personnel email field. Additional comma- or semicolon-separated addresses remain available for invite delivery.

- `Analyst` and `QA`: view data, complete testing, complete QC review, view audit history, change password, and send updated invites.
- `Supervisor` and `Manager`: Analyst permissions plus schedule/test editing, schedule creation, QC Stability management, and product/protocol management.
- `Admin`: Supervisor permissions plus Personnel management and Admin Settings.
- Missing or inactive Personnel profile: read-only Viewer access.

Saving a Personnel record creates or updates `accessProfiles/{normalizedEmail}` for Firestore security enforcement. Existing Personnel profiles are automatically synchronized when an Admin signs in.

## Firebase Setup

1. Create or open your Firebase project.
2. Enable **Authentication**.
3. Enable the **Email/Password** sign-in provider.
4. Create user accounts manually in Firebase Authentication.
5. Enable **Cloud Firestore**.
6. Deploy or paste the rules from `firestore.rules`.
7. Create a Firebase Web App and copy its config values.
8. Copy `.env.example` to `.env.local` for local development.

```text
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Do not commit `.env.local`, service account JSON files, SMTP passwords, or private keys.

## Admin Access

The Firestore rules expect admin users to be listed under:

```text
adminSettings/users/records/{uid}
```

Example document:

```json
{
  "email": "admin@example.com",
  "role": "Admin",
  "active": true
}
```

Use the Firebase Console to create the first admin record after creating the Firebase Authentication user.

## Email Workflow

QC Planner supports two safe email paths:

1. **Draft generation:** Click `Draft` on a schedule to download an `.ics` calendar invite file.
2. **Mail queue:** Click `Invite` to create a `mailRequests` document with `status: pending`.

The mail queue can be processed by the Google Apps Script worker from the previous project, Firebase Cloud Functions if you upgrade to Blaze, or another secure server-side worker. Browser code does not store SMTP passwords.

The same Google Apps Script worker can also run `sendWeeklyStabilityReminder` every Monday at 8 AM. Create an active Personnel record named `Stability Admin` with the email address that should receive the weekly stability digest. The digest includes incomplete QC Stability schedule tests within the next 30 days as high priority and within the next 90 days as upcoming low priority.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

The built site is emitted to `dist`.

## GitHub Pages Deployment

Add these repository secrets in GitHub:

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
```

The workflow in `.github/workflows/pages.yml` builds the Vite app and deploys `dist` to GitHub Pages on every push to `main`.
