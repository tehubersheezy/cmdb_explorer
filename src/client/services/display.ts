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

/** Build a Jira issue-search URL for a CI name using JQL. Searches all text
 *  fields, most-recently-updated first. */
export function jiraSearchUrl(base: string, ciName: string): string {
    const jql = `text ~ "${ciName.replace(/"/g, '\\"')}" ORDER BY updated DESC`
    return `${base.replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`
}

/** Build a Confluence site-search URL for a CI name. */
export function confluenceSearchUrl(base: string, ciName: string): string {
    return `${base.replace(/\/$/, '')}/search?text=${encodeURIComponent(ciName)}`
}

/** Parse a CMDB relation target.link into { className, sysId }.
 *  Links look like .../api/now/cmdb/instance/cmdb_ci/<sys_id> */
export function parseInstanceLink(link: string): { className: string; sysId: string } | null {
    const m = /\/cmdb\/instance\/([^/]+)\/([0-9a-f]{32})/i.exec(link || '')
    return m ? { className: m[1], sysId: m[2] } : null
}
