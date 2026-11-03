export interface Palette { bg?: string; fg?: string; muted?: string; accent?: string; border?: string; danger?: string }
export interface ActionStyle { label?: string; icon?: string; tone?: string }
/** A list column: `field` is a dotted path into the event ("actor.email", "metadata.plan", "occurred_at"). */
export interface Column { label: string; field: string; kind?: 'text' | 'badge' | 'time' }
export type Strings = Record<string, string>;
/** The activity theme (see the Watchtower API reference). Every key is optional: unset keys fall through. */
export interface Theme {
  brandName?: string; logoUrl?: string; logoDarkUrl?: string; faviconUrl?: string;
  colorScheme?: 'system' | 'light' | 'dark';
  palette?: Palette; paletteDark?: Palette;
  font?: { family?: string; url?: string };
  radius?: string | number;
  density?: 'compact' | 'comfortable';
  /** Per-locale map with a "default" entry (`{default: {...}, de: {...}}`); a flat map is read as "default". */
  strings?: Record<string, Strings | string>;
  customCss?: string;
  actions?: Record<string, ActionStyle>;
  /** Up to 8 extra columns. */
  columns?: Column[];
  /** Dotted paths shown first in the detail view. */
  detailFields?: string[];
  showIp?: boolean; showMetadata?: boolean; hideWatchtowerBadge?: boolean;
  showLocation?: boolean;
  /** Default on: "via support" badge when the actor acted on behalf of someone. */
  showImpersonation?: boolean;
  /** Hide the `wt.activity.*` self-audit events (viewed, exported, ...). */
  hideAccessEvents?: boolean;
  /** Actor / credential types the server never shows (for example `support`, `api_key`). */
  hideActorTypes?: string[]; hideCredentialTypes?: string[];
  /** Banner such as "Sandbox" for a test-mode project. */
  environmentLabel?: string;
}
export interface Target { type: string; id: string; name?: string }
export interface Event {
  id: string;
  account_id: string;
  actor: { id: string; name?: string; type?: string; email?: string; url?: string };
  on_behalf_of?: { id: string; name?: string };
  credential?: { type: string; id?: string; fingerprint?: string };
  action: string;
  target?: Target;
  targets?: Target[];
  changes?: { field: string; old?: unknown; new?: unknown }[];
  context?: { ip?: string; user_agent?: string; request_id?: string; session_id?: string; country?: string };
  outcome?: 'success' | 'failure' | 'denied';
  severity?: 'info' | 'notice' | 'warning' | 'critical';
  metadata?: Record<string, unknown>;
  ip?: string;
  /** The customer key that signed the event (`signature.kid`). */
  signed_by?: string;
  trace_id?: string; span_id?: string;
  /** Delegation chain, nearest hop first: who the actor acted for, with which model or tool, approved by whom. */
  via?: { actor: { id: string; name?: string; type?: string }; credential?: { type?: string; id?: string }; model?: string; tool?: string; approved_by?: { id: string; name?: string }; sig?: string }[];
  version?: number; schema_version?: number;
  occurred_at: string;
  received_at: string;
}
export interface Feed {
  data: Event[]; next_cursor?: string | null; theme?: Theme;
  /** Start of the searchable window; older events are archived (ask for a restore). */
  hot_from?: string | null;
  /** Actor ids on this page that were removed from the product. */
  removed_actors?: string[];
}
/** Feed filters; every key maps 1:1 to a `/v1/activity/feed` query parameter. */
export interface Filters {
  q?: string; action?: string; actor_id?: string; target_type?: string; target_id?: string;
  outcome?: string; severity?: string;
  /** Quick range ("24h" | "7d" | "30d") or "" with explicit from/to (RFC 3339). */
  range?: string; from?: string; to?: string;
}
export interface MountOptions {
  session: string;
  baseUrl?: string;
  theme?: 'light' | 'dark' | 'system';
  accent?: string;
  density?: 'compact' | 'comfortable';
  /** Overrides the session's locale claim. */
  locale?: string;
  /** Show the "Verify" button (needs the `verify` capability). */
  verify?: boolean;
  /** Live updates over SSE ("N new events"). */
  live?: boolean;
  /** First page size (25, 50 or 100; the viewer's own choice wins once made). */
  pageSize?: number;
  /** Where the lazy chunk lives (default: extras.js next to this script). */
  extrasUrl?: string;
  /** Where the UX chunk lives (default: ux.js next to this script; locale files sit in ./locales/ beside it). */
  uxUrl?: string;
  /** Load the next page when the "Load more" button scrolls into view. */
  infinite?: boolean;
}
