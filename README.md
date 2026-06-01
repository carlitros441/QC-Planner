# QC Planner

QC Planner is a production-ready React + Vite + TypeScript web app for QC schedule planning, analyst assignments, assay workflows, GMP-style audit history, Firebase Authentication, Google Cloud Firestore, and GitHub Pages deployment.

Theme: `www.CTMC.com`

## Features

- Firebase Authentication login
- Google Cloud Firestore data storage
- Dashboard with filters and summary metrics
- Product and protocol master data
- QC Sample Plan and EM Protocol sub-protocols
- EM Protocol test delta days from Day 0 Harvest
- Dynamic assay workflow steps per protocol
- Analyst assignment and schedule dates
- Calendar views: day, week, month, and list
- Status badges and progress tracking
- GMP audit/history log for schedule changes
- Email invite request queue and `.ics` draft generation
- Admin settings page
- Firestore security rules
- GitHub Pages deployment workflow
- `.env.example` with safe Firebase config placeholders

## Firestore Structure

```text
products/{productId}
protocols/{protocolId}
personnel/{personId}
schedules/{scheduleId}
schedules/{scheduleId}/auditTrail/{auditId}
auditTrail/{auditId}
mailRequests/{requestId}
adminSettings/general
adminSettings/users/records/{uid}
```

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
