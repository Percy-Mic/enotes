'use client';

import { Monitor, Moon, Palette, Sun, Waves, TreePine } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/lib/theme';

export const THEME_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  ocean: Waves,
  retro: Palette,
  forest: TreePine,
  system: Monitor,
};

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  ocean: 'Ocean',
  retro: 'Retro',
  forest: 'Forest',
  system: 'System',
};

/**
 * One-tap theme cycler: light → dark → ocean → retro → forest → system.
 * Styling is supplied by the caller via className so it can live in the
 * desktop nav, the mobile floating stack, or the landing header.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { mode, cycle } = useTheme();
  const Icon = THEME_ICONS[mode];

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${THEME_LABELS[mode]} — tap to change`}
      aria-label={`Theme: ${THEME_LABELS[mode]}. Activate to switch to the next theme.`}
      className={className}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
