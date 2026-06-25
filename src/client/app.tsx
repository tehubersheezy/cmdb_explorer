import React, { useState, useEffect, useMemo, useRef } from 'react'
import { CmdbService, type ClassNode, type ClassAttribute } from './services/CmdbService'
import ClassTree from './components/ClassTree'
import CiResults, { type ColumnDef } from './components/CiResults'
import ColumnPicker from './components/ColumnPicker'
import CiDetail from './components/CiDetail'
import TaskPicker, { type AddProgress } from './components/TaskPicker'
import { SnowAmb } from './services/SnowAmb'
import { parseDeployment, type Deployment } from './services/display'
import './app.css'

// Default columns when browsing a class (intersected with what the class has).
const DEFAULT_COLUMNS = ['name', 'sys_class_name', 'ip_address', 'operational_status', 'sys_updated_on']
// Columns shown for cross-class search (matches the fields searchCIs returns).
const SEARCH_COLUMNS = ['name', 'sys_class_name', 'ip_address', 'sys_updated_on']
// Labels for system columns the Meta API doesn't always describe nicely.
const STATIC_LABELS: Record<string, string> = {
    name: 'Name',
    sys_class_name: 'Class',
    ip_address: 'IP Address',
    operational_status: 'Status',
    sys_updated_on: 'Updated',
    sys_id: 'Sys ID',
}
const JIRA_PROP = 'ibworks.jira.base_url'
const CONFLUENCE_PROP = 'ibworks.confluence.base_url'
const JIRA_TYPE_PROP = 'ibworks.jira.type'
const CONFLUENCE_TYPE_PROP = 'ibworks.confluence.type'
// Shipped placeholder host; any base URL still pointing here is "not configured"
// (so the Jira/Confluence buttons stay disabled until an admin sets a real URL).
const PLACEHOLDER_HOST = 'your-domain.atlassian.net'

// Per-class column choices persist in localStorage so a user's view sticks.
const colStorageKey = (className: string) => `cmdb.cols.${className}`
const readSavedCols = (className: string): string[] | null => {
    try {
        const raw = localStorage.getItem(colStorageKey(className))
        const parsed = raw ? JSON.parse(raw) : null
        return Array.isArray(parsed) && parsed.length ? parsed : null
    } catch {
        return null
    }
}
const writeSavedCols = (className: string, cols: string[]) => {
    try {
        localStorage.setItem(colStorageKey(className), JSON.stringify(cols))
    } catch {
        /* storage unavailable — selection just won't persist */
    }
}

// Poll `pred` until it's true or `timeoutMs` elapses. Used to let AMB deliver
// the last record-watcher events after the batch insert resolves.
const waitFor = (pred: () => boolean, timeoutMs: number): Promise<void> =>
    new Promise((resolve) => {
        const start = Date.now()
        const tick = () => {
            if (pred() || Date.now() - start >= timeoutMs) resolve()
            else setTimeout(tick, 150)
        }
        tick()
    })

