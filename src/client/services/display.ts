// With sysparm_display_value=all, ServiceNow returns each field as
// { value, display_value, link }. These helpers read either shape safely so
// components don't repeat the `typeof field === 'object'` dance everywhere.

/** Human-readable text for a field (display_value, falling back to the raw value). */
export function dv(field: any): string {
    if (field == null) return ''
    if (typeof field === 'object') return field.display_value ?? field.value ?? ''
    return String(field)
}

/** Raw value (sys_id-side) for a field. */
export function raw(field: any): string {
    if (field == null) return ''
    if (typeof field === 'object') return field.value ?? ''
    return String(field)
}

/** Atlassian deployment type — changes which search-URL format we build. */
export type Deployment = 'cloud' | 'dc'

/** Normalize a system-property deployment value. Anything that isn't exactly
 *  "cloud" (case/space-insensitive) is treated as Data Center / Server. */
export function parseDeployment(value?: string): Deployment {
    return String(value ?? '').trim().toLowerCase() === 'cloud' ? 'cloud' : 'dc'
}

/** Build a Jira issue-search URL for a CI name using JQL. Searches all text
 *  fields, most-recently-updated first.
 *   - cloud: modern issue navigator   /issues/?jql=
 *   - dc:    classic issue navigator   /secure/IssueNavigator.jspa?jqlQuery= */
export function jiraSearchUrl(base: string, ciName: string, deployment: Deployment = 'dc'): string {
    const jql = `text ~ "${ciName.replace(/"/g, '\\"')}" ORDER BY updated DESC`
    const root = base.replace(/\/$/, '')
    return deployment === 'cloud'
        ? `${root}/issues/?jql=${encodeURIComponent(jql)}`
        : `${root}/secure/IssueNavigator.jspa?reset=true&jqlQuery=${encodeURIComponent(jql)}`
}

/** Build a Confluence advanced-search URL for a CI name using CQL. Matches the
 *  name in a page title or anywhere in its text.
 *   - cloud: advanced-search page      /search?cql=
 *   - dc:    legacy advanced search     /dosearchsite.action?cql=
 *  (For cloud, `base` is expected to include the /wiki context path.) */
export function confluenceSearchUrl(base: string, ciName: string, deployment: Deployment = 'dc'): string {
    const term = ciName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const cql = `title ~ "${term}" OR text ~ "${term}"`
    const root = base.replace(/\/$/, '')
    return deployment === 'cloud'
        ? `${root}/search?cql=${encodeURIComponent(cql)}`
        : `${root}/dosearchsite.action?cql=${encodeURIComponent(cql)}`
}

/** Parse a CMDB relation target.link into { className, sysId }.
 *  Links look like .../api/now/cmdb/instance/cmdb_ci/<sys_id> */
export function parseInstanceLink(link: string): { className: string; sysId: string } | null {
    const m = /\/cmdb\/instance\/([^/]+)\/([0-9a-f]{32})/i.exec(link || '')
    return m ? { className: m[1], sysId: m[2] } : null
}
