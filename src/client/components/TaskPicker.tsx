import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CmdbService } from '../services/CmdbService'
import { dv, raw } from '../services/display'
import './TaskPicker.css'

/** Live state of an "add to task" operation, driven by AMB + the batch result. */
export interface AddProgress {
    phase: 'connecting' | 'inserting' | 'done' | 'error'
    received: number // record-watcher insert events seen so far
    total: number
    ok?: number // confirmed inserts (batch response)
    failed?: number
}

interface CiRef {
    sysId: string
    className: string
    name: string
}

interface TaskPickerProps {
    service: CmdbService
    selectedCis: CiRef[] // the CIs to add
    busy?: boolean // an add is in flight
    progress?: AddProgress | null
    onConfirm: (task: { sysId: string; number: string }) => void
    onClose: () => void
}

type Tab = 'select' | 'existing'

// Two-step dialog: (1) search & pick a task, then (2) review the CIs to add vs.
// the task's existing Affected CIs across two tabs, and confirm.
export default function TaskPicker({ service, selectedCis, busy, progress, onConfirm, onClose }: TaskPickerProps) {
    const [term, setTerm] = useState('')
    const [tasks, setTasks] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [picked, setPicked] = useState<{ sysId: string; number: string } | null>(null)
    const [tab, setTab] = useState<Tab>('select')

    // Existing affected CIs for the picked task.
    const [existing, setExisting] = useState<CiRef[]>([])
    const [existingLoading, setExistingLoading] = useState(false)

    // ---- step 1: task search (debounced) ----
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
        if (picked) return // not searching once a task is chosen
        if (timer.current) clearTimeout(timer.current)
        if (term.trim().length < 2) {
            setTasks([])
            return
        }
        setLoading(true)
        timer.current = setTimeout(() => {
            service
                .searchTasks(term, { limit: 25 })
                .then(setTasks)
                .catch((e) => setError(e.message || 'Task search failed'))
                .finally(() => setLoading(false))
        }, 300)
        return () => {
            if (timer.current) clearTimeout(timer.current)
        }
    }, [term, service, picked])

    // ---- step 2: load existing affected CIs when a task is picked ----
    useEffect(() => {
        if (!picked) return
        setExistingLoading(true)
        service
            .getTaskCis(picked.sysId)
            .then(setExisting)
            .catch(() => setExisting([]))
            .finally(() => setExistingLoading(false))
    }, [picked, service])

    // Close on Escape (never mid-insert).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose, busy])

    const existingIds = useMemo(() => new Set(existing.map((c) => c.sysId)), [existing])
    const done = progress?.phase === 'done'
    const active = !!progress && progress.phase !== 'done' && progress.phase !== 'error'

    return (
        <div className="taskpicker-overlay" onClick={() => !busy && onClose()}>
            <div className="taskpicker" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <div className="taskpicker-head">
                    <span className="taskpicker-title">
                        {picked ? `Add to ${picked.number}` : `Add ${selectedCis.length} CI${selectedCis.length === 1 ? '' : 's'} to a task`}
                    </span>
                    <button className="taskpicker-close" onClick={onClose} disabled={busy} title="Close">
                        ✕
                    </button>
                </div>

                {!picked ? (
                    // ---------- step 1: pick a task ----------
                    <>
                        <input
                            className="taskpicker-search"
                            autoFocus
                            placeholder="Search tasks by number or description…"
                            value={term}
                            onChange={(e) => setTerm(e.target.value)}
                        />
                        {error && <div className="taskpicker-error">{error}</div>}
                        <div className="taskpicker-list">
                            {loading ? (
                                <div className="taskpicker-msg">Searching…</div>
                            ) : term.trim().length < 2 ? (
                                <div className="taskpicker-msg">Type at least 2 characters.</div>
                            ) : tasks.length === 0 ? (
                                <div className="taskpicker-msg">No matching tasks.</div>
                            ) : (
                                tasks.map((t) => {
                                    const sysId = raw(t.sys_id)
                                    const number = dv(t.number)
                                    return (
                                        <button
                                            key={sysId}
                                            className="taskpicker-item"
                                            onClick={() => setPicked({ sysId, number })}
                                        >
                                            <span className="taskpicker-num">{number}</span>
                                            <span className="taskpicker-class">{dv(t.sys_class_name)}</span>
                                            <span className="taskpicker-desc">{dv(t.short_description)}</span>
                                        </button>
                                    )
                                })
                            )}
                        </div>
                        <div className="taskpicker-foot">
                            <button className="taskpicker-cancel" onClick={onClose}>
                                Cancel
                            </button>
                        </div>
                    </>
                ) : (
                    // ---------- step 2: review tabs + confirm ----------
                    <>
                        <div className="taskpicker-tabs">
                            <button
                                className={'taskpicker-tab' + (tab === 'select' ? ' taskpicker-tab-active' : '')}
                                onClick={() => setTab('select')}
                            >
                                Select CIs ({selectedCis.length})
                            </button>
                            <button
                                className={'taskpicker-tab' + (tab === 'existing' ? ' taskpicker-tab-active' : '')}
                                onClick={() => setTab('existing')}
                            >
                                Affected CIs{existingLoading ? '' : ` (${existing.length})`}
                            </button>
                        </div>

                        <div className="taskpicker-list">
                            {tab === 'select' ? (
                                selectedCis.length === 0 ? (
                                    <div className="taskpicker-msg">No CIs selected.</div>
                                ) : (
                                    selectedCis.map((c) => (
                                        <div key={c.sysId} className="taskpicker-ci">
                                            <span className="taskpicker-ci-name">{c.name}</span>
                                            <span className="taskpicker-ci-class">{c.className}</span>
                                            {existingIds.has(c.sysId) && (
                                                <span className="taskpicker-ci-dup" title="Already on this task">
                                                    already added
                                                </span>
                                            )}
                                        </div>
                                    ))
                                )
                            ) : existingLoading ? (
                                <div className="taskpicker-msg">Loading affected CIs…</div>
                            ) : existing.length === 0 ? (
                                <div className="taskpicker-msg">No CIs are linked to this task yet.</div>
                            ) : (
                                existing.map((c) => (
                                    <div key={c.sysId} className="taskpicker-ci">
                                        <span className="taskpicker-ci-name">{c.name}</span>
                                        <span className="taskpicker-ci-class">{c.className}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        {progress && (
                            <div className="taskpicker-progress">
                                <div className="taskpicker-progress-bar">
                                    <div
                                        className="taskpicker-progress-fill"
                                        style={{
                                            width: `${progress.total ? Math.min(100, (progress.received / progress.total) * 100) : 0}%`,
                                        }}
                                    />
                                </div>
                                <div className="taskpicker-progress-text">
                                    {progress.phase === 'connecting'
                                        ? 'Connecting…'
                                        : done
                                          ? `Done — added ${progress.ok ?? 0}${progress.failed ? `, ${progress.failed} failed` : ''}`
                                          : `Inserting ${progress.received} of ${progress.total}…`}
                                </div>
                            </div>
                        )}

                        <div className="taskpicker-foot">
                            <button
                                className="taskpicker-cancel"
                                onClick={() => (done ? onClose() : setPicked(null))}
                                disabled={busy}
                            >
                                {done ? 'Back' : '‹ Change task'}
                            </button>
                            <button
                                className="taskpicker-confirm"
                                disabled={busy || (!done && selectedCis.length === 0)}
                                onClick={() => (done ? onClose() : onConfirm(picked))}
                            >
                                {done
                                    ? 'Close'
                                    : active
                                      ? 'Adding…'
                                      : `Add ${selectedCis.length} to ${picked.number}`}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
