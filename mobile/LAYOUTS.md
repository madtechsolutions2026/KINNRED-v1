# Kinnred Mobile — Layout & Behaviour Log

Running record of the React Native port of the Lovable prototype. **Update this
file whenever a screen, token, or behaviour changes** — it is the handoff
document between sessions.

- **Design source:** <https://interface-whisperer-hubbb.lovable.app/>
- **Runtime:** Expo SDK 57 · React Native 0.86 · React 19.2 · react-native-web 0.21
- **Backend:** `http://localhost:3000/api/v1` (NestJS, `../backend`)

---

## 1. Session log

| Date | Session | What changed |
|---|---|---|
| 2026-08-19 | 1 | Scaffolded Expo app. Extracted design tokens from prototype CSS. Built theme, API layer, navigation shell, and all four surfaces + Profile, Chat, Auth. Verified render in headless Chrome, light and dark. |
| 2026-08-19 | 1b | **Backend CORS** — `main.ts` had no `enableCors()`, so every request from the web build died at the preflight. Added a config-driven allowlist (DECISIONS.md D-056). Verified preflight + real POST from `http://localhost:8081`. |

**Next up (unstarted):**
- Circles backend module does not exist — screen runs on fixtures (§6).
- Signup flow (`POST /auth/register`) is not wired; `AuthScreen` stops at
  `registration_required` with an explanatory message.
- Media upload (presigned PUT) — `PhotoSlot` is a visual placeholder.
- Realtime: Socket.io client for chat + presence is not started.
- Grid location write (`PUT /grid/location`) is not called; no geolocation yet.

---

## 2. How the design was extracted

The prototype is server-rendered, so the markup and stylesheet were read
directly rather than eyeballed from screenshots:

| Artefact | Source |
|---|---|
| Colour tokens | `/assets/styles-Dvedk68G.css`, `:root` and `.dark` blocks |
| Layout / spacing | Tailwind utility classes in the rendered HTML |
| Routes | probed: `/`, `/pings`, `/circles`, `/me` all 200; `/myspace` 404 |
| Type families | `<link>` to Google Fonts — Fraunces + Inter |

**Colour conversion.** The prototype authors colour in `oklch()`, which React
Native cannot parse. Every token was converted to sRGB hex via Ottosson's
oklab matrices, not sampled by eye, so the palette is exact. The palette is a
**warm terracotta / sand** family (hue 27–68) — deliberately not the cool
slate palette typical of SaaS dashboards.

Key tokens (light → dark):

| Token | Light | Dark | Used for |
|---|---|---|---|
| `background` | `#FFF8F1` | `#1A0B06` | screen base |
| `card` | `#FFFEFB` | `#30130A` | every surface |
| `foreground` | `#460B06` | `#FCEFE5` | primary text |
| `mutedForeground` | `#885442` | `#C8AA96` | secondary text |
| `border` | `#F5D7C7` | `#513225` | 1px hairlines |
| `signal` | `#FD1623` | `#FF5F41` | active tab, unread, CTA |
| `radar` | `#F69300` | `#FD9F07` | live/online pulse |

---

## 3. Shell & navigation

```
MobileShell (web only: radial backdrop + 440px centred card, r=36, shadow-5)
└── NavigationContainer
    ├── [signedOut] Auth
    └── [signedIn | demo] Stack
        ├── Main → BottomTabs (custom TabBar)
        │   ├── Grid     "/"
        │   ├── Pings    "/pings"
        │   ├── Circles  "/circles"
        │   └── MySpace  "/me"
        ├── Profile "/profile/:publicShortId"   (slide_from_right)
        └── Chat    "/chat/:pingId"             (slide_from_bottom)
```

- **URLs match the prototype exactly**, via React Navigation `linking`.
- On native, `MobileShell` collapses to a plain background — the 440px column
  is a desktop-web affordance only.
