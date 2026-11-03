// Optional React wrapper. React is a peer: nothing of it is bundled; import this entry only from React apps.
import { createElement, useEffect, useRef, type CSSProperties } from 'react';
import './index';
import type { WtActivity } from './index';

/** Attributes of <wt-activity>; booleans become present/absent attributes. */
export interface WtActivityAttributes {
  session: string;
  'base-url'?: string;
  theme?: 'light' | 'dark' | 'system';
  accent?: string;
  density?: 'compact' | 'comfortable';
  locale?: string;
  live?: boolean | '';
  verify?: boolean | '';
  'page-size'?: string;
  'extras-url'?: string;
  'ux-url'?: string;
  infinite?: boolean | '';
  class?: string;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'wt-activity': WtActivityAttributes & { ref?: unknown; key?: string | number };
    }
  }
}

export interface ActivityLogProps {
  session: string; baseUrl?: string; theme?: 'light' | 'dark' | 'system'; accent?: string;
  density?: 'compact' | 'comfortable'; locale?: string; live?: boolean; verify?: boolean;
  className?: string; style?: CSSProperties;
}

/** `<ActivityLog session={token} />`: the <wt-activity> element with typed props. */
export function ActivityLog(p: ActivityLogProps) {
  const ref = useRef<WtActivity>(null);
  // Attributes set imperatively so booleans and a session change behave the same in React 18 and 19.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const attrs: Record<string, string | boolean | undefined> = {
      session: p.session, 'base-url': p.baseUrl, theme: p.theme, accent: p.accent, density: p.density, locale: p.locale, live: p.live, verify: p.verify,
    };
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) el.removeAttribute(k);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }, [p.session, p.baseUrl, p.theme, p.accent, p.density, p.locale, p.live, p.verify]);
  return createElement('wt-activity', { ref, className: p.className, style: p.style });
}
