# Agent Kanban

A local Linear-style board for Cursor Cloud Agents. It uses the Cursor SDK to
list cloud agents, group them into kanban columns, preview artifacts on cards,
and create new cloud agents from a repository and prompt.

This product includes:

- required API-key onboarding before any Cloud Agent data loads,
- cloud-agent listing with grouping by status, repository, branch, or created
  date,
- agent cards with status, repo/branch metadata, latest activity, PR link, and
  artifact previews,
- create-agent flows backed by `Agent.create({ cloud: { repos } })`,
- authenticated artifact media previews proxied through local API routes.

## Getting Started

Prerequisites:

- Node.js 20 or newer
- pnpm 10
- a Cursor API key from the [Cursor integrations dashboard](https://cursor.com/dashboard/integrations)

```bash
pnpm install
pnpm dev
```

Open the local Next.js URL and complete onboarding by entering your Cursor API
key. If you keep "Remember this key" checked, the key is stored locally at
`~/.agent-kanban/settings.json`. Otherwise it is kept only in the in-memory app
session and will be forgotten when the server restarts.

## Scripts

```bash
pnpm dev
pnpm lint
pnpm build
pnpm start
```

## How It Works

- `/api/session` validates a Cursor API key, creates an app session, and manages
  the optional remembered key.
- `/api/agents` lists Cursor Cloud Agents and creates new agents with
  `Agent.create({ cloud: { repos } })`.
- `/api/models` and `/api/repositories` load available model and repository
  choices for the create-agent form.
- Artifact media is proxied through authenticated local API routes so previews do
  not expose the API key to the browser.

## Notes

Repository listing is rate-limited by the Cloud Agents API and is cached briefly
in memory. Artifact previews are fetched through authenticated local API routes,
so refresh the board if a preview stops loading.

## Troubleshooting

- If onboarding fails, confirm the key starts with `crsr_` and was created from
  the Cursor integrations dashboard.
- If repositories are empty, check that your Cursor/GitHub integration has access
  to the repositories you expect to use.
- If a created agent does not show immediately, click **Refresh**. Cloud Agent
  status and artifact data can lag briefly behind creation.
