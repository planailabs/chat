---
name: managing-plan.ai-content
description: Use when modifying how markdown (MDX) content is loaded or rendered. The project currently uses an eager import.meta.glob pattern for core docs, but will rely on Astro Content Collections for the future /news section.
---

# Managing Plan.ai Content

## Overview

Unlike standard Astro v5 projects, `plan.ai-website` **does not** use Content Collections (`content.config.ts`) or the Content Layer API. Instead, it relies on Vite's `import.meta.glob` to load markdown files eagerly and maps them to a static tree structure.

## Core Content Pattern

### 1. Data Source

Content lives in `src/data/content/[lang]/plan.ai/`.

### 2. Static Tree (`plan.tree.ts`)

The structure of the documentation is predefined in `src/components/plan/plan.ai/plan.tree.ts`. This acts as the source of truth for navigation and ordering.

```ts
export const planTree: PlanNode[] = [
  {
    title: '1. Introduction',
    file: '1-intro.mdx',
  },
  // ...
];
```

### 3. Eager Loading (`PlanContent.astro`)

The content is fetched eagerly at build time using `import.meta.glob`.

```ts
const modules = import.meta.glob(
  '../../../data/content/de/plan.ai/**/*.{md,mdx}',
  { eager: true },
);
```

The modules are then mapped against the `planTree` to render the content sequentially.

## Best Practices

- **Main Docs Only**: Do not use `getCollection` or `defineCollection` for the main plan.ai docs. They strictly use the glob approach.
- **Adding Pages**: To add a new page, create the `.mdx` file in `src/data/content/...` AND add a corresponding entry to `plan.tree.ts`.
- **Custom Rehype**: The project uses custom plugins (like `rehypeShiftHeadingScoped`) defined in `astro.config.mjs` which automatically process the glob-imported markdown.

## Future: Content Collections (for /news)

In the future, the `/news` section will use Astro's Live Content Collections (`astro:content`).

- **Loader**: Use either `glob` or `file` loaders from `astro/loaders` to fetch content.
- **Schema**: Use Zod (`astro/zod`) to define the frontmatter schema to validate fields (e.g. `title: z.string()`, `pubDate: z.date()`).
- **Definition**: Define inside `src/content.config.ts` using `defineCollection` and export via `export const collections = { news };`.
