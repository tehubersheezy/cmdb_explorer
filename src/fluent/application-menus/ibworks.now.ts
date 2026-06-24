import '@servicenow/sdk/global'
import { ApplicationMenu, Record } from '@servicenow/sdk/core'

// Top-level "IBWorks" section in the application navigator. order=75 places it
// second: just after "Self-Service" (order 50) and ahead of the order=100 cluster.
const ibworksMenu = ApplicationMenu({
    $id: Now.ID['ibworks-menu'],
    title: 'IBWorks',
    name: 'IBWorks',
    hint: 'IBWorks application suite',
    description: 'IBWorks application suite',
    order: 75,
    active: true,
})

// Module linking to the CMDB Explorer UI page (cmdb_explorer.do).
Record({
    $id: Now.ID['ibworks-cmdb-explorer-module'],
    table: 'sys_app_module',
    data: {
        title: 'CMDB Explorer',
        application: ibworksMenu,
        link_type: 'DIRECT',
        query: 'cmdb_explorer.do',
        hint: 'Open the CMDB Explorer',
        active: true,
        order: 100,
    },
})
