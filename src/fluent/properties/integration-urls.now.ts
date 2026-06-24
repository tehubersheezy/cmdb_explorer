import '@servicenow/sdk/global'
import { Property } from '@servicenow/sdk/core'

// Base URLs for the Jira / Confluence "search for this CI" actions in the
// CMDB Explorer. Admins edit these in sys_properties without code changes.
// read roles are left open so the BYOUI React client can fetch them via the
// Table API; write is restricted to admin.

Property({
    $id: Now.ID['ibworks-jira-base-url'],
    name: 'ibworks.jira.base_url',
    type: 'string',
    value: 'https://your-domain.atlassian.net',
    description: 'Base URL of the Jira instance used by the CMDB Explorer "Search in Jira" action (no trailing slash).',
    roles: {
        read: [],
        write: ['admin'],
    },
})

Property({
    $id: Now.ID['ibworks-confluence-base-url'],
    name: 'ibworks.confluence.base_url',
    type: 'string',
    value: 'https://your-domain.atlassian.net/wiki',
    description: 'Base URL of the Confluence instance used by the CMDB Explorer "Search in Confluence" action (no trailing slash).',
    roles: {
        read: [],
        write: ['admin'],
    },
})
