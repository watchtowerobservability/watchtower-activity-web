export interface Palette { bg?: string; fg?: string; muted?: string; accent?: string; border?: string; danger?: string }
export interface ActionStyle { label?: string; icon?: string; tone?: string }
/** The activity theme (see the Watchtower API reference). Every key is optional: unset keys fall through. */
export interface Theme {
  brandName?: string; logoUrl?: string; logoDarkUrl?: string; faviconUrl?: string;
  colorScheme?: 'system' | 'light' | 'dark';
  palette?: Palette; paletteDark?: Palette;
  font?: { family?: string; url?: string };
  radius?: string | number;
  density?: 'compact' | 'comfortable';
  strings?: { title?: string; emptyState?: string; loadMore?: string; allActions?: string; error?: string; retry?: string };
  customCss?: string;
  actions?: Record<string, ActionStyle>;
  showIp?: boolean; showMetadata?: boolean; hideWatchtowerBadge?: boolean;
}
export interface Event {
  id: string;
  account_id: string;
  actor: { id: string; name?: string; type?: string };
  action: string;
  target?: { type: string; id: string; name?: string };
  metadata?: Record<string, unknown>;
  ip?: string;
  occurred_at: string;
  received_at: string;
}
export interface Feed { data: Event[]; next_cursor?: string | null; theme?: Theme }
export interface MountOptions {
  session: string;
  baseUrl?: string;
  theme?: 'light' | 'dark' | 'system';
  accent?: string;
  density?: 'compact' | 'comfortable';
}
