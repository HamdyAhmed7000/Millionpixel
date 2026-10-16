# Publish Million Pixel with Vercel and a GoDaddy domain

This project is a React + Vite site. The ZIP contains the source, Supabase functions, and database migrations. It deliberately does **not** include `.env.local`, `node_modules`, or a production build. Never upload `.env.local` or any Supabase `service_role` secret to GitHub or Vercel.

## 1. Extract and upload the project to GitHub

1. Download and extract `million-pixel-platform-source.zip` on your computer.
2. Sign in to GitHub and create a **private** repository, for example `million-pixel-platform`.
3. Open the extracted project folder and upload its contents to that repository. Upload the files inside the folder (including `package.json`, `package-lock.json`, `src`, and `supabase`), not an extra enclosing folder.
4. Confirm that `.env.local` is not among the uploaded files. The archive excludes it; keep it private on your computer.

## 2. Deploy the site on Vercel

1. Sign in at [Vercel](https://vercel.com/) and choose **Add New → Project**.
2. Import the GitHub repository you just created and allow Vercel to access that repository.
3. Vercel should detect Vite. If it asks for settings, use:
   - Framework: **Vite**
   - Install command: `npm install`
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add these environment variables under the project settings before deploying:
   - `VITE_SUPABASE_URL` — copy the Project URL from Supabase → Project Settings → API.
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — copy the publishable key from the same Supabase API page (or the matching `VITE_` value in your local `.env.local`).
5. Add them to the **Production** environment, save, then deploy. Keep all `service_role` keys and `CRON_SECRET` out of Vercel frontend variables.
6. Open the generated `*.vercel.app` URL and confirm the page loads and Supabase sign-in works.

## 3. Connect your GoDaddy domain

1. In Vercel, open the project → **Settings → Domains** and add your domain, for example `example.com`. Add `www.example.com` too if you want both versions.
2. Vercel will show the DNS records required for this project. Keep that page open; use the exact values it displays.
3. In GoDaddy, open **My Products → your domain → DNS → Manage DNS**.
4. Add or edit the records Vercel requested. Usually this is an `A` record for host `@` and a `CNAME` for host `www`, but follow the values shown in Vercel.
5. Remove only conflicting records for `@` or `www` that point to a different website. Keep existing `MX` and email-related `TXT` records so domain email is not disrupted.
6. Return to Vercel and wait for the domain to show **Valid Configuration**. DNS changes can take time to propagate; Vercel then provisions HTTPS for the domain.

## 4. Update Supabase Auth for the new domain

1. In Supabase, open **Authentication → URL Configuration**.
2. Set **Site URL** to your primary address, including `https://` (for example, `https://example.com`).
3. Add these under **Redirect URLs**, replacing the example domain:
   - `https://example.com/**`
   - `https://www.example.com/**` if you use `www`
   - `http://localhost:5173/**` to keep local development working
4. Save, then test sign-in from the real domain. The email link should return to the deployed website.

## 5. Check the Supabase server functions

The website needs `admin-review` for approving submissions and `expire-listings` for expiring old spots. From Command Prompt or PowerShell, open the extracted project folder and run:

```text
npx supabase login
npx supabase link --project-ref cqxyohsvquwltzwkybyf
npx supabase functions deploy admin-review --project-ref cqxyohsvquwltzwkybyf
npx supabase functions deploy expire-listings --project-ref cqxyohsvquwltzwkybyf
```

If prompted to install the Supabase CLI, allow the install. In Supabase → **Edge Functions → Secrets**, set `APP_ORIGIN` to your primary HTTPS domain. Keep the existing `CRON_SECRET` there; do not put it in Vercel. Check that the expiry schedule is configured to call `expire-listings` every 15 minutes with the `x-cron-secret` header. If it already exists, leave it in place.

## 6. Make a production check

- Open the site on both the root domain and `www` address (if configured).
- Sign in and confirm the email link returns to the site.
- Confirm public images load, and submit one small test claim before announcing the site.
- Confirm the admin account can open **Review queue** and approve a test submission.
- Confirm domain email still works if GoDaddy DNS records were changed.

**Payment note:** this project currently uses manual payment-proof review and the displayed `$1.00` is placeholder pricing. Set the real price/payment instructions and verify the process before accepting customer payments. There is no card processor connected.

## Official references

- [Vercel: Vite deployment](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel: custom domains and DNS](https://vercel.com/docs/domains/set-up-custom-domain)
- [GoDaddy: manage DNS records](https://www.godaddy.com/help/manage-dns-records-680)
- [Supabase: Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase: deploy Edge Functions](https://supabase.com/docs/guides/functions/quickstart)
