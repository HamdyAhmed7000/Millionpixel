# MillionPixel community pages — 24 October 2026

The main navigation now links to separate pages at /ar/advice, /ar/comedy-will and /ar/dreams, with equivalent /en/ paths. Advice Exchange is no longer embedded below the canvas. All pages use the existing Supabase accounts.

## Review fixes
- Image review CORS now returns the exact allowed origin for the production Vercel URL, celltalk.info and www.celltalk.info. Untrusted origins are rejected. JWT verification and the server-side administrator check remain enabled.
- A read-only review connection check can be run in the image review queue. It does not approve or reject a claim.
- Each image publication attempt uses a unique object path, so a failed concurrent attempt cannot remove a successfully published image.
- Advice moderation no longer requires the administrator to create an advice handle first. Approval has a default audited review reason; rejection still requires a reason.
- The client refreshes an expired session once and surfaces the actual review error.

## Comedy Will
Generates an explicitly fictional, non-legal document locally. Users can create a 1080 × 1350 PNG preview, save the image or print/save PDF. There are up to four gifts and three comic styles. Entries are not uploaded or persisted by this tool.

## Dream Cemetery
Dream obituaries and comments are reviewed before publication. A user can react once, remove their reaction, report a post, and revive their own published dream. Handles reuse Advice Exchange. Administrators review posts and comments and resolve reports. RLS restricts public reads to approved content and keeps each user's reactions private. No public demonstration activity was seeded.

## Database and deployment
The community-dreams.sql source was applied as two additive Supabase migrations: dream_cemetery_tables_and_policies and dream_cemetery_commands_and_public_feed. Do not rerun CREATE TABLE statements on an already-configured database. The admin handle fix was applied separately. The Edge Function source is in supabase/functions/admin-review/index.ts; the root publication copy is admin-review.ts.

The local source remains under outputs/million-pixel-platform/src. work/community-pages-release contains flattened imports compatible with the existing GitHub root layout. Publish those files through the existing Vercel project and keep its VITE_SUPABASE environment variables.

Rollback the frontend by promoting the previous Vercel deployment or reverting the corresponding GitHub commit. Keep new tables to preserve submissions. Reverting only the frontend does not require deleting any data. Image review CORS should retain all legitimate production origins.

## Verification
Production build passes. Confirmed CORS preflight from both production origins, 403 for an untrusted origin, admin review without a public handle, approved dream public reads, reaction totals, hidden pending comments, approved comments and denied public writes. Database fixtures were rolled back. The comedy document generated a readable 1080 × 1350 PNG in the browser.
