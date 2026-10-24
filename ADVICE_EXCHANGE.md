# Advice Exchange release

This release adds the bilingual Advice Exchange inside MillionPixel and restores the full rectangular 1,000 × 1,000 canvas. Image gallery, manual Egyptian payments, existing accounts and district milestones remain available.

## Implemented
- Arabic RTL / English UI and language preference.
- Reuse of existing Supabase sessions, password sign-in and account registration.
- Public browsing of approved advice; private pending submissions.
- Public handles; useful/funny/both categories; Arabic-normalized search; tags and filters.
- Server-controlled pricing: max(1, 100 + 10 × upvotes − 10 × downvotes).
- One changeable vote per account; no self-voting; per-account rate limits.
- Price history, daily/weekly price movement, creator rankings, bookmarks, reports and visit streaks.
- Existing admins can approve/reject/remove advice and suspend authors. Decisions are audited privately.
- 30-second background refresh while the page is visible.
- Sponsor competitions and advertising remain inactive. No promised real prizes or cash conversion.

## Database
`supabase/advice-exchange.sql` is the additive feature setup. It has already been applied to the connected Million Pixel database. Do not rerun this initial CREATE TABLE script on that database. `supabase/restore-rectangular-canvas.sql` removes the geographic claim guard and restores rectangular landmarks and future hunt generation. Both changes are recorded by Supabase migrations.

No image or payment data was deleted. Existing district unlocks still apply to new claims. The legacy Egypt geometry file and historic migration are retained for history and rollback, but the frontend no longer imports the geometry.

## Deployment
The canonical development source uses src/components/advice. The existing GitHub repository uses files at its root. Prepared publication files in ../advice-release have adjusted imports for that layout; do not mix the two App.jsx import layouts.

Use the existing Vercel environment variables. Never upload .env.local. The release adds localized advice rewrites in vercel.json. The language toggle and advice sharing remain on the same domain.

## Verification
Production build passes. Rolled-back database fixtures verified moderation, public/private visibility, Arabic normalization, vote arithmetic, duplicate vote handling, vote changes/removal, self-vote rejection, bookmarks, reports, and protected writes. Anonymous API reads succeed. Temporary test advice was not retained.

The complete SQL test harness is supplied in supabase/advice-exchange.test.sql. Several checks were run in smaller transactions because the connector intermittently expired large requests. No claim is made that a parallel multi-session race test was run.

## Rollback
For a frontend issue, promote the previous Vercel deployment or revert the release commit. Leave advice tables in place to preserve any new submissions. If restoring the old Egypt frontend, also reapply the historic 0010_egypt_mask.sql to restore its corresponding geographic guard. Back up database data before any destructive cleanup.

## Still disabled / future work
Sponsor onboarding, funded real-prize contests, winner settlement, advertising account configuration and full contest lifecycle are not active in this MVP. No share trading, deposits or withdrawals are implemented.
