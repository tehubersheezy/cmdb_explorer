import React, { useRef, useEffect } from 'react'
import { dv, raw } from '../services/display'
import './CiResults.css'

export interface ColumnDef {
    key: string
    label: string
}

/** Identity a bulk action needs for one row. */
export interface RowRef {
    sysId: string
    className: string
    name: string
}

interface CiResultsProps {
    title: string
    rows: any[]
    loading: boolean
    columns: ColumnDef[]
    selectedSysId: string | null
    onSelect: (className: string, sysId: string) => void
    headerActions?: React.ReactNode
    // Multi-select for bulk actions.
    selectedIds: Set<string>
    onToggleRow: (sysId: string, className: string, name: string) => void
    onToggleRows: (visible: RowRef[], check: boolean) => void
}

export default function CiResults({
    title,
    rows,
    loading,
    columns,
    selectedSysId,
    onSelect,
    headerActions,
    selectedIds,
    onToggleRow,
    onToggleRows,
}: CiResultsProps) {
    // Columns are chosen by the caller (default set in search mode, the user's
    // picked set when browsing a class) — render them as given.
    const cols = columns.length ? columns : [{ key: 'name', label: 'Name' }]

    // The selectable identity of every visible row, for the select-all control.
    const visible: RowRef[] = rows.map((r) => ({
        sysId: raw(r.sys_id),
        className: raw(r.sys_class_name) || 'cmdb_ci',
        name: dv(r.name) || raw(r.sys_id),
    }))
    const allChecked = visible.length > 0 && visible.every((v) => selectedIds.has(v.sysId))
    const someChecked = visible.some((v) => selectedIds.has(v.sysId))

    // Header checkbox shows the "partial" (indeterminate) state via a ref.
    const allRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (allRef.current) allRef.current.indeterminate = someChecked && !allChecked
    }, [someChecked, allChecked])

    return (
        <div className="ci-results">
            <div className="ci-results-head">
                <span className="ci-results-title">{title}</span>
                <span className="ci-results-count">
                    {loading ? '…' : `${rows.length} CI${rows.length === 1 ? '' : 's'}`}
                </span>
                {headerActions && <span className="ci-results-actions">{headerActions}</span>}
            </div>

            {loading ? (
                <div className="ci-results-msg">Loading…</div>
            ) : rows.length === 0 ? (
                <div className="ci-results-msg">No configuration items. Pick a class or search above.</div>
            ) : (
                <div className="ci-results-scroll">
                    <table className="ci-table">
                        <thead>
                            <tr>
                                <th className="ci-check-col">
                                    <input
                                        ref={allRef}
                                        type="checkbox"
                                        aria-label="Select all rows"
                                        checked={allChecked}
                                        onChange={(e) => onToggleRows(visible, e.target.checked)}
                                    />
                                </th>
                                {cols.map((c) => (
                                    <th key={c.key}>{c.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const sysId = raw(r.sys_id)
                                const className = raw(r.sys_class_name) || 'cmdb_ci'
                                const name = dv(r.name) || sysId
                                const checked = selectedIds.has(sysId)
                                return (
                                    <tr
                                        key={sysId}
                                        className={
                                            (sysId === selectedSysId ? 'ci-row-selected' : '') +
                                            (checked ? ' ci-row-checked' : '')
                                        }
                                        onClick={() => onSelect(className, sysId)}
                                    >
                                        {/* Stop propagation so ticking the box doesn't open the detail drawer. */}
                                        <td className="ci-check-col" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                aria-label={`Select ${name}`}
                                                checked={checked}
                                                onChange={() => onToggleRow(sysId, className, name)}
                                            />
                                        </td>
                                        {cols.map((c) => (
                                            <td key={c.key}>
                                                {c.key === 'name' ? (
                                                    <span className="ci-name">{dv(r[c.key])}</span>
                                                ) : (
                                                    dv(r[c.key])
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
