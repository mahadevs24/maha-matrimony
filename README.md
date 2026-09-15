# MahaMatrimony

Marathi-first matrimonial app. Free during launch. Angular 22 + Supabase.

## Run locally

Install Node.js 24 LTS (24.15 or later). Angular CLI is a project dependency; a global install is unnecessary.

    npm install
    npm start

Open http://localhost:4200. The landing page works without a backend. Accounts and member operations intentionally remain disabled until configured. No fake accounts or demo admin access are provided.

## Connect Supabase

1. Create a Supabase project you own.
2. Run `supabase/migrations/001_initial.sql` once in its SQL editor.
3. In `src/environment.ts`, set your project URL and publishable key (or legacy anon key). These are browser-safe identifiers protected by database policies. NEVER use a secret/service-role key here.
4. Enable email confirmation in Authentication settings. Configure localhost and your eventual production domain as allowed redirect URLs and configure production email delivery before launch.
5. Register your own account and confirm your email.
6. Copy your account UUID from Supabase Authentication > Users and run the following in the SQL editor, substituting that UUID:

       insert into public.admin_users(user_id) values ('YOUR-ACCOUNT-UUID');

7. Sign out and sign in again. The Admin reviews navigation becomes available.

## First milestone implemented

- Responsive branded landing page.
- Email/password registration, email confirmation support, sign-in and sign-out.
- Profile form, pending/approved/rejected status and admin review queue.
- Approved members can browse approved profiles and filter by city.
- Upload, compress, view and remove up to five photos per member.
- Private photo bucket; signed links expire after five minutes.
- Database permissions prevent members from approving themselves or editing another member.
- Profile detail edits and photo mutations reset approval. Admin decisions are recorded.

Admin review is not identity verification. No contact fields are collected or exposed in this milestone. Do not put contact details into profile descriptions.

## Validation before real users

Run `npm test` for the embedded PostgreSQL authorization checks and `npm run build` for the production build. Local authorization checks pass; the test harness models Supabase Auth and Storage tables but does not run the actual Supabase Storage API. Live Supabase authorization tests require a configured project:

- An anonymous visitor cannot read profiles or photos.
- Pending member A can read/edit only their own profile; cannot browse approved member B.
- A cannot set status, review_note or admin membership, call review_profile, or edit B.
- Admin can approve A; A can then read approved profiles, never another pending profile.
- Editing A or adding/deleting a photo puts A back into pending immediately.
- Sixth photo slot, nested paths, other users' paths and unsupported content types are rejected.
- Rejected member can edit and resubmit; sign-out removes access.

Signed photo links already issued remain valid until their five-minute expiry. Stored age will become stale; replace with a private date-of-birth and age calculation before public launch. Do not launch publicly until the live authorization checks and moderation flows have been tested.

## Still to build before public launch

Marathi translation and language switch, password recovery, admin MFA, partner preferences, consent/terms, block/report, account deletion, shortlists, interest requests and mutual contact sharing. Add pagination, rate limiting/abuse controls, automated authorization tests and operational backups. Membership payments are deliberately deferred.

## Build and hosting

    npm run build

Cloudflare Pages: build command `npm run build`; output `dist/maha-matrimony/browser`; Node version 24. `public/_redirects` supports SPA routes. Deployment and domain purchase have not been performed.
