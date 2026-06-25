# CmdbService

A thin client-side wrapper (`src/client/services/CmdbService.ts`) over the three
ServiceNow REST API families a CMDB explorer needs. It runs in the React UI page
and authenticates with the per-session user token (`window.g_ck`) ServiceNow
injects into every UI page — no server-side script required.

## Why three APIs?

| Family | Base path | What it's for | Why not just one? |
|--------|-----------|---------------|-------------------|
| **Table API** | `/api/now/table` | Cross-class search; joins (incidents on a CI) | CMDB API is per-class and can't join other tables |
| **CMDB Instance / Meta API** | `/api/now/cmdb` | Class-aware CI lists, **pre-joined relationships**, class metadata | Table API would make you join `cmdb_rel_ci` by hand |
| **Stats / Aggregate API** | `/api/now/stats` | Counts & aggregates (wraps `GlideAggregate`) | Table API has no GROUP BY / COUNT |

All three share auth (`X-UserToken: g_ck`) and the `{ result }` JSON envelope, so
a single private `request()` helper serves every method and normalizes errors
into thrown `Error`s carrying the platform's own message.

## Quick start

```ts
import { CmdbService } from './services/CmdbService'

const cmdb = new CmdbService()
```

## Methods

### `searchCIs(term, opts?)` — global type-ahead

Cross-class search over the base `cmdb_ci` table (Table API). The CMDB Instance
API is per-class, so the global search box must go here.

```ts
const hits = await cmdb.searchCIs('web01', { limit: 25 })
// matches name, ip_address, fqdn, serial_number, asset_tag by default
// → [{ sys_id, name, sys_class_name, ip_address, sys_updated_on }, ...]
```

- `opts.fields` — override which columns the `LIKE` matches (OR'd together).
- `opts.limit` — keep small (default 25) for an "instant" feel; deep paging on
  `cmdb_ci` is slow.

### `listByClass(className, opts?)` — browse within one class

Class-scoped list via the **Table API on the leaf class table**
(`/api/now/table/{className}`). Returns the class's own leaf columns and honors
`sysparm_fields` — which the column picker needs.

> **Not** the CMDB Instance *list* endpoint (`/api/now/cmdb/instance/{class}`):
> despite its name it returns only `{ sys_id, name }` and ignores
> `sysparm_fields`. The Instance API is still the right call for one CI **+ its
> relationships** (`getCI`), just not for column lists.

```ts
const linux = await cmdb.listByClass('cmdb_ci_linux_server', {
    query: 'operational_status=1^ORDERBYname', // encoded query (WHERE)
    fields: ['sys_id', 'name', 'ip_address', 'cpu_count'],
    limit: 50,
    offset: 0,
})
```

### `getCI(className, sysId)` — CI detail **+ relationships**

Single CI with attributes plus `inbound_relations` / `outbound_relations` in one
call. The platform does the `cmdb_rel_ci` join for you; each relation's
`target.link` is a ready-to-fetch URL, so "expand this node" is just another
`getCI()`.

```ts
const ci = await cmdb.getCI('cmdb_ci_linux_server', sysId)
ci.attributes.name
ci.outbound_relations // [{ sys_id, type: {display_value:'Depends on::Used by'}, target: {value, display_value, link} }]
```

> **Requires the ITIL role.** Without it the CMDB Instance API returns 403.

### `getClassMeta(className)` — class metadata

Attributes, dependent fields, and relationship rules for a class (CMDB Meta API).
Drives the column picker and filter chips. **Cache it** — it changes rarely and
the payload is large.

```ts
const meta = await cmdb.getClassMeta('cmdb_ci_linux_server')
```

### `getCounts(table, opts?)` — counts & aggregates

Wraps the Stats API (`GlideAggregate`). One call with `groupBy` returns a
histogram across a dimension.

```ts
// CI count per class, biggest first
const buckets = await cmdb.getCounts('cmdb_ci', {
    groupBy: ['sys_class_name'],
    orderBy: 'COUNT^DESC',
    having: 'count^sys_class_name^>^100', // optional: only sizeable classes
})
// → [{ groupby_fields:[{field, value, display_value}], stats:{ count:'412' } }, ...]
```

Options map directly onto `sysparm_*`:

| Option | Param | Purpose |
|--------|-------|---------|
| `count` (default true) | `sysparm_count` | return record count |
| `groupBy` | `sysparm_group_by` | GROUP BY dimensions |
| `query` | `sysparm_query` | filter rows first (WHERE) |
| `having` | `sysparm_having` | filter on the aggregate (`agg^field^op^value`) |
| `orderBy` | `sysparm_order_by` | e.g. `COUNT^DESC` |
| `avgFields`/`minFields`/`maxFields`/`sumFields` | `sysparm_<agg>_fields` | numeric aggregates |
| `displayValue` (default `all`) | `sysparm_display_value` | label grouped reference/choice fields |

> **Counts respect read ACLs** — rows the user can't read are silently excluded,
> so totals can differ per user.

### Convenience helpers

- **`ciCountsByClass(query?)`** → `[{ className, label, count }]`, biggest first.
  Built for the filter-chip badges.

## Putting it together — search results with class chips

```ts
const cmdb = new CmdbService()

const [hits, chips] = await Promise.all([
    cmdb.searchCIs('prod'),
    cmdb.ciCountsByClass(), // chip badges
])

const rows = hits.map((ci) => ({ ...ci }))
```

## Error handling

Every method throws an `Error` on non-2xx. The message is ServiceNow's
`error.message` when present, otherwise `HTTP error <status>`. Wrap calls in
`try/catch` (or an error boundary) at the component level.

## Notes & gotchas

- **Field shape differs by API** (verified against `dev380385`):
  - `searchCIs()` / `listByClass()` (Table + Instance _list_) and the Stats
    helpers use `sysparm_display_value=all`, so reference/choice fields come
    back as `{ value, display_value, link }` objects — read `ci.name.value` for
    the sys_id-side and `ci.name.display_value` for the label.
  - **`getCI()` is the exception**: the CMDB Instance _detail_ endpoint ignores
    `sysparm_display_value`, so `result.attributes` values are **raw strings**
    (`ci.attributes.name === 'ThinkStation S20'`, not an object). Its
    `inbound_/outbound_relations[].target` and `.type` _are_ objects, though.
- **Pagination**: `sysparm_offset` gets slow at high offsets. Prefer tighter
  queries over deep paging for search.
- **Class names** are table names (`cmdb_ci_linux_server`), discoverable via
  `ciCountsByClass()` or `getClassMeta()`.
