export const formatAge = (ageMs) => {
    if (!Number.isFinite(ageMs)) return 'never'
    if (ageMs < 1_000) return 'just now'
    const seconds = Math.floor(ageMs / 1_000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
}

export const formatTime = (value) => {
    if (value == null) return '—';

    const date = new Date(Number(value));

    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}