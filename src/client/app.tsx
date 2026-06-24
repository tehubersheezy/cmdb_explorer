import React, { useState, useEffect, useMemo, useRef } from 'react'
import { CmdbService, type ClassNode } from './services/CmdbService'
import ClassTree from './components/ClassTree'
import CiResults from './components/CiResults'
import CiDetail from './components/CiDetail'
import './app.css'

const RESULT_FIELDS = ['sys_id', 'name', 'sys_class_name', 'ip_address', 'operational_status', 'sys_updated_on']
const JIRA_PROP = 'ibworks.jira.base_url'
const CONFLUENCE_PROP = 'ibworks.confluence.base_url'
// Placeholder default value; treated as "not configured" so buttons disable.
const UNSET_URL = 'https://your-domain.atlassian.net'

export default function App() {
    const service = useMemo(() => new CmdbService(), [])

    const [roots, setRoots] = useState<ClassNode[]>([])
    const [treeLoading, setTreeLoading] = useState(true)

    const [selectedClass, setSelectedClass] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [rows, setRows] = useState<any[]>([])
    const [rowsLoading, setRowsLoading] = useState(false)
    const [title, setTitle] = useState('Configuration Items')

    const [selectedCi, setSelectedCi] = useState<{ className: string; sysId: string } | null>(null)
    const [links, setLinks] = useState<{ jira?: string; confluence?: string }>({})
    const [error, setError] = useState<string | null>(null)

    // Load the class hierarchy once.
    useEffect(() => {
        setTreeLoading(true)
        service
            .getClassHierarchy()
            .then(setRoots)
            .catch((e) => setError('Failed to load class hierarchy: ' + (e.message || e)))
            .finally(() => setTreeLoading(false))
    }, [service])

    // Load integration base URLs (Jira/Confluence) from system properties once.
    // A still-default placeholder value counts as "not configured".
    useEffect(() => {
        service
            .getProperties([JIRA_PROP, CONFLUENCE_PROP])
            .then((p) => {
                const clean = (v?: string) => (v && v !== UNSET_URL ? v : undefined)
                setLinks({ jira: clean(p[JIRA_PROP]), confluence: clean(p[CONFLUENCE_PROP]) })
            })
            .catch(() => setLinks({}))
    }, [service])

    // Browse a class (clears any active search).
    const browseClass = async (className: string) => {
        setQuery('')
        setSelectedClass(className)
        setTitle(className)
        setRowsLoading(true)
        setError(null)
        try {
            const data = await service.listByClass(className, { fields: RESULT_FIELDS, limit: 200 })
            setRows(data)
        } catch (e: any) {
            setError('Failed to list ' + className + ': ' + (e.message || e))
            setRows([])
        } finally {
            setRowsLoading(false)
        }
    }

    // Debounced global search (clears any active class selection).
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onSearchChange = (term: string) => {
        setQuery(term)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        if (term.trim().length < 2) return
        searchTimer.current = setTimeout(async () => {
            setSelectedClass(null)
            setTitle(`Search: "${term}"`)
            setRowsLoading(true)
            setError(null)
            try {
                const data = await service.searchCIs(term, { limit: 100 })
                setRows(data)
            } catch (e: any) {
                setError('Search failed: ' + (e.message || e))
                setRows([])
            } finally {
                setRowsLoading(false)
            }
        }, 300)
    }

    return (
        <div className="cmdb-app">
            <header className="cmdb-header">
                <h1>CMDB Explorer</h1>
                <input
                    className="cmdb-search"
                    placeholder="Search CIs by name, IP, FQDN, serial…"
                    value={query}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </header>

            {error && (
                <div className="cmdb-error">
                    {error}
                    <button onClick={() => setError(null)}>Dismiss</button>
                </div>
            )}

            <div className="cmdb-body">
                {treeLoading ? (
                    <aside className="cmdb-tree-loading">Loading classes…</aside>
                ) : (
                    <ClassTree roots={roots} selected={selectedClass} onSelect={browseClass} />
                )}

                <main className="cmdb-main">
                    <CiResults
                        title={title}
                        rows={rows}
                        loading={rowsLoading}
                        selectedSysId={selectedCi?.sysId ?? null}
                        onSelect={(className, sysId) => setSelectedCi({ className, sysId })}
                    />
                </main>

                {selectedCi && (
                    <CiDetail
                        service={service}
                        className={selectedCi.className}
                        sysId={selectedCi.sysId}
                        jiraBase={links.jira}
                        confluenceBase={links.confluence}
                        onNavigate={(className, sysId) => setSelectedCi({ className, sysId })}
                        onClose={() => setSelectedCi(null)}
                    />
                )}
            </div>
        </div>
    )
}
