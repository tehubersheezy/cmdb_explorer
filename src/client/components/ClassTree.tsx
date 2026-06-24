import React, { useMemo, useState } from 'react'
import type { ClassNode } from '../services/CmdbService'
import './ClassTree.css'

interface ClassTreeProps {
    roots: ClassNode[]
    selected: string | null
    onSelect: (className: string) => void
    activeOnly: boolean
    onToggleActive: (value: boolean) => void
}

/**
 * Left-sidebar CMDB class hierarchy with rolled-up counts. Nodes are
 * collapsible; the "Hide empty" toggle prunes any branch whose inclusive count
 * is 0 (entire empty subtrees disappear, not just leaves).
 */
export default function ClassTree({ roots, selected, onSelect, activeOnly, onToggleActive }: ClassTreeProps) {
    const [hideEmpty, setHideEmpty] = useState(true)
    const [filter, setFilter] = useState('')

    // Expand the roots by default so the tree isn't a single collapsed node.
    const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(roots.map((r) => [r.name, true])),
    )

    const toggle = (name: string) => setExpanded((e) => ({ ...e, [name]: !e[name] }))

    const total = useMemo(() => roots.reduce((a, r) => a + r.count, 0), [roots])
    const term = filter.trim().toLowerCase()

    /** A node is visible if it (or any descendant) passes the hide-empty and
     *  text filters. Returns null when the whole subtree is pruned. */
    const prune = (node: ClassNode): ClassNode | null => {
        const kids = node.children.map(prune).filter(Boolean) as ClassNode[]
        const matchesText = !term || node.label.toLowerCase().includes(term) || node.name.includes(term)
        const passesEmpty = !hideEmpty || node.count > 0
        // Keep the node if it passes on its own, or if any child survived.
        if ((matchesText && passesEmpty) || kids.length > 0) {
            return { ...node, children: kids }
        }
        return null
    }

    const visibleRoots = useMemo(
        () => roots.map(prune).filter(Boolean) as ClassNode[],
        [roots, hideEmpty, term],
    )

    return (
        <aside className="class-tree">
            <div className="class-tree-head">
                <div className="class-tree-title">
                    Classes <span className="ct-total">{total.toLocaleString()} CIs</span>
                </div>
                <input
                    className="ct-filter"
                    placeholder="Filter classes…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <label className="ct-toggle">
                    <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
                    Hide empty CI tables
                </label>
                <label className="ct-toggle">
                    <input
                        type="checkbox"
                        checked={activeOnly}
                        onChange={(e) => onToggleActive(e.target.checked)}
                    />
                    Active only (operational)
                </label>
            </div>
            <div className="class-tree-body">
                {visibleRoots.length === 0 ? (
                    <div className="ct-empty">No matching classes</div>
                ) : (
                    visibleRoots.map((node) => (
                        <TreeRow
                            key={node.name}
                            node={node}
                            depth={0}
                            expanded={expanded}
                            toggle={toggle}
                            selected={selected}
                            onSelect={onSelect}
                            // When text-filtering, force-expand so matches deep in the tree show.
                            forceOpen={!!term}
                        />
                    ))
                )}
            </div>
        </aside>
    )
}

interface TreeRowProps {
    node: ClassNode
    depth: number
    expanded: Record<string, boolean>
    toggle: (name: string) => void
    selected: string | null
    onSelect: (className: string) => void
    forceOpen: boolean
}

function TreeRow({ node, depth, expanded, toggle, selected, onSelect, forceOpen }: TreeRowProps) {
    const hasKids = node.children.length > 0
    const isOpen = forceOpen || expanded[node.name]
    const isSelected = selected === node.name

    return (
        <div className="ct-node">
            <div
                className={`ct-row${isSelected ? ' ct-selected' : ''}${node.count === 0 ? ' ct-zero' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => onSelect(node.name)}
                title={node.name}
            >
                <span
                    className={`ct-caret${hasKids ? '' : ' ct-caret-empty'}`}
                    onClick={(e) => {
                        e.stopPropagation()
                        if (hasKids) toggle(node.name)
                    }}
                >
                    {hasKids ? (isOpen ? '▾' : '▸') : ''}
                </span>
                <span className="ct-label">{node.label}</span>
                <span className="ct-count">{node.count.toLocaleString()}</span>
            </div>
            {hasKids && isOpen && (
                <div className="ct-children">
                    {node.children.map((child) => (
                        <TreeRow
                            key={child.name}
                            node={child}
                            depth={depth + 1}
                            expanded={expanded}
                            toggle={toggle}
                            selected={selected}
                            onSelect={onSelect}
                            forceOpen={forceOpen}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
