# plan.ai-chat (chat.plan.ai)

plan.ai-chat is a server-side rendered (SSR) web application providing chat functionality, user authentication, and an administrative dashboard for the **plan.ai** ecosystem.

## Tech Stack

- **Framework**: [Astro](https://astro.build/) (Node SSR adapter)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Database & Auth**: [Supabase](https://supabase.com/)
- **AI Integration**: Anthropic SDK
- **Testing**: [Vitest](https://vitest.dev/)
- **Environment**: Managed via Nix (`flake.nix`, `module.nix`) & `pnpm`

## Getting Started

### 1. Installation

Ensure you have Node.js and `pnpm` installed (or use the provided Nix flake). 

```bash
pnpm install
```

### 2. Environment Variables

Copy the example environment file and fill in your Supabase keys and Anthropic tokens:

```bash
cp .env.local.example .env.local
```

### 3. Local Development

Start the Astro development server:

```bash
pnpm dev
```

### 4. Testing

Run the Vitest suite:

```bash
pnpm test
# For integration tests:
pnpm test:integration
```

## Database (Supabase)

This project strictly follows a declarative schema workflow.

- **Schemas**: Located in `supabase/schemas/`
- **Migrations**: Auto-generated in `supabase/migrations/`

For making database changes, edit the files in `supabase/schemas/` and create migrations using the Supabase CLI:
```bash
pnpm supabase migration new <migration_name>
```

## Deployment

The application is built for a standard Node environment setup using `server.mjs`.

```bash
# Build for production
pnpm build

# Run production server locally
pnpm start
```
