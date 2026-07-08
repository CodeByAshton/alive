// Appearance framework. Themes are data: a map of CSS custom properties
// applied to <html>. Tailwind v4 resolves every color through variables
// (--color-neutral-*, --color-white, plus the shadcn tokens), so overriding
// the ramp re-skins the whole app — including a real dark mode — without
// touching a single component class.

import type { AppSettings } from './settings';

export interface Theme {
  id: string;
  name: string;
  description: string;
  dark?: boolean;
  vars: Record<string, string>;
  // swatches for the gallery card
  preview: { canvas: string; card: string; text: string; border: string };
}

export const THEMES: Theme[] = [
  {
    id: 'light',
    name: 'Daylight',
    description: 'The default — white cards on a soft gray canvas.',
    vars: {},
    preview: { canvas: 'oklch(0.972 0 0)', card: 'oklch(1 0 0)', text: 'oklch(0.27 0 0)', border: 'oklch(0.912 0 0)' },
  },
  {
    id: 'dark',
    name: 'Midnight',
    description: 'True dark mode — easy on the eyes at night.',
    dark: true,
    vars: {
      '--background': 'oklch(0.19 0 0)',
      '--foreground': 'oklch(0.93 0 0)',
      '--card': 'oklch(0.21 0 0)',
      '--card-foreground': 'oklch(0.93 0 0)',
      '--popover': 'oklch(0.22 0 0)',
      '--popover-foreground': 'oklch(0.93 0 0)',
      '--primary': 'oklch(0.92 0 0)',
      '--primary-foreground': 'oklch(0.2 0 0)',
      '--secondary': 'oklch(0.27 0 0)',
      '--secondary-foreground': 'oklch(0.93 0 0)',
      '--muted': 'oklch(0.27 0 0)',
      '--muted-foreground': 'oklch(0.7 0 0)',
      '--accent': 'oklch(0.3 0 0)',
      '--accent-foreground': 'oklch(0.93 0 0)',
      '--border': 'oklch(0.31 0 0)',
      '--input': 'oklch(0.33 0 0)',
      '--ring': 'oklch(0.55 0 0)',
      '--canvas': 'oklch(0.155 0 0)',
      '--color-white': 'oklch(0.21 0 0)',
      '--color-neutral-50': 'oklch(0.235 0 0)',
      '--color-neutral-100': 'oklch(0.265 0 0)',
      '--color-neutral-200': 'oklch(0.31 0 0)',
      '--color-neutral-300': 'oklch(0.38 0 0)',
      '--color-neutral-400': 'oklch(0.56 0 0)',
      '--color-neutral-500': 'oklch(0.65 0 0)',
      '--color-neutral-600': 'oklch(0.75 0 0)',
      '--color-neutral-700': 'oklch(0.82 0 0)',
      '--color-neutral-800': 'oklch(0.89 0 0)',
      '--color-neutral-900': 'oklch(0.94 0 0)',
      '--color-neutral-950': 'oklch(0.97 0 0)',
    },
    preview: { canvas: 'oklch(0.155 0 0)', card: 'oklch(0.21 0 0)', text: 'oklch(0.89 0 0)', border: 'oklch(0.31 0 0)' },
  },
  {
    id: 'sepia',
    name: 'Paper',
    description: 'Warm, book-like tones for long reading sessions.',
    vars: {
      '--background': 'oklch(0.985 0.008 90)',
      '--card': 'oklch(0.985 0.008 90)',
      '--popover': 'oklch(0.985 0.008 90)',
      '--canvas': 'oklch(0.955 0.014 88)',
      '--border': 'oklch(0.895 0.018 85)',
      '--input': 'oklch(0.885 0.018 85)',
      '--secondary': 'oklch(0.955 0.012 88)',
      '--muted': 'oklch(0.955 0.012 88)',
      '--accent': 'oklch(0.94 0.014 87)',
      '--color-white': 'oklch(0.985 0.008 90)',
      '--color-neutral-50': 'oklch(0.972 0.01 89)',
      '--color-neutral-100': 'oklch(0.952 0.013 88)',
      '--color-neutral-200': 'oklch(0.905 0.017 86)',
      '--color-neutral-300': 'oklch(0.855 0.021 84)',
      '--color-neutral-400': 'oklch(0.68 0.026 80)',
      '--color-neutral-500': 'oklch(0.55 0.03 75)',
      '--color-neutral-600': 'oklch(0.45 0.033 70)',
      '--color-neutral-700': 'oklch(0.38 0.033 65)',
      '--color-neutral-800': 'oklch(0.29 0.03 60)',
      '--color-neutral-900': 'oklch(0.23 0.026 55)',
      '--color-neutral-950': 'oklch(0.17 0.02 50)',
    },
    preview: { canvas: 'oklch(0.955 0.014 88)', card: 'oklch(0.985 0.008 90)', text: 'oklch(0.32 0.03 60)', border: 'oklch(0.895 0.018 85)' },
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'A cool, blue-gray cast over the whole interface.',
    vars: {
      '--background': 'oklch(0.985 0.004 250)',
      '--card': 'oklch(0.985 0.004 250)',
      '--popover': 'oklch(0.985 0.004 250)',
      '--canvas': 'oklch(0.962 0.008 248)',
      '--border': 'oklch(0.9 0.01 248)',
      '--input': 'oklch(0.89 0.01 248)',
      '--secondary': 'oklch(0.962 0.007 248)',
      '--muted': 'oklch(0.962 0.007 248)',
      '--accent': 'oklch(0.945 0.009 248)',
      '--color-white': 'oklch(0.985 0.004 250)',
      '--color-neutral-50': 'oklch(0.975 0.005 249)',
      '--color-neutral-100': 'oklch(0.958 0.007 248)',
      '--color-neutral-200': 'oklch(0.91 0.01 248)',
      '--color-neutral-300': 'oklch(0.86 0.013 247)',
      '--color-neutral-400': 'oklch(0.69 0.018 245)',
      '--color-neutral-500': 'oklch(0.55 0.022 244)',
      '--color-neutral-600': 'oklch(0.44 0.024 243)',
      '--color-neutral-700': 'oklch(0.37 0.024 242)',
      '--color-neutral-800': 'oklch(0.28 0.022 241)',
      '--color-neutral-900': 'oklch(0.21 0.02 240)',
      '--color-neutral-950': 'oklch(0.15 0.016 240)',
    },
    preview: { canvas: 'oklch(0.962 0.008 248)', card: 'oklch(0.985 0.004 250)', text: 'oklch(0.3 0.022 242)', border: 'oklch(0.9 0.01 248)' },
  },
];

