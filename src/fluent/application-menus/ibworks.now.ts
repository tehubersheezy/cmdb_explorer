import '@servicenow/sdk/global'
import { Record } from '@servicenow/sdk/core'

// We no longer ship our own "IBWorks" application menu. The CMDB Explorer module
// hangs directly off the out-of-box "Self-Service" navigator section (the
// order=50 menu) and is restricted to the itil role.
//
// sys_app_module.roles is a `user_roles` field (stored as comma-separated role
// names on the instance); the Fluent type takes an array of role names.
const SELF_SERVICE_MENU = '08771d0cc0a8016401f604303b94b999'

Record({
    $id: Now.ID['ibworks-cmdb-explorer-module'],
    table: 'sys_app_module',
    data: {
        title: 'CMDB Explorer',
        application: SELF_SERVICE_MENU,
        link_type: 'DIRECT',
        query: 'cmdb_explorer.do',
        hint: 'Open the CMDB Explorer',
        roles: ['itil'],
        active: true,
        order: 100,
    },
})
