import React, { useEffect, useState } from 'react'
import type { CmdbService, CiInstance, CiRelation } from '../services/CmdbService'
import { dv, parseInstanceLink, jiraSearchUrl, confluenceSearchUrl } from '../services/display'
import './CiDetail.css'

interface CiDetailProps {
    service: CmdbService
    className: string
    sysId: string
    jiraBase?: string
    confluenceBase?: string
    onNavigate: (className: string, sysId: string) => void
    onClose: () => void
}

// Attributes worth surfacing at the top of the panel, in this order.
const KEY_ATTRS = [
    'name',
    'sys_class_name',
    'operational_status',
    'ip_address',
    'fqdn',
    'os',
    'os_version',
    'serial_number',
    'manufacturer',
    'version',
    'short_description',
    'sys_updated_on',
]

export default function CiDetail({
    service,
    className,
    sysId,
    jiraBase,
    confluenceBase,
    onNavigate,
    onClose,
}: CiDetailProps) {
    const [ci, setCi] = useState<CiInstance | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        setCi(null)
        service
            .getCI(className, sysId)
            .then((data) => !cancelled && setCi(data))
            .catch((e) => !cancelled && setError(e.message || 'Failed to load CI'))
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
    }, [service, className, sysId])

    // Scalar attributes come back as strings, but populated reference fields come
    // back as { value, display_value, link } objects — always render via dv().
    const attrs = ci?.attributes ?? {}
    const ciName = dv(attrs.name)
    const shown = KEY_ATTRS.filter((k) => dv(attrs[k]) !== '')

    return (
        <div className="ci-detail">
            <div className="ci-detail-head">
                <div className="ci-detail-title">{loading ? 'Loading…' : ciName || 'CI Detail'}</div>
                <button className="ci-detail-close" onClick={onClose} title="Close">
                    ✕
                </button>
            </div>

            {error && <div className="ci-detail-error">{error}</div>}

            {ci && (
                <div className="ci-detail-body">
                    <div className="ci-detail-class">{className}</div>

                    {ciName && (
                        <div className="ci-actions">
                            <button
                                className="ci-action-btn"
                                disabled={!jiraBase}
                                title={jiraBase ? 'Search Jira for this CI' : 'Set ibworks.jira.base_url'}
                                onClick={() => window.open(jiraSearchUrl(jiraBase!, ciName), '_blank', 'noopener')}
                            >
                                Search in Jira
                            </button>
                            <button
                                className="ci-action-btn"
                                disabled={!confluenceBase}
                                title={confluenceBase ? 'Search Confluence for this CI' : 'Set ibworks.confluence.base_url'}
                                onClick={() =>
                                    window.open(confluenceSearchUrl(confluenceBase!, ciName), '_blank', 'noopener')
                                }
                            >
                                Search in Confluence
                            </button>
                        </div>
                    )}

                    <section>
                        <h4>Attributes</h4>
                        <dl className="ci-attrs">
                            {shown.map((k) => (
                                <React.Fragment key={k}>
                                    <dt>{k}</dt>
                                    <dd>{dv(attrs[k])}</dd>
                                </React.Fragment>
                            ))}
                        </dl>
                    </section>

                    <RelationGroup
                        title="Depends on / Outbound"
                        relations={ci.outbound_relations}
                        onNavigate={onNavigate}
                    />
                    <RelationGroup
                        title="Used by / Inbound"
                        relations={ci.inbound_relations}
                        onNavigate={onNavigate}
                    />
                </div>
            )}
        </div>
    )
}

function RelationGroup({
    title,
    relations,
    onNavigate,
}: {
    title: string
    relations: CiRelation[]
    onNavigate: (className: string, sysId: string) => void
}) {
    if (!relations || relations.length === 0) return null
    return (
        <section>
            <h4>
                {title} <span className="ci-rel-count">{relations.length}</span>
            </h4>
            <ul className="ci-rels">
                {relations.map((rel) => {
                    const parsed = parseInstanceLink(rel.target?.link)
                    return (
                        <li
                            key={rel.sys_id}
                            className="ci-rel"
                            onClick={() => parsed && onNavigate(parsed.className, parsed.sysId)}
                            title={parsed ? 'Open ' + rel.target.display_value : 'No link'}
                        >
                            <span className="ci-rel-type">{rel.type?.display_value}</span>
                            <span className="ci-rel-target">{rel.target?.display_value}</span>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
