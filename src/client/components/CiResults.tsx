import React from 'react'
import { dv, raw } from '../services/display'
import './CiResults.css'

interface CiResultsProps {
    title: string
    rows: any[]
    loading: boolean
    selectedSysId: string | null
    onSelect: (className: string, sysId: string) => void
}

// Preferred columns, shown when present in the data.
const COLUMNS: Array<{ key: string; label: string }> = [
    { key: 'name', label: 'Name' },
    { key: 'sys_class_name', label: 'Class' },
    { key: 'ip_address', label: 'IP Address' },
    { key: 'operational_status', label: 'Status' },
    { key: 'sys_updated_on', label: 'Updated' },
]

export default function CiResults({ title, rows, loading, selectedSysId, onSelect }: CiResultsProps) {
    // Only render columns that at least one row actually has a value for.
    const cols = COLUMNS.filter((c) => rows.some((r) => dv(r[c.key]) !== ''))

    return (
        <div className="ci-results">
            <div className="ci-results-head">
                <span className="ci-results-title">{title}</span>
                <span className="ci-results-count">{loading ? '…' : `${rows.length} CI${rows.length === 1 ? '' : 's'}`}</span>
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
                                {cols.map((c) => (
                                    <th key={c.key}>{c.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const sysId = raw(r.sys_id)
                                const className = raw(r.sys_class_name) || 'cmdb_ci'
                                return (
                                    <tr
                                        key={sysId}
                                        className={sysId === selectedSysId ? 'ci-row-selected' : ''}
                                        onClick={() => onSelect(className, sysId)}
                                    >
                                        {cols.map((c) => (
                                            <td key={c.key}>
                                                {c.key === 'name' ? <span className="ci-name">{dv(r[c.key])}</span> : dv(r[c.key])}
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
