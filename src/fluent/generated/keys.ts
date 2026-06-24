import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    bom_json: {
                        table: 'sys_module'
                        id: '297d697f91054109be82df145f73c276'
                    }
                    'ibworks-cmdb-explorer-module': {
                        table: 'sys_app_module'
                        id: '235639cb946747de8e8713cb43dc0b2d'
                    }
                    'ibworks-confluence-base-url': {
                        table: 'sys_properties'
                        id: 'd31db1c124fe43b69b2abc7dbd34db00'
                    }
                    'ibworks-jira-base-url': {
                        table: 'sys_properties'
                        id: 'f2e5eee5ebe84da29f593cc438ecbaae'
                    }
                    'ibworks-menu': {
                        table: 'sys_app_application'
                        id: 'fe9de2e7303c4da08279acf675cfbc8a'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: 'bc1b7d522ffa466187dff79ca2030b79'
                    }
                }
                composite: [
                    {
                        table: 'sys_ux_lib_asset'
                        id: '040a8dd260e44e61bdbdb003b4bb179a'
                        key: {
                            name: 'global/vendor-react-dom--966e429a'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: '3ac4821577eb4e79a73a937544673969'
                        key: {
                            name: 'global/main'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: '5eb230541bc14d49b4ca07db46162eea'
                        key: {
                            name: 'global/main.js.map'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '959004dcb221437bae1caf8209f1fe68'
                        key: {
                            application_file: '5eb230541bc14d49b4ca07db46162eea'
                            source_artifact: 'acbbbce612e946569a5c1d042b4819f1'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '972f0435ae6c4042bc43b586c1573369'
                        key: {
                            application_file: '3ac4821577eb4e79a73a937544673969'
                            source_artifact: 'acbbbce612e946569a5c1d042b4819f1'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact'
                        id: 'acbbbce612e946569a5c1d042b4819f1'
                        key: {
                            name: 'cmdb_explorer.do - BYOUI Files'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: 'd04512ab53214e878f8dd5559e20d53e'
                        key: {
                            name: 'global/vendor-react-dom--966e429a.js.map'
                        }
                    },
                    {
                        table: 'sys_ui_page'
                        id: 'd3a92ee772aa491cb56ab1c7b4816b34'
                        key: {
                            name: 'cmdb_explorer'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'd3d73f77014f418d9a85fa2c7ffecd94'
                        key: {
                            application_file: '040a8dd260e44e61bdbdb003b4bb179a'
                            source_artifact: 'acbbbce612e946569a5c1d042b4819f1'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'd3f820e9bb164fe58d703bcb7178c642'
                        key: {
                            application_file: 'd04512ab53214e878f8dd5559e20d53e'
                            source_artifact: 'acbbbce612e946569a5c1d042b4819f1'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'f2380f5db38d437bb993941327e087da'
                        key: {
                            application_file: 'd3a92ee772aa491cb56ab1c7b4816b34'
                            source_artifact: 'acbbbce612e946569a5c1d042b4819f1'
                        }
                    },
                ]
            }
        }
    }
}