- **TabBar** is a floating pill: `margin 12`, `radius pill`, 1px border,
  `card` fill, elevation 4. The active tab fills a 36px circle with `signal`
  and switches its label to `foreground` + weight 600. The chip carries the
  state, not the label.

---

## 4. Screen specs

### 4.1 Grid — `/`
Sticky header (4× 40px circular icon buttons, right-aligned: theme, likes ×5,
search, filters) → filter chip row (edge-bleeding horizontal scroll) → live
ticker → 3-column tile grid → privacy footnote.

- **Tiles:** `aspectRatio 3/4`, `radius 16`, `gap 6`, `paddingX 20`.
- **Tile layers (bottom→top):** deterministic gradient wash → photo (cover) →
  lock scrim + "PHOTOS LOCKED" chip → verified (TL) / online pulse (TR) →
  bottom scrim gradient with name 13/600 and meta 10/400.
- **Gradient is seeded from `publicShortId`**, so a person always gets the
  same colours — random-per-render would flicker on every list update.
- **Behaviour:** filter change refetches; pull-to-refresh; tap → Profile.
  Filters map to the real query contract (`onlineOnly`, `lookingFor[]`).

### 4.2 Pings — `/pings`
Header (serif title + subtitle) → segmented `Chats N` / `Requests N` → list.

- **Row:** 48px avatar, name + age, timestamp right, 2-line message preview,
  badge row (distance, intent tags, unread).
- **Requests are expandable** (`LayoutAnimation.easeInEaseOut`): tapping
  reveals the full message and Accept / Decline.
- **Accept/decline is optimistic** — the row leaves immediately and is
  restored on failure. Accepting moves the item into Chats locally.
- Tapping a chat row → Chat screen.

### 4.3 Circles — `/circles`
Header → category chips → circle cards → privacy footnote card.

- **Card:** 48px gradient monogram tile, name, description, badge row
  (privacy tier, category, member count), Join/Leave button right.
- **Tier → tone:** `OPEN` = Public/positive, `INVITE_ONLY` = Invite
  only/warning, `INCOGNITO` = neutral.
- Join/Leave is local-only state — no backend (§6).

### 4.4 MySpace — `/me`
Identity card → Photos (5 slots) → Unique ID → Aesthetics (3 slots) →
Privacy toggles → Discovery chips → Plus gradient card → Sign out.

- "Approximate distance" is rendered **on and disabled** — it is not a user
  choice, and showing it as a live toggle would imply it could be turned off.
- Sections use a shared `Section` wrapper; toggle rows are separated by
  `Divider inset={52}` so the rule starts at the label, not the icon.

### 4.5 Profile — `/profile/:id`
Full-bleed 3:4 hero with floating back button and bottom scrim carrying
name/age/verified/online/distance → intent badges → interests → privacy note.
Sticky `Ping <name>` CTA pinned above the safe area; flips to "Ping sent".

### 4.6 Chat — `/chat/:pingId`
Compact header (back, avatar, name, presence, overflow) → inverted bubble list
→ composer (multiline input, max height 110, circular send button).
Sends are optimistic with a temp id, reconciled or marked "Not delivered".

### 4.7 Auth — `/signin`
Wordmark + tagline → phone step → OTP step (number stays visible) → demo entry
link. Does not branch on "account exists" before verify — the OTP endpoint
returns an identical response either way, by design.

---

## 5. Component inventory

| Component | Purpose |
|---|---|
| `MobileShell` | 440px web column + backdrop |
| `ScreenHeader` | sticky title/subtitle + icon action row |
| `IconButton` | 40px circular button, optional count badge |
| `FilterChips` | edge-bleeding pill scroller; active = inverted chip |
| `SegmentedTabs` | inset-track segmented control with count bubbles |
| `AvatarTile` | Grid tile (5 layers, see §4.1) |
| `Avatar` | circular avatar; photo → locked → initial; verified BR, online TR |
| `Card` / `Divider` | soft surface, Pressable only when `onPress` given |
| `Badge` / `OverlayChip` | tinted status pill / on-photo dark chip |
| `LivePulse` | looping `animate-ping` halo, native-driver |
| `EmptyState` | loading + error + empty in one |
| `DemoBanner` | un-dismissable fixture-data notice |

