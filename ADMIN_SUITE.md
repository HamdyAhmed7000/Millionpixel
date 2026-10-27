# CellTalk administration suite

## Where to find features
- **Platform activity / نشاط المنصة**: account registrations and photo, dream, auction and advice submissions over 7 or 30 days. Select a metric and click a chart column for its value. Section percentages use recorded page views, not votes or bids.
- **Online**: estimated active browsers with a visible public page in the last five minutes. Heartbeats run every minute; analytics refresh every 30 seconds. No account identity is linked to the browser token.
- **Moderation tools / أدوات الإشراف**: advanced search, pending queues, bulk actions, reports, roles, participation bans and private support messages.
- **Activity log / سجل القرارات**: administrator name and ID, content ID, Cairo timestamp, reason and stored change details.
- The notification bell refreshes every 15 seconds. Its bid threshold is a per-browser preference, default 10,000 EGP, and changes no auction price.
- Admin dark mode is a per-browser preference.

## Permissions
Existing general administrators remain general administrators. No account was promoted or banned during implementation. General administrators can assign separate auction, advice and dream scopes to existing members. Clearing every scope revokes specialist access immediately because checks read the database, not editable user metadata or stale JWT role claims. Specialist moderators see only permitted queues and reports. General administrators retain accounts, roles, photos/payment receipts, articles and analytics. Existing general admins cannot be modified through this roles interface.

## Bulk decisions
Select up to 20 items on the current page, enter a reason and confirm review. Photo approval requires explicit confirmation that each selected receipt was checked. Image publication uses the existing protected Edge Function. Other decisions run with per-item server authorization and return individual success/failure outcomes. Failed items remain unchanged. Removal hides content using the existing reversible removal flow; it does not refund a payment. Local Comedy Will files have no server queue.

## Bans and support
Participation bans block new content, comments, votes, bids and uploads through database guards. Accounts can still sign in, read and send private support requests (three per day). Existing auction completion flags can still be updated to settle obligations. Clear specialist permissions before banning a moderator. Warnings and reasons appear only to the affected account and authorized administrators. Lifting a ban also clears legacy advice suspensions and auction blocks.

## Database setup order
Apply `admin-suite-foundation.sql`, then `admin-suite.sql`, then the updated `admin-content-edit.sql` after the existing project schema. Tables use RLS and have no direct browser table privileges. Public heartbeat access writes only bounded anonymous presence; administrative RPCs require authenticated server-verified permissions.

## Validation
Production build; rollback-only checks for analytics, search, scoped review, cross-scope denial, privilege escalation denial, ban enforcement, private warnings/support and anonymous denial. Test account changes and content were not retained. No real claims were approved and no real accounts were banned.
