import type { Strings } from './types';

/**
 * Built-in copy beyond en (lib.ts EN), by language: filled when the lazy ux.js loads a locale file
 * (dist/locales/<tag>.json, about 45 locales). The theme's strings override all of it.
 */
export const LOCALES: Record<string, Strings> = {};
