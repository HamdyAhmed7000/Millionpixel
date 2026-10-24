# Live & Flash Auctions

Arabic /ar/auctions and English /en/auctions. Reuses MillionPixel Auth and public handles.

## Active rules
- EGP only. No commission, deposit, payment collection or escrow. Payment and delivery arranged by participants.
- 1/2/3-hour flash or 24-hour daily auctions. Moderators approve listings; approval starts the clock.
- Hidden immutable reserve. First bid >= starting price; later bids >= high bid + increment. Atomic row lock serializes bids. Every accepted bid in the final three minutes adds three minutes. Server time is authoritative.
- Listings accept up to four 5MB photos and one optional 25MB video in a private bucket. Public signed media URLs expire after 120 seconds.
- Self-bids and repeated bids by current leader rejected. Five listings/day; 100 bids/hour; one-second account action cooldown.
- Phone is self-reported, not verified identity. Shown only to seller and winner after successful close. Reserve is visible only to seller and admins.
- Both parties confirm completion before one rating per party/deal. Seller and bidder aggregate ratings shown publicly.
- Private moderation reports, account suspensions and appeals, with admin audit. No public blacklist.
- Mystery bundles must disclose contents; packaging may remain a surprise.
- Every 10 seconds the feed refreshes; open auctions refresh every 5 seconds with a one-second countdown. Closure finalizes transactionally on opening an expired auction; bids reject after deadline even if no page is open.

## API and access
The auction tables are in the non-exposed private schema, with RLS enabled and browser table privileges revoked. public.auction_command is SECURITY INVOKER with an SQL-standard prebound body; the internal non-exposed function checks authentication, ownership and admin rights. No new anon schema USAGE grant. The read API intentionally allows approved public listings and anonymized bid history, never phone or reserve data. Storage policies enforce ownership and approved listing visibility.

## Sharing
WhatsApp, Facebook, X, Telegram, copy link / Instagram and native sharing (supported devices). Per-item links for auctions, photos, advice and dreams. Comedy Will stays local; exported PNG can be shared manually. No automated social posts.

## Verification
Production build passed. Transactional rolled-back fixtures verified anti-sniping, minimum bid, own bid rejection, signed-in bidding, private pending items, reserve/contact privacy, admin-only approval, reserve failure, winner selection and completion-gated ratings. No fixtures retained. No actual purchases or real bids made by the assistant.
