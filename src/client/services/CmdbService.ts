import { CLASS_SCHEMA } from '../data/classTree'

// Extend Window interface to include g_ck (the per-session CSRF user token
// ServiceNow injects into every UI page). All authenticated REST calls must
// send it as the X-UserToken header or the platform rejects them.
declare global {
    interface Window {
        g_ck: string
    }
}

/** A ServiceNow reference/choice value rendered with sysparm_display_value=all. */
export interface DisplayValue {
    value: string
    display_value: string
    link?: string
}

/** One side of a CI relationship as returned by the CMDB Instance API. */
export interface CiRelation {
    sys_id: string // sys_id of the cmdb_rel_ci row
    type: { display_value: string; value: string } // e.g. "Depends on::Used by"
    target: DisplayValue // the CI on the other end; target.link is fetchable
}

/** Response shape of GET /api/now/cmdb/instance/{class}/{sys_id}.
 *  NOTE: `attributes` is mixed — scalar fields come back as plain strings, but
 *  POPULATED reference fields come back as { value, display_value, link }
 *  objects. Always read attribute values through dv() (display.ts), never
 *  render them raw (React error #31). (Verified against dev380385.) */
export interface CiInstance {
    attributes: Record<string, string | DisplayValue>
    inbound_relations: CiRelation[]
    outbound_relations: CiRelation[]
}

/** One bucket from the Stats API when grouping. */
export interface StatBucket {
    groupby_fields: Array<{ field: string; value: string; display_value: string }>
    stats: { count?: string; avg?: Record<string, string>; min?: Record<string, string> }
}

/** A node in the CMDB class hierarchy with a rolled-up (inclusive) CI count. */
export interface ClassNode {
    name: string // table name, e.g. cmdb_ci_linux_server
    label: string // human label, e.g. "Linux Server"
    count: number // CIs of this class AND all descendants
    own: number // CIs whose exact sys_class_name is this class
    children: ClassNode[]
}

/** A selectable attribute (column) of a CMDB class, from the Meta API. */
export interface ClassAttribute {
    name: string // the `element` (column name), e.g. "ip_address"
    label: string // human label, e.g. "IP Address"
    type: string // e.g. "string", "reference", "integer"
}

/**
 * Thin client wrapper over the three ServiceNow REST families a CMDB explorer
 * needs:
 *
 *  - Table API   (/api/now/table)    — cross-class search + joins the CMDB API can't do
 *  - CMDB API    (/api/now/cmdb)     — class-aware CI lists, pre-joined relations, class metadata
 *  - Stats API   (/api/now/stats)    — counts / aggregates without a server script
 *
 * Every method funnels through `request()`, which attaches auth and normalizes
 * errors. Read methods unwrap the `{ result }` envelope for the caller.
 */
export class CmdbService {
    /** Base CI table. Every CI, regardless of class, is queryable here. */
    private readonly baseTable = 'cmdb_ci'

    /** Per-class cache of selectable attributes (column picker). */
    private metaAttrCache = new Map<string, ClassAttribute[]>()

    /** Per-class cache of default-list-view columns. */
    private listColCache = new Map<string, string[]>()

    /** Lazily-built { table -> parent table } map from the static schema. */
    private parentMap?: Record<string, string>

    // ---- internal -------------------------------------------------------

    /** The class chain from `className` up to the root (cmdb_ci), nearest first. */
    private classChain(className: string): string[] {
        if (!this.parentMap) {
            this.parentMap = {}
            for (const c of CLASS_SCHEMA) this.parentMap[c.n] = c.p || ''
        }
        const chain: string[] = []
        const seen = new Set<string>()
        let cur: string | undefined = className
        while (cur && !seen.has(cur)) {
            seen.add(cur)
            chain.push(cur)
            cur = this.parentMap[cur]
        }
        return chain
    }

    /**
     * Single fetch helper shared by all three API families. Adds the user
     * token, requests JSON, and turns non-2xx responses into thrown Errors
     * carrying the platform's own message when present.
     */
    private async request(path: string, init: RequestInit = {}) {
        const response = await fetch(path, {
            ...init,
            headers: {
                Accept: 'application/json',
                'X-UserToken': window.g_ck,
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...init.headers,
            },
        })

        if (!response.ok) {
            // ServiceNow returns { error: { message, detail } } on failure.
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error?.message || `HTTP error ${response.status}`)
        }

