# @watchtowerobservability/activity-web

Browser-only `<wt-activity>` custom element for the Watchtower hosted activity log. No dependencies, core file under 12 KB min+gz (checked by `npm run size`). Renders into shadow DOM; all event data is set with `textContent`.

```html
<script type="module" src="https://cdn.example/wt-activity.min.js"></script>
<wt-activity session="TOKEN" base-url="https://YOUR_WATCHTOWER_HOST" theme="system" accent="#2563eb" density="compact"></wt-activity>
```

```ts
import { mountActivity } from '@watchtowerobservability/activity-web';
const h = mountActivity(document.getElementById('log')!, { session: token });
```

Your backend mints `token` with `@watchtowerobservability/activity` (`createViewerSession`). It is sent only as `Authorization: Bearer`, never in a URL. Never put a secret key in the browser.

Theming: the project theme arrives with the first feed response and becomes `--wta-*` custom properties on the element. Precedence: attributes (`accent`) over page variables (`--wt-activity-bg`, `--wt-activity-accent`, `--wt-activity-fg`, ...) over the project theme.

Features: search, filters (action, actor, target type and id, outcome, severity, time range), event detail (changes as before/after, targets, credential, "via support" badge, metadata, copy buttons), theme `columns` / `detailFields`, per-locale strings (built-in en, de, fr, es, ja, pt-BR; session `locale` and `time_zone` claims or the `locale` attribute), Export (CSV via `fetch` + Blob, needs the `export` capability), Verify (recomputes row hashes with WebCrypto SHA-256 and checks the signed checkpoint with Ed25519 when the browser has it, else shows the server's verdict; `verify` capability), and live updates with the `live` attribute ("N new events").

Viewer UX: qualifier search (`actor:ada -outcome:denied created:>=2026-01-01`) with removable chips, sort (newest/oldest), page size (25/50/100, attribute `page-size`), relative/exact times, keyboard navigation (arrows or j/k, Home/End, Enter opens, Escape closes), a "Copy link" permalink per event (`#wta-event=<id>&wta-at=<time>` on the host page opens it), the theme's `environmentLabel` banner, right-to-left layout for RTL locales, empty/no-match/error states. Preferences persist per base URL in localStorage.

Lazy chunk: `dist/extras.js` (verify, per-event Merkle "Prove", column chooser, saved views, daily sparkline) is fetched on first use from next to the main script; host it beside `wt-activity.min.js` or set `extras-url`. With a pinned SRI embed, pin it too (dynamic imports carry no integrity).

React: `import { ActivityLog } from '@watchtowerobservability/activity-web/react'` (React is an optional peer, nothing of it is bundled); importing that entry also adds `<wt-activity>` to `JSX.IntrinsicElements`.

Exports: `mountActivity`, `WtActivity`, and the `Theme`, `Event`, `Feed` types.

License: Apache-2.0

## Signed, sealed and tokenised values

The detail drawer shows `signed_by` for customer-signed events. Values your backend sealed client-side (`$wt_cse` envelopes in `metadata`) open in the browser when the page sets `seal-key` (base64 AES-256 key) on `<wt-activity>`; the key never reaches Watchtower, so only pages that already hold it can show the plaintext. With the `reveal` capability, tokenised IPs and emails get a Reveal button (`POST /v1/activity/reveal`, each reveal is an audited `wt.activity.revealed` event).
