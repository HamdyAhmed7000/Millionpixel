# Million Pixel — React + Supabase

A React single-page app backed by Supabase Auth, Postgres, and Storage. This is the real-project foundation for the Million Pixel demo: submissions are shared across users, active slot reservations are enforced by Postgres, payment proofs stay in a private bucket, and admin publication runs through a protected Edge Function.

## What is implemented

- A pan-and-zoom 1,000 × 1,000 map with eased wheel/button zoom, touch pinch zoom, and viewport-bounded image loading. It composites a low-resolution canvas mosaic while zoomed out and draws the original uploaded image at close zoom.
- Standard 1 × 1 spots and featured 2 × 2 / 4 × 4 square spots. Each featured spot reserves every covered tile atomically and keeps one serial number at its top-left tile.
- Email magic-link sign-in. A signed-in user can submit an image, a display name/contact, and manual payment proof.
- A private `submission-files` bucket for both pending artwork and payment proofs. Only the submitting user and an admin can read those objects.
- A public `published-images` bucket. Only images approved by an admin are copied into it.
- Row Level Security on the profile, claim, listing, and storage surfaces. A unique partial index reserves each slot while a claim is pending or published.
- Admin review via `admin-review` Edge Function. It verifies the caller's session and admin profile before it can approve or reject a request.
- Optional 500-character image stories are reviewed with submissions and shown with the published image.
- Published profile cards show the full-resolution artwork, story, public website/social link, publication date, serial number, and spot size.
- Signed-in users can like or unlike a published image. Public like totals are available without exposing the identities of people who liked it.
- A 30-day published lifetime and a 48-hour pending reservation lifetime. `expire-listings` releases due slots and removes expired public images when scheduled.
- The home canvas can create weekly vertical replay video exports.
- Monthly community challenges nominate published spots by tag and support one changeable vote per user and challenge.
- Referral links award both users 15% of the referred spot price as credits after approval. Credits can cover a future spot; this is not a cash payout.

Payment remains manual. No card processor or payment verification is connected. Public map queries expose only the display name, image story, public profile link, spot serial/size, image path, like summary, and publication/expiry dates; contact details and proof paths stay in the protected claims table.

## Requirements

- Node.js 20.19+ or 22.12+ recommended for Vite 7.
- A Supabase project.
- Supabase CLI for migrations and Edge Function deployment.

## 1. Connect the app to Supabase

1. Create a Supabase project and copy its Project URL and publishable key from the project API settings.
2. Copy `.env.example` to `.env.local` and set:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

3. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

4. In Supabase Auth URL Configuration, add the local app URL (usually `http://localhost:5173`) to the allowed redirect URLs. Add the eventual production domain there too.

## 2. Create the database and storage policies

From this folder, authenticate the Supabase CLI, link the project, and apply the checked-in migration:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migration creates the tables, row-level security policies, the private and public storage buckets, the active-slot uniqueness constraint, and the database functions used by review and expiry.

For an existing project, apply migrations `0002` through `0005` in order with `npx supabase db push`, or paste those migration files into the Supabase SQL Editor in order. Migration `0005` adds referral credits and monthly challenge voting.

## 3. Deploy protected functions

```sh
npx supabase functions deploy admin-review --project-ref YOUR_PROJECT_REF
npx supabase functions deploy expire-listings --project-ref YOUR_PROJECT_REF
```

Supabase provides the project URL and server-side service key to Edge Functions. The service key is used only inside these functions and must never be added to the React environment or committed to source control.

In Supabase Function Secrets, set:

- `APP_ORIGIN` to the exact production website origin, for example `https://your-site.example`.
- `CRON_SECRET` to a long random secret used only by the expiry job.

For local function development, put the same values in `supabase/functions/.env` (that file is ignored by Git) and serve functions with the Supabase CLI.

## 4. Grant the first administrator

1. Sign in through the app using the email address that should review submissions. This creates a profile with `is_admin = false`.
2. In the Supabase SQL Editor, run this once with that exact email:

   ```sql
   update public.profiles p
   set is_admin = true
   from auth.users u
   where p.user_id = u.id
     and lower(u.email) = lower('admin@example.com');
   ```

3. Refresh the app. The Review queue button appears for that account.

Only grant admin status to trusted accounts. The frontend display is not the security boundary; the Edge Function checks the profile before acting.

## 5. Schedule expiry

Deploy `expire-listings`, then create a Supabase Cron job that sends a `POST` request every 15 minutes to:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/expire-listings
```

Set the request header `x-cron-secret` to the same `CRON_SECRET` value configured for the Edge Function, with body `{}`. The function marks 48-hour-old pending reservations expired, removes expired public listings, releases their slots, and deletes their public image objects. Check the job's run history after setup; expiration cleanup depends on this job running.

## 6. Publish the React app

Build the app with `npm run build`; the output is in `dist/`. Deploy that folder to a static host such as Netlify or Vercel. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's environment settings, then rebuild. Add the deployed domain to Supabase Auth's allowed redirect URLs and set the Edge Function `APP_ORIGIN` to that domain.

## Data and access model

| Data | Location | Access |
| --- | --- | --- |
| Email/login identity | Supabase Auth | User and Supabase Auth |
| Contact and pending request | `slot_claims` | Request owner and admins |
| Pending art and payment proof | Private `submission-files` bucket | Owner and admins; proof links are short-lived signed URLs |
| Published slot metadata | `published_slots` | Public, while unexpired |
| Approved public artwork | Public `published-images` bucket | Public, by design |
| Admin approval and image publication | `admin-review` Edge Function | Signed-in admins only |

## Still needed before accepting real payments

- Configure and test the real Supabase project, Auth email delivery, deployment domains, function secrets, and expiry schedule.
- Decide the payment amount/currency and the real manual payment instructions; current UI displays `$1.00` as placeholder copy.
- Add upload content inspection/moderation and abuse controls appropriate to the launch.
- Define retention and deletion rules for rejected claims, contact details, and private proof files.
- Review the SQL policies and function deployment against your actual Supabase settings before collecting real customer data.

The web app exposes only the Supabase publishable key. Database access is enforced by grants and RLS; the `service_role` key must stay server-side. The private bucket and RLS access controls follow Supabase's documented model for sensitive uploads. See [React/Auth quickstart](https://supabase.com/docs/guides/auth/quickstarts/react), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), and [Cron](https://supabase.com/docs/guides/cron).