        // DELETE and some writes return an empty body.
        if (response.status === 204) return null
        return response.json()
    }

    // ---- search & browse (Table API) -----------------------------------

    /**
     * Global type-ahead across ALL CI classes. The CMDB Instance API is
     * per-class, so the cross-class search box has to go through the Table API
     * on the base cmdb_ci table.
     *
     * @param term  free-text typed by the user
     * @param opts.fields   columns to match against (default: name, IP, FQDN, serial, asset tag)
     * @param opts.limit    max rows (keep small for "instant" feel; default 25)
     */
    async searchCIs(term: string, opts: { fields?: string[]; limit?: number; activeOnly?: boolean } = {}) {
        const fields = opts.fields ?? ['name', 'ip_address', 'fqdn', 'serial_number', 'asset_tag']
        // Build an OR'd match group, then AND the active filter so it applies to
        // the whole group: (nameLIKE..^OR..)^operational_status=1.
        const matchGroup = fields.map((f, i) => `${i === 0 ? '' : 'OR'}${f}LIKE${term}`).join('^')
        const activeFilter = opts.activeOnly ? '^operational_status=1' : ''

        const params = new URLSearchParams({
            sysparm_display_value: 'all',
            sysparm_fields: 'sys_id,name,sys_class_name,ip_address,sys_updated_on',
            sysparm_limit: String(opts.limit ?? 25),
            sysparm_query: `${matchGroup}${activeFilter}^ORDERBYname`,
        })

        const { result } = await this.request(`/api/now/table/${this.baseTable}?${params}`)
        return result || []
    }

    // ---- tasks (Table API) ---------------------------------------------

    /**
     * Type-ahead over the base `task` table for the "Add to task" picker. Because
     * task subclasses (incident, change_request, problem, sc_task, change_task…)
     * all extend `task`, one query finds any of them. Matches the number or short
     * description, most-recently-updated first.
     */
    async searchTasks(term: string, opts: { limit?: number } = {}) {
        const params = new URLSearchParams({
            sysparm_display_value: 'all',
            sysparm_fields: 'sys_id,number,short_description,sys_class_name,state',
            sysparm_limit: String(opts.limit ?? 25),
            sysparm_query: `numberLIKE${term}^ORshort_descriptionLIKE${term}^ORDERBYDESCsys_updated_on`,
        })
        const { result } = await this.request(`/api/now/table/task?${params}`)
        return result || []
    }

    /**
     * Link CIs to a task as Affected CIs by inserting `task_ci` rows (task +
     * ci_item). One POST per CI; resolves once all settle. Returns the count
     * inserted. (No dedup yet — a CI already on the task will get a second row.)
     */
    async addCisToTask(taskSysId: string, ciSysIds: string[]): Promise<number> {
        const inserts = ciSysIds.map((ci) =>
            this.request('/api/now/table/task_ci', {
                method: 'POST',
                body: JSON.stringify({ task: taskSysId, ci_item: ci }),
            }),
        )
        await Promise.all(inserts)
        return ciSysIds.length
    }

    /**
     * The CIs already linked to a task (its Affected CIs). Reads task_ci and
     * dot-walks ci_item for the CI name + class. Used by the "Existing affected
     * CIs" tab and to flag selected CIs that are already on the task.
     */
    async getTaskCis(taskSysId: string): Promise<Array<{ sysId: string; name: string; className: string }>> {
        const params = new URLSearchParams({
            sysparm_display_value: 'all',
            sysparm_fields: 'ci_item,ci_item.sys_class_name',
            sysparm_query: `task=${taskSysId}`,
            sysparm_limit: '1000',
        })
        const { result } = await this.request(`/api/now/table/task_ci?${params}`)
        return (result || [])
            .map((r: any) => ({
                sysId: r.ci_item?.value ?? '',
                name: r.ci_item?.display_value || r.ci_item?.value || '',
                className: r['ci_item.sys_class_name']?.value || '',
            }))
            .filter((c: { sysId: string }) => c.sysId)
    }

    /**
     * Link many CIs to a task in a SINGLE HTTP call via the Batch REST API
     * (/api/now/v1/batch). Each task_ci insert becomes one sub-request (its body
     * base64-encoded, as the batch API requires); the platform runs them
     * server-side and returns a per-request status. Returns counts of inserted
     * vs failed so the caller can report partial success.
     *
     * Pair this with an AMB record-watcher subscription on task_ci for live
     * progress: subscribe first, then call this.
     */
    async addCisToTaskBatch(taskSysId: string, ciSysIds: string[]): Promise<{ ok: number; failed: number }> {
        if (!ciSysIds.length) return { ok: 0, failed: 0 }
        const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))

        const rest_requests = ciSysIds.map((ci, i) => ({
            id: String(i),
            method: 'POST',
            url: '/api/now/table/task_ci',
            headers: [
                { name: 'Content-Type', value: 'application/json' },
                { name: 'Accept', value: 'application/json' },
            ],
            body: b64(JSON.stringify({ task: taskSysId, ci_item: ci })),
        }))

        const resp = await this.request('/api/now/v1/batch', {
            method: 'POST',
            body: JSON.stringify({ batch_request_id: '1', rest_requests }),
        })

        const serviced: Array<{ status_code?: number }> = resp?.serviced_requests ?? []
        const unserviced: string[] = resp?.unserviced_requests ?? []
        let ok = 0
        for (const r of serviced) {
            const code = Number(r.status_code ?? 0)
            if (code >= 200 && code < 300) ok++
        }
        const failed = ciSysIds.length - ok
        // unserviced are also failures; folded into `failed` via the count above.
        void unserviced
        return { ok, failed }
    }

    // ---- CMDB Instance API ---------------------------------------------

    /**
     * Class-scoped CI list via the Table API on the LEAF class table.
     *
     * Why not the CMDB Instance list endpoint (/api/now/cmdb/instance/{class})?
     * Despite its name, that list form returns only { sys_id, name } and ignores
     * sysparm_fields — it's a summary picker feed, not a column source. (Verified
     * against dev380385.) Querying the leaf table directly (e.g.
     * /api/now/table/cmdb_ci_linux_server) returns the class's own leaf columns
     * AND honors sysparm_fields, which the column picker needs. Table inheritance
     * means a parent table still returns its subclass rows, so this works at any
     * level of the hierarchy. (The CMDB Instance *detail* endpoint is still the
     * right call for one CI + its relationships — see getCI.)
     *
     * @param className  e.g. "cmdb_ci_linux_server"
     * @param opts.query   ServiceNow encoded query (WHERE)
     * @param opts.fields  comma-list or array of columns to return
     * @param opts.limit / opts.offset  pagination
     */
    async listByClass(
        className: string,
        opts: { query?: string; fields?: string[]; limit?: number; offset?: number } = {},
    ) {
        const params = new URLSearchParams({ sysparm_display_value: 'all' })
        // Order by name unless the caller already specified an ORDERBY.
        const query = opts.query
        const ordered = !query ? 'ORDERBYname' : /ORDERBY/i.test(query) ? query : `${query}^ORDERBYname`
        params.set('sysparm_query', ordered)
        if (opts.fields) params.set('sysparm_fields', opts.fields.join(','))
        if (opts.limit != null) params.set('sysparm_limit', String(opts.limit))
        if (opts.offset != null) params.set('sysparm_offset', String(opts.offset))

        const { result } = await this.request(`/api/now/table/${className}?${params}`)
        return result || []
    }

    /**
     * Single CI with attributes AND relationships in one call. The platform
     * does the cmdb_rel_ci join server-side; each relation's `target.link` is a
     * ready-to-fetch URL, so "expand this node" is one more getCI().
     *
     * Requires the caller to have the ITIL role.
     */
    async getCI(className: string, sysId: string): Promise<CiInstance> {
        const { result } = await this.request(`/api/now/cmdb/instance/${className}/${sysId}`)
        return result
    }

    // ---- CMDB Meta API --------------------------------------------------

    /**
     * Class metadata (attributes, dependent fields, relationship rules) used to
     * drive the column picker and class filter chips. Cache the result — it
     * changes rarely and the payload is large.
     */
    async getClassMeta(className: string) {
        const { result } = await this.request(`/api/now/cmdb/meta/${className}`)
        return result
    }

    /**
     * Selectable attributes (columns) of a class, derived from the Meta API's
     * `result.attributes`. Drives the column picker; results are cached per
     * class because the metadata changes rarely and the Meta payload is large.
     *
     * @param className  e.g. "cmdb_ci_linux_server"
     */
    async getClassAttributes(className: string): Promise<ClassAttribute[]> {
        const cached = this.metaAttrCache.get(className)
        if (cached) return cached

        const result = await this.getClassMeta(className)
        const attributes = Array.isArray(result?.attributes) ? result.attributes : []
        const mapped = attributes
            .map((a: any) => ({ name: a.element, label: a.label || a.element, type: a.type }))
            .filter((a: ClassAttribute) => a.name)
            .sort((a: ClassAttribute, b: ClassAttribute) => a.label.localeCompare(b.label))

        this.metaAttrCache.set(className, mapped)
        return mapped
    }

    /**
     * The table's DEFAULT LIST VIEW columns — the same column set users see in
     * the native list UI. Read from sys_ui_list (the list definition) joined to
     * sys_ui_list_element (its ordered columns). Used as the column-picker
     * default so the explorer matches platform expectations.
     *
     * The "table's own default list" is the one with sys_user EMPTY (not a
     * personal list), parent EMPTY (not a related list), and the Default view —
     * which an instance stores either as an empty `view` or the literal
     * "Default view" sentinel, so we accept both. If the leaf class defines no
     * list, we walk UP the class chain and use the nearest ancestor that does
     * (matching how the platform inherits list layouts). Dot-walked columns
     * (e.g. "location.name") are dropped so every default is also a pickable
     * attribute. Returns [] if nothing in the chain defines a list — the caller
     * then falls back to its own default set. Cached per class.
     */
    async getDefaultListColumns(className: string): Promise<string[]> {
        const cached = this.listColCache.get(className)
        if (cached) return cached

        const chain = this.classChain(className)
        // One query for every candidate list in the chain (Table API default
        // display value = false, so these come back as plain strings).
        const listParams = new URLSearchParams({
            sysparm_fields: 'sys_id,name,view',
            sysparm_query: `nameIN${chain.join(',')}^sys_userISEMPTY^parentISEMPTY`,
            sysparm_limit: '500',
        })
        const { result: lists } = await this.request(`/api/now/table/sys_ui_list?${listParams}`)

        // `view` is a reference field, so the Table API returns it as a
        // { value, link } object even without display values — read .value.
        const viewVal = (v: any): string => (v && typeof v === 'object' ? (v.value ?? '') : (v ?? ''))
        const isDefaultView = (v: any) => viewVal(v) === '' || viewVal(v) === 'Default view'
        // Pick the nearest class in the chain that has a default-view list.
        let listId = ''
        for (const table of chain) {
            const hit = (lists || []).find((l: any) => l.name === table && isDefaultView(l.view))
            if (hit) {
                listId = hit.sys_id
                break
            }
        }
        if (!listId) {
            this.listColCache.set(className, [])
            return []
        }

        const elParams = new URLSearchParams({
            sysparm_fields: 'element',
            sysparm_query: `list_id=${listId}^ORDERBYposition`,
            sysparm_limit: '200',
        })
        const { result: els } = await this.request(`/api/now/table/sys_ui_list_element?${elParams}`)
        const cols: string[] = (els || [])
            .map((e: any) => e.element)
            .filter((c: string) => c && !c.includes('.'))

        this.listColCache.set(className, cols)
        return cols
    }

    // ---- Stats / Aggregate API -----------------------------------------

    /**
     * Counts & aggregates without a server script (wraps GlideAggregate).
     * One call with `groupBy` returns a histogram across a dimension — e.g.
     * CI count per class for the filter-chip badges.
     *
     * NOTE: respects the caller's read ACLs, so counts can differ per user.
     *
     * @param table        table to aggregate (e.g. "cmdb_ci", "incident")
     * @param opts.groupBy fields to GROUP BY; labels need displayValue !== false
     * @param opts.query   encoded query applied before aggregating (WHERE)
     * @param opts.having  aggregate filter, e.g. "count^sys_class_name^>^100"
     * @param opts.orderBy e.g. "COUNT^DESC"
     * @param opts.count   include record counts (default true)
     * @param opts.avgFields / minFields / maxFields / sumFields  numeric aggregates
     * @param opts.displayValue  "all" (default) to label grouped reference fields
     */
    async getCounts(
        table: string,
        opts: {
            groupBy?: string[]
            query?: string
            having?: string
            orderBy?: string
            count?: boolean
            avgFields?: string[]
            minFields?: string[]
            maxFields?: string[]
            sumFields?: string[]
            displayValue?: 'all' | 'true' | 'false'
        } = {},
    ): Promise<StatBucket[]> {
        const params = new URLSearchParams()
        if (opts.count !== false) params.set('sysparm_count', 'true')
        if (opts.groupBy?.length) params.set('sysparm_group_by', opts.groupBy.join(','))
        if (opts.query) params.set('sysparm_query', opts.query)
        if (opts.having) params.set('sysparm_having', opts.having)
        if (opts.orderBy) params.set('sysparm_order_by', opts.orderBy)
        if (opts.avgFields?.length) params.set('sysparm_avg_fields', opts.avgFields.join(','))
        if (opts.minFields?.length) params.set('sysparm_min_fields', opts.minFields.join(','))
        if (opts.maxFields?.length) params.set('sysparm_max_fields', opts.maxFields.join(','))
        if (opts.sumFields?.length) params.set('sysparm_sum_fields', opts.sumFields.join(','))
        // Labels for grouped reference/choice fields require display values.
        params.set('sysparm_display_value', opts.displayValue ?? 'all')

        const { result } = await this.request(`/api/now/stats/${table}?${params}`)
        // Stats API nests buckets under result.stats? No: grouped results come
        // back as result[] of buckets; ungrouped come back as a single object.
        return Array.isArray(result) ? result : [result]
    }

    /**
     * Read system properties (sys_properties) by name. Returns a
     * { [name]: value } map; names with no readable property are omitted.
     * Used for admin-configurable integration URLs (Jira/Confluence base).
     */
    async getProperties(names: string[]): Promise<Record<string, string>> {
        if (!names.length) return {}
        const params = new URLSearchParams({
            sysparm_query: `nameIN${names.join(',')}`,
            sysparm_fields: 'name,value',
        })
        const { result } = await this.request(`/api/now/table/sys_properties?${params}`)
        const map: Record<string, string> = {}
        for (const r of result || []) map[r.name] = r.value
        return map
    }

    /**
     * Build the CMDB class hierarchy (rooted at cmdb_ci) with a rolled-up CI
     * count on every node.
     *
     * The class SHAPE (name/label/parent) is stored statically in
     * ./data/classTree.ts because the schema changes rarely and the live
     * sys_db_object query needs a `super_class.name` dot-walk that resolves a
     * reference per row across ~1200 rows (~27s — enough to 504 behind a proxy).
     * Only the COUNTS are fetched live (one fast Stats group_by, ~1s) and rolled
     * up client-side: a node's `count` includes all of its descendants (because
     * querying a parent table returns subclass rows).
     *
     * Returns the root nodes (normally just cmdb_ci).
     *
     * @param query optional encoded query applied to the count (e.g.
     *              'operational_status=1' to count only active CIs).
     */
    async getClassHierarchy(query?: string): Promise<ClassNode[]> {
        const buckets = await this.getCounts(this.baseTable, { groupBy: ['sys_class_name'], query })

        // Exact leaf counts keyed by class name.
        const ownCount: Record<string, number> = {}
        for (const b of buckets) {
            const cls = b.groupby_fields[0]?.value
            if (cls) ownCount[cls] = Number(b.stats.count ?? 0)
        }

        // Index nodes from the stored schema and remember each one's parent table.
        const nodes: Record<string, ClassNode> = {}
        const parentOf: Record<string, string> = {}
        for (const c of CLASS_SCHEMA) {
            nodes[c.n] = { name: c.n, label: c.l || c.n, count: 0, own: ownCount[c.n] ?? 0, children: [] }
            parentOf[c.n] = c.p || ''
        }

        // Link children to parents; collect roots (parent not in our set).
        const roots: ClassNode[] = []
        for (const name of Object.keys(nodes)) {
            const parent = parentOf[name]
            if (parent && nodes[parent]) nodes[parent].children.push(nodes[name])
            else roots.push(nodes[name])
        }

        // Roll counts up from the leaves and sort children by count desc.
        const rollup = (node: ClassNode): number => {
            let total = node.own
            for (const child of node.children) total += rollup(child)
            node.count = total
            node.children.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            return total
        }
        roots.forEach(rollup)
        roots.sort((a, b) => b.count - a.count)
        return roots
    }

    /**
     * Convenience: CI count per class for the filter chips, biggest first.
     * Returns [{ className, label, count }].
     */
    async ciCountsByClass(query?: string) {
        const buckets = await this.getCounts(this.baseTable, {
            groupBy: ['sys_class_name'],
            orderBy: 'COUNT^DESC',
            query,
        })
        return buckets.map((b) => ({
            className: b.groupby_fields[0]?.value,
            label: b.groupby_fields[0]?.display_value,
            count: Number(b.stats.count ?? 0),
        }))
    }
}
