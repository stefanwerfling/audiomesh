/** Escape a string for safe interpolation into innerHTML. */
export function esc(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Bootstrap contextual class for a connection state — drives status badges. */
export function stateClass(state: string): string {
    switch (state) {
        case 'connected':
        case 'running':
            return 'success';
        case 'connecting':
        case 'reconnecting':
            return 'warning';
        case 'failed':
            return 'danger';
        default:
            return 'secondary';
    }
}
