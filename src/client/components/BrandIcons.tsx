import React from 'react'

// Inline single-path Atlassian-family brand marks (geometry from the Simple
// Icons set). Inlined rather than fetched so they bundle into the BYOUI page
// with no extra network request, CSP, or proxy concern on the instance. Each
// fills with `currentColor`, so the button's text color drives the icon color.

interface IconProps {
    size?: number
    className?: string
}

function BrandSvg({ size = 14, className, title, d }: IconProps & { title: string; d: string }) {
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            role="img"
            aria-label={title}
            focusable="false"
        >
            <title>{title}</title>
            <path d={d} />
        </svg>
    )
}

const ATLASSIAN_D =
    'M7.12 11.084a.683.683 0 00-1.16.126L.075 22.974a.703.703 0 00.63 1.018h8.19a.678.678 0 00.63-.39c1.767-3.65.696-9.203-2.406-12.52zM11.434.386a15.515 15.515 0 00-.906 15.317l3.95 7.9a.703.703 0 00.628.388h8.19a.703.703 0 00.63-1.017L12.63.38a.664.664 0 00-1.196.006z'

const CONFLUENCE_D =
    'M.87 18.257c-.248.382-.53.875-.763 1.245a.764.764 0 0 0 .255 1.04l4.965 3.054a.764.764 0 0 0 1.058-.26c.199-.332.454-.763.733-1.221 1.967-3.247 3.945-2.853 7.508-1.146l4.957 2.337a.764.764 0 0 0 1.028-.382l2.364-5.346a.764.764 0 0 0-.382-1 599.851 599.851 0 0 1-4.965-2.361C10.911 10.97 5.224 11.185.87 18.257zM23.131 5.743c.249-.405.531-.875.764-1.25a.764.764 0 0 0-.256-1.034L18.675.404a.764.764 0 0 0-1.058.26c-.195.335-.451.763-.734 1.225-1.966 3.246-3.945 2.85-7.508 1.146L4.437.694a.764.764 0 0 0-1.027.382L1.046 6.422a.764.764 0 0 0 .382 1c1.039.49 3.105 1.467 4.965 2.361 6.698 3.246 12.392 3.029 16.738-4.04z'

const JIRA_D =
    'M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z'

export const AtlassianIcon = (p: IconProps) => <BrandSvg {...p} title="Atlassian" d={ATLASSIAN_D} />
export const ConfluenceIcon = (p: IconProps) => <BrandSvg {...p} title="Confluence" d={CONFLUENCE_D} />
export const JiraIcon = (p: IconProps) => <BrandSvg {...p} title="Jira" d={JIRA_D} />
