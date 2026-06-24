import '@servicenow/sdk/global'
import { UiPage } from '@servicenow/sdk/core'
import cmdbExplorerPage from '../../client/index.html'

UiPage({
    $id: Now.ID['cmdb-explorer-page'],
    endpoint: 'cmdb_explorer.do',
    description: 'CMDB Explorer UI Page',
    category: 'general',
    html: cmdbExplorerPage,
    direct: true,
})