export default function App() {
    const service = useMemo(() => new CmdbService(), [])

    const [roots, setRoots] = useState<ClassNode[]>([])
    const [treeLoading, setTreeLoading] = useState(true)

    const [selectedClass, setSelectedClass] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [rows, setRows] = useState<any[]>([])
    const [rowsLoading, setRowsLoading] = useState(false)
    const [title, setTitle] = useState('Configuration Items')

    // Column picker: attrs = everything the selected class offers; columns =
    // the user's current visible selection (keys, in display order).
    const [attrs, setAttrs] = useState<ClassAttribute[]>([])
    const [columns, setColumns] = useState<string[]>([])

    const [selectedCi, setSelectedCi] = useState<{ className: string; sysId: string } | null>(null)

    // Multi-select for bulk actions (e.g. "Add to task"). Keyed by CI sys_id so
    // a selection survives re-renders AND class/search navigation; the value
    // carries what an action needs.
    const [selected, setSelected] = useState<Map<string, { className: string; name: string }>>(new Map())
    const [pickingTask, setPickingTask] = useState(false)
    const [addingToTask, setAddingToTask] = useState(false)
    const [progress, setProgress] = useState<AddProgress | null>(null)

    const [activeOnly, setActiveOnly] = useState(false)
    const [links, setLinks] = useState<{
        jira?: string
        confluence?: string
        jiraType: Deployment
        confluenceType: Deployment
    }>({ jiraType: 'dc', confluenceType: 'dc' })
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    // Load (and reload) the class hierarchy — counts respect the active filter.
    useEffect(() => {
        setTreeLoading(true)
        service
            .getClassHierarchy(activeOnly ? 'operational_status=1' : undefined)
            .then(setRoots)
            .catch((e) => setError('Failed to load class hierarchy: ' + (e.message || e)))
            .finally(() => setTreeLoading(false))
    }, [service, activeOnly])

    // Load integration base URLs + deployment types from system properties once.
    // A URL still pointing at the placeholder host counts as "not configured".
    useEffect(() => {
        service
            .getProperties([JIRA_PROP, CONFLUENCE_PROP, JIRA_TYPE_PROP, CONFLUENCE_TYPE_PROP])
            .then((p) => {
                const clean = (v?: string) => (v && !v.includes(PLACEHOLDER_HOST) ? v : undefined)
                setLinks({
                    jira: clean(p[JIRA_PROP]),
                    confluence: clean(p[CONFLUENCE_PROP]),
                    jiraType: parseDeployment(p[JIRA_TYPE_PROP]),
                    confluenceType: parseDeployment(p[CONFLUENCE_TYPE_PROP]),
                })
            })
            .catch(() => setLinks({ jiraType: 'dc', confluenceType: 'dc' }))
    }, [service])

    // Browse a class (clears any active search). Honors the active filter.
    // `colsOverride` lets the column picker refetch with a new selection without
    // re-deriving defaults; otherwise we resolve saved → default∩available.
    const browseClass = async (className: string, colsOverride?: string[]) => {
        setQuery('')
        setSelectedClass(className)
        setTitle(className)
        setRowsLoading(true)
        setError(null)
        try {
            // Attributes drive the picker + column labels (cached in the service).
            const attrList = await service.getClassAttributes(className).catch(() => [])
            setAttrs(attrList)

            // Resolve which columns to show: explicit override, else the user's
            // saved choice for this class, else the table's native default list
            // view, else a static fallback.
            let cols = colsOverride ?? readSavedCols(className) ?? undefined
            if (!cols) {
                const avail = new Set(attrList.map((a) => a.name))
                // The platform's own default list columns for this table.
                const listCols = await service.getDefaultListColumns(className).catch(() => [])
                // Keep only columns the class actually exposes so each default is
                // valid to fetch and appears in the picker.
                const usable = avail.size ? listCols.filter((c) => avail.has(c)) : listCols
                cols = usable.length
                    ? usable
                    : avail.size
                      ? DEFAULT_COLUMNS.filter((c) => avail.has(c))
                      : [...DEFAULT_COLUMNS]
                if (!cols.length) cols = ['name']
            }
            setColumns(cols)

            // Always fetch the identity fields so row click-through works, plus
            // whatever columns are visible.
            const fields = Array.from(new Set(['sys_id', 'sys_class_name', ...cols]))
            const data = await service.listByClass(className, {
                fields,
                limit: 200,
                query: activeOnly ? 'operational_status=1' : undefined,
            })
            setRows(data)
        } catch (e: any) {
            setError('Failed to list ' + className + ': ' + (e.message || e))
            setRows([])
        } finally {
            setRowsLoading(false)
        }
    }

    // Picker changed the visible columns: persist for this class and refetch so
    // newly-shown columns actually arrive in the payload.
    const onColumnsChange = (next: string[]) => {
        setColumns(next)
        if (selectedClass) {
            writeSavedCols(selectedClass, next)
            void browseClass(selectedClass, next)
        }
    }

    // ---- selection (cached across class/search navigation) ----------------
    const selectedIds = useMemo(() => new Set(selected.keys()), [selected])

    const toggleRow = (sysId: string, className: string, name: string) => {
        setSelected((prev) => {
            const next = new Map(prev)
            if (next.has(sysId)) next.delete(sysId)
            else next.set(sysId, { className, name })
            return next
        })
    }

    const toggleRows = (visible: Array<{ sysId: string; className: string; name: string }>, check: boolean) => {
        setSelected((prev) => {
            const next = new Map(prev)
            for (const r of visible) {
                if (check) next.set(r.sysId, { className: r.className, name: r.name })
                else next.delete(r.sysId)
            }
            return next
        })
    }

    const clearSelection = () => setSelected(new Map())

    // "Add to task" action: open the task-picker dialog (the selection is the
    // stored payload). The dialog calls onConfirmTask with the chosen task.
    const onAddToTask = () => {
        if (selected.size) setPickingTask(true)
    }

    // A task was chosen in the dialog. Flow:
    //   1. open AMB + subscribe to task_ci record-watcher (so no insert event is
    //      missed) BEFORE writing anything,
    //   2. fire the Batch REST insert (one HTTP call for all CIs),
    //   3. count live insert events into a progress bar,
    //   4. reconcile with the batch's authoritative ok/failed counts, finalize.
    const onConfirmTask = async (task: { sysId: string; number: string }) => {
        const ids = Array.from(selected.keys())
        if (!ids.length) return
        setAddingToTask(true)
        setError(null)
        setProgress({ phase: 'connecting', received: 0, total: ids.length })

        const amb = new SnowAmb()
        let received = 0
        try {
            // Subscribe first so the batch's inserts can't beat us to the channel.
            await amb.connect()
            const channel = SnowAmb.recordChannel('task_ci', `task=${task.sysId}`)
            await amb.subscribe(channel, () => {
                received += 1
                setProgress((p) => (p ? { ...p, received } : p))
            })

            setProgress({ phase: 'inserting', received: 0, total: ids.length })
            const { ok, failed } = await service.addCisToTaskBatch(task.sysId, ids)

            // Let AMB deliver any straggler events, then finalize on the batch's
            // authoritative counts (AMB is the live feed, the batch is truth).
            await waitFor(() => received >= ok, 4000)
            setProgress({ phase: 'done', received: Math.max(received, ok), total: ids.length, ok, failed })
            setNotice(
                `Added ${ok} CI${ok === 1 ? '' : 's'} to ${task.number}` +
                    (failed ? `, ${failed} failed` : '') +
                    '.',
            )
            setSelected(new Map())
        } catch (e: any) {
            setError('Add to task failed: ' + (e.message || e))
            setProgress((p) => (p ? { ...p, phase: 'error' } : null))
        } finally {
            setAddingToTask(false)
            void amb.disconnect().catch(() => {})
        }
    }

    const closeTaskPicker = () => {
        if (addingToTask) return // don't close mid-insert
        setPickingTask(false)
        setProgress(null)
    }

    // Run a global search (clears any active class selection). Honors the active filter.
    const runSearch = async (term: string) => {
        setSelectedClass(null)
        setTitle(`Search: "${term}"`)
        setRowsLoading(true)
        setError(null)
        try {
            const data = await service.searchCIs(term, { limit: 100, activeOnly })
            setRows(data)
        } catch (e: any) {
            setError('Search failed: ' + (e.message || e))
            setRows([])
        } finally {
            setRowsLoading(false)
        }
    }

    // Debounced search input.
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onSearchChange = (term: string) => {
        setQuery(term)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        if (term.trim().length < 2) return
        searchTimer.current = setTimeout(() => void runSearch(term), 300)
    }

    // When the active filter toggles, re-run whichever view is showing so the
    // list matches the (now refiltered) tree counts.
    const mounted = useRef(false)
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true
            return
        }
        if (selectedClass) void browseClass(selectedClass, columns.length ? columns : undefined)
        else if (query.trim().length >= 2) void runSearch(query)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeOnly])

    // Resolve column keys → { key, label } for the grid. Class meta labels win,
    // with static fallbacks for system columns. Search mode uses a fixed set.
    const columnDefs = useMemo<ColumnDef[]>(() => {
        const labels: Record<string, string> = { ...STATIC_LABELS }
        for (const a of attrs) labels[a.name] = a.label
        const keys = selectedClass ? columns : SEARCH_COLUMNS
        return keys.map((k) => ({ key: k, label: labels[k] || k }))
    }, [selectedClass, columns, attrs])

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

            {notice && (
                <div className="cmdb-notice">
                    {notice}
                    <button onClick={() => setNotice(null)}>Dismiss</button>
                </div>
            )}

            {selected.size > 0 && (
                <div className="cmdb-selbar">
                    <span className="cmdb-selbar-count">
                        {selected.size} CI{selected.size === 1 ? '' : 's'} selected
                    </span>
                    <div className="cmdb-selbar-actions">
                        <button className="cmdb-selbar-action" onClick={onAddToTask}>
                            Add to task…
                        </button>
                        <button className="cmdb-selbar-clear" onClick={clearSelection}>
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="cmdb-body">
                {treeLoading ? (
                    <aside className="cmdb-tree-loading">Loading classes…</aside>
                ) : (
                    <ClassTree
                        roots={roots}
                        selected={selectedClass}
                        onSelect={browseClass}
                        activeOnly={activeOnly}
                        onToggleActive={setActiveOnly}
                    />
                )}

                <main className="cmdb-main">
                    <CiResults
                        title={title}
                        rows={rows}
                        loading={rowsLoading}
                        columns={columnDefs}
                        selectedSysId={selectedCi?.sysId ?? null}
                        onSelect={(className, sysId) => setSelectedCi({ className, sysId })}
                        selectedIds={selectedIds}
                        onToggleRow={toggleRow}
                        onToggleRows={toggleRows}
                        headerActions={
                            <ColumnPicker
                                available={attrs.map((a) => ({ name: a.name, label: a.label }))}
                                selected={columns}
                                onChange={onColumnsChange}
                                disabled={!selectedClass}
                            />
                        }
                    />
                </main>

                {selectedCi && (
                    <CiDetail
                        service={service}
                        className={selectedCi.className}
                        sysId={selectedCi.sysId}
                        jiraBase={links.jira}
                        confluenceBase={links.confluence}
                        jiraDeployment={links.jiraType}
                        confluenceDeployment={links.confluenceType}
                        onNavigate={(className, sysId) => setSelectedCi({ className, sysId })}
                        onClose={() => setSelectedCi(null)}
                    />
                )}
            </div>

            {pickingTask && (
                <TaskPicker
                    service={service}
                    selectedCis={Array.from(selected, ([sysId, v]) => ({
                        sysId,
                        className: v.className,
                        name: v.name,
                    }))}
                    busy={addingToTask}
                    progress={progress}
                    onConfirm={onConfirmTask}
                    onClose={closeTaskPicker}
                />
            )}
        </div>
    )
}
