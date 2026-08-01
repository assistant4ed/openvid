// Multi-key registry. Users can hold several SuperbAPI keys (different tiers
// unlock different render models); they are stored ranked, and every render
// routes to the highest-ranked key that supports the chosen model.
//
// Storage: superbapi_keys_v1 = [{ key, label, caps }] in rank order.
// The legacy single-key slot (superbapi_key) is kept in sync with rank #1 so
// every existing reader (session gate, credits chip, image/prompt routes)
// keeps working unchanged.

const KEYS_STORE = 'superbapi_keys_v1';
const ACTIVE_KEY = 'superbapi_key';
const CAPS_STORE = 'superb_caps_v1';

function storage() {
    return typeof window !== 'undefined' ? window.localStorage : null;
}

export function listSuperbKeys() {
    const store = storage();
    if (!store) return [];
    try {
        const parsed = JSON.parse(store.getItem(KEYS_STORE) || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
        // fall through to migration
    }
    // Migrate the pre-multi-key single slot.
    const legacy = store.getItem(ACTIVE_KEY);
    if (legacy) {
        let caps = null;
        try {
            caps = JSON.parse(store.getItem(CAPS_STORE) || 'null');
        } catch {
            caps = null;
        }
        const seeded = [{ key: legacy, label: 'Key 1', caps }];
        store.setItem(KEYS_STORE, JSON.stringify(seeded));
        return seeded;
    }
    return [];
}

export function saveSuperbKeys(keys) {
    const store = storage();
    if (!store) return;
    store.setItem(KEYS_STORE, JSON.stringify(keys));
    if (keys.length > 0) {
        // Rank #1 is the session key; keep the legacy slot + caps cache in sync.
        store.setItem(ACTIVE_KEY, keys[0].key);
        if (keys[0].caps) store.setItem(CAPS_STORE, JSON.stringify(keys[0].caps));
        window.dispatchEvent(new CustomEvent('superb:keys', { detail: keys }));
        if (keys[0].caps) {
            window.dispatchEvent(new CustomEvent('superb:caps', { detail: keys[0].caps }));
        }
    } else {
        store.removeItem(ACTIVE_KEY);
        store.removeItem(CAPS_STORE);
        window.dispatchEvent(new CustomEvent('superb:keys', { detail: [] }));
    }
}

export function activeSuperbKey() {
    const store = storage();
    return store ? store.getItem(ACTIVE_KEY) : null;
}

/**
 * The routing rule: highest-ranked key whose probed capabilities include the
 * requested video model; falls back to the active key so a render is always
 * attempted (the server rejects honestly if truly unsupported).
 */
export function keyForVideoModel(modelId) {
    const keys = listSuperbKeys();
    if (!modelId || keys.length === 0) return activeSuperbKey();
    for (const entry of keys) {
        const ids = entry.caps?.video?.map((m) => m.id) || [];
        if (ids.includes(modelId)) return entry.key;
    }
    return activeSuperbKey();
}

export function maskKey(key) {
    return typeof key === 'string' && key.length > 14
        ? `${key.slice(0, 12)}••••••${key.slice(-4)}`
        : '••••';
}