---

## 6. Deviations from the prototype (and why)

1. **Distance is a bucket label, not a decimal.** The prototype prints
   "0.3 km". The API returns `"<1 km"` / `"1-3 km"` / … as a *string*, because
   an exact distance next to a fuzzed coordinate reconstructs the true
   position (CLAUDE.md §2.2, `backend/src/modules/grid/distance-buckets.ts`).
   Fixtures use bucket labels too, so the demo never teaches a layout
   production can't fill.
2. **No free-form radius control.** Only `[1000, 3000, 10000, 50000]` are
   accepted by the server; a slider would reopen the bracketing attack. The UI
   must never offer one.
3. **Circles runs on fixtures.** There is no `circles` module in the backend
   (`auth`, `grid`, `media`, `pings`, `users`, `verification` only). The card
   structure is final; only the data source changes.
4. **Palette is warm, not slate.** Taken from the prototype's own tokens.
5. **Backdrop-blur headers are flat fills.** Same resulting colour, without a
   real backdrop filter's cost.
6. **Radial gradient → vertical linear.** RN has no radial primitive; at this
   scale only the top-to-mid falloff reads.

---

## 7. API wiring status

| Screen | Endpoint | Status |
|---|---|---|
| Auth | `POST /auth/otp/request`, `/otp/verify` | wired |
| Auth | `POST /auth/register` | **not wired** |
| Grid | `GET /grid/nearby` | wired |
| Grid | `PUT /grid/location` | **not called** |
| Pings | `GET /pings/chats`, `/pings/requests` | wired |
| Pings | `POST /pings/:id/accept` · `/reject` | wired |
| Chat | `GET/POST /pings/:id/messages`, `/read` | wired |
| Profile | `GET /users/:publicShortId`, `POST /pings` | wired |
| MySpace | `GET /users/me`, `PATCH /users/me/settings` | **read-only stub** |
| Circles | — | no backend |

**CORS (backend requirement).** The web build is the first browser client this
API has had, so it needs `CORS_ORIGINS` on the backend. Unset in development it
falls back to `http://localhost:8081` / `http://127.0.0.1:8081` (plus 19006),
which covers `npx expo start --web`. If requests start failing at the preflight:

- check the API boot log — it prints `CORS origins: …`, the only place the
  effective allowlist is visible;
- confirm the origin the browser actually used (`localhost` and `127.0.0.1` are
  different origins to a browser);
- if you serve the web build on another port, add it to `CORS_ORIGINS` in
  `backend/.env` — `*` is rejected at boot, by design.

**Client contract notes**
- `client.js` refreshes on 401 **single-flight**: the backend treats a replayed
  refresh token as theft and revokes the whole family, so concurrent 401s must
  collapse into one refresh call.
- Tokens: `localStorage` on web, `expo-secure-store` on native.
- Android emulator uses `10.0.2.2`; override with `EXPO_PUBLIC_API_URL` for a
  physical device.

---

## 8. Running it

```bash
cd mobile
npm install
npx expo start --web          # http://localhost:8081
npx expo start --web          # then open /?demo=1 to browse without the API
```

`?demo=1` (web only, never persisted) enters fixture mode so the screens are
reviewable with no backend. Every screen shows a `DemoBanner` in that mode; the
banner is intentionally un-dismissable.

---

## 9. Verification performed

Rendered in headless Chrome at 900px and 560px, light and dark:

- `/`, `/pings`, `/circles`, `/me` all render, route correctly, and show the
  expected content.
- Web bundle compiles clean (≈3.9 MB dev bundle, no errors).
- All 48 Ionicons names validated against the shipped glyph map.
- Fraunces + Inter load on web.

Not yet verified: iOS/Android native builds, and any authenticated flow
against a live API.
