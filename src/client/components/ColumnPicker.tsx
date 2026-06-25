import React, { useEffect, useRef, useState } from 'react'
import './ColumnPicker.css'

interface ColumnPickerProps {
    available: Array<{ name: string; label: string }>
    selected: string[]
    onChange: (next: string[]) => void
    disabled?: boolean
}

export default function ColumnPicker({ available, selected, onChange, disabled }: ColumnPickerProps) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const rootRef = useRef<HTMLDivElement>(null)

    const isDisabled = disabled || available.length === 0

    // Close on outside click or Escape while the popover is open.
    useEffect(() => {
        if (!open) return

        function onMouseDown(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                setOpen(false)
            }
        }

        document.addEventListener('mousedown', onMouseDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    const q = query.trim().toLowerCase()
    const filtered = q === ''
        ? available
        : available.filter(
              (a) => a.label.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
          )

    function toggle(name: string) {
        if (selected.includes(name)) {
            onChange(selected.filter((n) => n !== name))
        } else {
            onChange([...selected, name])
        }
    }

    return (
        <div className="colpicker" ref={rootRef}>
            <button
                className="colpicker-btn"
                disabled={isDisabled}
                onClick={() => setOpen((o) => !o)}
            >
                Columns ({selected.length}) ▾
            </button>

            {open && (
                <div className="colpicker-panel">
                    <input
                        className="colpicker-search"
                        type="text"
                        placeholder="Filter columns…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />

                    <div className="colpicker-list">
                        {filtered.map((a) => (
                            <label key={a.name} className="colpicker-item">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(a.name)}
                                    onChange={() => toggle(a.name)}
                                />
                                {a.label}
                            </label>
                        ))}
                    </div>

                    <div className="colpicker-foot">
                        <button className="colpicker-link" onClick={() => onChange([])}>
                            Clear
                        </button>
                        <button className="colpicker-link" onClick={() => setOpen(false)}>
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
