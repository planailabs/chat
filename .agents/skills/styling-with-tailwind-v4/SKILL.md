---
name: styling-with-tailwind-v4
description: Use when modifying CSS or adding Tailwind classes in the project. Covers Tailwind v4 Vite integration, theme-aware variables, and the primary style.css configuration.
---

# Styling with Tailwind v4

## Overview

This project uses **Tailwind CSS v4** via the official Vite plugin (`@tailwindcss/vite`). It relies heavily on CSS variables for theme switching and layout.

## Configuration

- **Vite Plugin**: Configured in `web/vite.config.ts` (`plugins: [tailwindcss()]`).
- **Base Styles**: Centralized in `web/src/chat/style.css` (also imported by the dashboard).
- **Theme Variables**: Defined in `web/src/chat/style.css` using the `@theme` block or standard CSS variables.

## Theme-Aware Styles

Use the custom variables for automatic light/dark mode support:

- `bg-(--surface-base)`: Base background color.
- `text-(--text-primary)`: Primary text color.
- `text-(--text-muted)`: Secondary/muted text color.

## CSS Patterns

- **Raw CSS over Abstractions**: Since Tailwind v4 is highly integrated with CSS, prefer standard CSS nesting and variables in `style.css` for complex components.
- **Responsive Utilities**: Use standard Tailwind prefixes like `md:`, `lg:` for layout adjustments.

## Best Practices

- **No Config File**: Tailwind v4 often eliminates the need for `tailwind.config.js`. Use CSS variables for design tokens.
- **Inline Styles**: Avoid large inline style blocks; move them to the Vite-processed `style.css`.
