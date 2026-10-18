import { formatAge } from "../../utils/format"

export function FreshnessBadge({ freshness }) {
    if (!freshness) return <span className="fresh old">never</span>
    const level = freshness.level
    const className =
        level === 'live' ? 'fresh now' : level === 'aging' ? 'fresh' : level === 'stale' ? 'fresh stale' : 'fresh old'
    return <span className={className}>{formatAge(freshness.ageMs)}</span>
}