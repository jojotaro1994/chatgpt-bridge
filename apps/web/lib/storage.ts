/**
 * localStorage helpers. Server URL + device token persist across reloads.
 * The "admin token" is stored only transiently (for pairing) — the web app
 * swaps it out for a per-device `dt_...` token after POST /api/pair succeeds.
 */
const K = {
  serverUrl: 'e2e-bridge.serverUrl',
  token: 'e2e-bridge.token',                // device token (post-pair)
  adminToken: 'e2e-bridge.adminToken',      // transient, used to pair
  deviceId: 'e2e-bridge.deviceId',          // paired device id (for display)
  deviceName: 'e2e-bridge.deviceName',
};

export const storage = {
  getServerUrl(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(K.serverUrl) ?? '';
  },
  setServerUrl(v: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(K.serverUrl, v);
  },
  getToken(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(K.token) ?? '';
  },
  setToken(v: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(K.token, v);
  },
  getAdminToken(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(K.adminToken) ?? '';
  },
  setAdminToken(v: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(K.adminToken, v);
  },
  getDeviceId(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(K.deviceId) ?? '';
  },
  setDeviceId(v: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(K.deviceId, v);
  },
  getDeviceName(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(K.deviceName) ?? '';
  },
  setDeviceName(v: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(K.deviceName, v);
  },
  /** Clear everything (logout). */
  clear() {
    if (typeof window === 'undefined') return;
    Object.values(K).forEach((k) => localStorage.removeItem(k));
  },
  /** Clear admin token only (used after successful pair). */
  clearAdminToken() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(K.adminToken);
  },
};