export interface Accent {
  id: string;
  name: string;
  value: string;
}

// Mid-lightness so the same accent reads on light and dark canvases.
export const ACCENTS: Accent[] = [
  { id: 'indigo', name: 'Indigo', value: 'oklch(0.51 0.14 262)' },
  { id: 'blue', name: 'Blue', value: 'oklch(0.55 0.13 240)' },
  { id: 'violet', name: 'Violet', value: 'oklch(0.53 0.15 300)' },
  { id: 'green', name: 'Green', value: 'oklch(0.55 0.12 155)' },
  { id: 'amber', name: 'Amber', value: 'oklch(0.62 0.12 70)' },
  { id: 'rose', name: 'Rose', value: 'oklch(0.55 0.15 15)' },
  { id: 'mono', name: 'Mono', value: 'oklch(0.4 0 0)' },
];

// Default-theme ramp values, used when high contrast needs to promote a step
// and the active theme doesn't override that variable.
const LIGHT_RAMP: Record<string, string> = {
  '--color-neutral-500': 'oklch(0.556 0 0)',
  '--color-neutral-600': 'oklch(0.439 0 0)',
};

const applied = new Set<string>();

export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement;
  const theme = THEMES.find((t) => t.id === settings.theme) ?? THEMES[0];
  const accent = ACCENTS.find((a) => a.id === settings.accent) ?? ACCENTS[0];

  const vars: Record<string, string> = { ...theme.vars, '--accent-color': accent.value };

  // High contrast is theme-relative: promote hairlines and the faintest text
  // steps to darker steps of whatever ramp is active.
  if (settings.highContrast) {
    vars['--border'] = vars['--color-neutral-500'] ?? LIGHT_RAMP['--color-neutral-500'];
    vars['--input'] = vars['--color-neutral-500'] ?? LIGHT_RAMP['--color-neutral-500'];
    vars['--color-neutral-400'] = vars['--color-neutral-600'] ?? LIGHT_RAMP['--color-neutral-600'];
    vars['--color-neutral-300'] = vars['--color-neutral-500'] ?? LIGHT_RAMP['--color-neutral-500'];
  }

  // Clear everything from the previous application, then set the new map —
  // switching back to Daylight must remove every override.
  for (const key of applied) root.style.removeProperty(key);
  applied.clear();
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
    applied.add(key);
  }

  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.classList.toggle('reduce-motion', settings.reduceMotion);
  // zoom scales every px-based size in the app uniformly.
  (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String((settings.uiScale || 100) / 100);
}
