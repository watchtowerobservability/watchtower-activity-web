# @watchtowerobservability/activity-web

Browser-only `<wt-activity>` custom element for the Watchtower hosted activity log. No dependencies, single file under 12 KB min+gz (checked by `npm run size`). Renders into shadow DOM; all event data is set with `textContent`.

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

Exports: `mountActivity`, `WtActivity`, and the `Theme`, `Event`, `Feed` types.

License: Apache-2.0
