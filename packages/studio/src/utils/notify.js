// In-app notifications for studio components. Replaces raw window.alert()
// (which renders an ugly OS dialog titled with the deploy hostname) with the
// shell's slate notification stack. Falls back to alert only when no shell
// is listening (e.g. a studio embedded outside StandaloneShell).

export function notifyError(message) {
    if (typeof window === 'undefined') return;

    const detail = { kind: 'error', message: String(message || 'Something went wrong') };
    const delivered = window.dispatchEvent(new CustomEvent('studio:notify', { detail }));

    if (!window.__studioNotifyMounted) {
        // No shell listener registered — keep the old behaviour as a fallback.
        window.alert(detail.message);
    }
    return delivered;
}

export function notifyInfo(message) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
        new CustomEvent('studio:notify', {
            detail: { kind: 'info', message: String(message || '') },
        }),
    );
}
