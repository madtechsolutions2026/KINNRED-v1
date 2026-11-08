# Client update — 8 November 2026

## Included

- Visible distance control: 1, 3, 10 and 50 km; backed by existing server filters.
- Pings opens Chats first, with Requests next.
- Optional custom @username in Myspace → Edit profile; availability enforced by a database unique index.
- Editable gender, preserving the account’s existing photo privacy settings.
- Scrollable message composer with Android keyboard resizing and keyboard avoidance.
- Plans in Grid: host a title/time/public-place plan, request to join, approve/decline requests, withdraw/leave and cancel.
- White default backgrounds, Figma fonts and #FF1A53 → #FF7A00 selected tabs.
- Improved missing-photo and locked-photo cards; no stock face is substituted for a user.
- Own profile pinned first, using the first ordered profile photo; tapping opens Myspace.

## Verification

Backend: 289 passing tests. Live Railway two-account smoke test covered profile
updates and username collision, nearby Plans, request creation and host approval.
Android JavaScript export passed. Mobile browser checks cover 320 px and 390 px
widths, radius controls, Plans publishing, profile controls and message composition.

No physical Android device is attached; Android keyboard behaviour needs a device
check after APK installation. Circles creation remains verification-gated; an explicit
request is pending to approve only the synthetic preview host through the existing
manual staging review flow.

Preview authentication still uses the shared 000000 code and is not phone ownership
verification. Use synthetic profile data. Production guards are preserved.
