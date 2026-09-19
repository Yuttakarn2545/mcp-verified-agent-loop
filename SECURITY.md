# Security model

This repository is intentionally designed so the demo agent **does not receive arbitrary computer access**.

## Workspace boundary

Every file tool resolves requested paths against a single `MCP_WORKSPACE_ROOT`.

The server rejects:

- absolute paths
- `..` traversal outside the workspace
- `.git`
- `node_modules`
- `.env`
- `.agent-runs`

## Command boundary

The MCP server does **not** expose a generic shell tool.

The only executable verification actions are fixed by the server:

- `node --check src/strings.js`
- `npm test`
- `git diff --no-ext-diff --unified=3`

The caller selects a named verification check, not a command string.

## Human approval

A successful test run is not the same as approval. The demo displays the diff and requires a human decision before the change is treated as accepted.

CI uses `--approve` only so the deterministic showcase can run unattended. This is clearly logged in the audit trail.

## Public-safety rule

Do not place employer source code, credentials, customer data, or private repositories in the demo workspace.
