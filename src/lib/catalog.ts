// Curated connector catalog — the well-known hosted MCP servers, Claude-style:
// pick one, it's pre-configured, and (for OAuth providers) you just click
// Connect. URLs are editable after adding in case a provider moves.

export interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  url: string;
  auth: 'oauth' | 'token' | 'open';
}

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Read and edit your Notion pages and databases.',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Search, create, and update Linear issues and projects.',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    description: 'Look up errors, issues, and performance data.',
    url: 'https://mcp.sentry.dev/mcp',
    auth: 'oauth',
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Inspect customers, payments, and subscriptions.',
    url: 'https://mcp.stripe.com',
    auth: 'oauth',
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'Query and manage your Supabase projects and databases.',
    url: 'https://mcp.supabase.com/mcp',
    auth: 'oauth',
  },
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Repos, issues, and pull requests via the hosted GitHub MCP.',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
  },
  {
    slug: 'zapier',
    name: 'Zapier',
    description: 'Thousands of apps through your personal Zapier MCP endpoint.',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    auth: 'token',
  },
  {
    slug: 'deepwiki',
    name: 'DeepWiki',
    description: 'Ask questions about any public GitHub repository. No account needed.',
    url: 'https://mcp.deepwiki.com/mcp',
    auth: 'open',
  },
];
