# CMDB Explorer

A custom ServiceNow CMDB browser, built as a Fluent SDK application with a React 19
BYOUI page. Replaces the sluggish out-of-the-box CI Explorer with fast class-tree
browsing, search, and relationship navigation.

Deployed to the instance as the **CMDB Explorer** app, reachable at `/cmdb_explorer.do`
under the **IBWorks** application menu.

## Features

- **Class hierarchy sidebar** — full `cmdb_ci` class tree with rolled-up CI counts and a
  "Hide empty CI tables" toggle. The schema is stored statically (`src/client/data/classTree.ts`)
  to avoid a slow `sys_db_object` dot-walk; counts are fetched live.
- **Global search** — type-ahead across all CI classes (name, IP, FQDN, serial, asset tag).
- **Class browse** — class-aware CI lists via the CMDB Instance API.
- **Detail drawer** — attributes plus inbound/outbound relationships, click-through to walk
  the dependency graph.
- **Jira / Confluence actions** — "Search in Jira" (JQL) and "Search in Confluence" (CQL) for
  a CI. Admin-configurable system properties set the base URL and deployment type per tool:
  `ibworks.jira.base_url` / `ibworks.jira.type`, `ibworks.confluence.base_url` /
  `ibworks.confluence.type`. `*.type` is `dc` (Data Center/Server, the default) or `cloud`, and
  selects the search-URL format — Jira `/secure/IssueNavigator.jspa?jqlQuery=` (dc) vs
  `/issues/?jql=` (cloud); Confluence `/dosearchsite.action?cql=` (dc) vs `/search?cql=` (cloud).
  A base URL left at the shipped `your-domain.atlassian.net` placeholder disables its button.

## Architecture

| Layer | What |
|-------|------|
| `src/client/` | React 19 UI (`app.tsx`, `components/`, `services/`) |
| `src/client/services/CmdbService.ts` | Wraps Table API, CMDB Instance/Meta API, and Stats API |
| `src/fluent/` | Fluent metadata: UI page, application menu + module, system properties |
| `scripts/refresh-class-tree.mjs` | Regenerates the static class schema from a live instance |
| `docs/CmdbService.md` | Service-layer reference |

The service layer spans three ServiceNow REST families: the **Table API** for cross-class
search and joins, the **CMDB Instance/Meta API** for class-aware lists and pre-joined
relationships, and the **Stats API** for counts. See `docs/CmdbService.md`.

## Develop

```bash
npm install
npm run dev -- -a <instance-alias>   # hot-reload dev server at localhost:3000 (proxies /api)
```

## Build & deploy

```bash
npm run build
npm run deploy -- -a <instance-alias>   # stop the dev server first
```

## Refresh the class schema

The CMDB class hierarchy changes rarely, so it ships statically. Re-run when classes change:

```bash
SN_USER=<user> SN_PASSWORD=<pw> npm run refresh:classes
# optional: SN_INSTANCE=https://<instance>.service-now.com
```
