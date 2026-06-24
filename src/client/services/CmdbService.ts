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
 *  NOTE: unlike the Table/Stats calls, the CMDB Instance API does NOT honor
 *  sysparm_display_value — `attributes` values are raw strings, not
 *  { value, display_value } objects. (Verified against dev380385.) */
export interface CiInstance {
    attributes: Record<string, string>
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

    // ---- internal -------------------------------------------------------

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
    async searchCIs(term: string, opts: { fields?: string[]; limit?: number } = {}) {
        const fields = opts.fields ?? ['name', 'ip_address', 'fqdn', 'serial_number', 'asset_tag']
        // Build an OR'd encoded query: nameLIKEterm^ORip_addressLIKEterm^OR...
        const encoded = fields.map((f, i) => `${i === 0 ? '' : 'OR'}${f}LIKE${term}`).join('^')

        const params = new URLSearchParams({
            sysparm_display_value: 'all',
            sysparm_fields: 'sys_id,name,sys_class_name,ip_address,sys_updated_on',
            sysparm_limit: String(opts.limit ?? 25),
            sysparm_query: `${encoded}^ORDERBYname`,
        })

        const { result } = await this.request(`/api/now/table/${this.baseTable}?${params}`)
        return result || []
    }

    /** Open incidents grouped by CI — a join the CMDB API can't do. Returns a
     *  { [ciSysId]: openCount } map for overlaying health onto search results. */
    async openIncidentCountsByCi(): Promise<Record<string, number>> {
        const buckets = await this.getCounts('incident', {
            groupBy: ['cmdb_ci'],
            query: 'active=true^cmdb_ciISNOTEMPTY',
        })
        const map: Record<string, number> = {}
        for (const b of buckets) {
            const ci = b.groupby_fields[0]?.value
            if (ci) map[ci] = Number(b.stats.count ?? 0)
        }
        return map
    }

    // ---- CMDB Instance API ---------------------------------------------

    /**
     * Class-scoped CI list. Unlike the Table API on cmdb_ci, this returns the
     * correct leaf-table fields for the class and is the intended path for
     * browsing within one class.
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
        if (opts.query) params.set('sysparm_query', opts.query)
        if (opts.fields) params.set('sysparm_fields', opts.fields.join(','))
        if (opts.limit != null) params.set('sysparm_limit', String(opts.limit))
        if (opts.offset != null) params.set('sysparm_offset', String(opts.offset))

        const { result } = await this.request(`/api/now/cmdb/instance/${className}?${params}`)
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
     */
    async getClassHierarchy(): Promise<ClassNode[]> {
        const buckets = await this.getCounts(this.baseTable, { groupBy: ['sys_class_name'] })

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
