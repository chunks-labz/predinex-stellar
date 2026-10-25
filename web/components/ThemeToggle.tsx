'use client';

import { useTheme } from '@/app/context/ThemeContext';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
    >
      {isDark ? (
        <Sun className="w-5 h-5 text-yellow-400" aria-hidden="true" />
      ) : (
        <Moon className="w-5 h-5 text-gray-800" aria-hidden="true" />
      )}
    </button>
  );
}
// Theme toggle enhancement 1
// Theme toggle enhancement 2
// Theme toggle enhancement 3
// Theme toggle enhancement 4
// Theme toggle enhancement 5
// Theme toggle enhancement 6
// Theme toggle enhancement 7
// Theme toggle enhancement 8
// Theme toggle enhancement 9
// Theme toggle enhancement 10
