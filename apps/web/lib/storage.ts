/**
 * localStorage helpers. Server URL + token persist across reloads so the user
 * doesn't have to re-enter on every page load.
 */
const K = {
  serverUrl: 'e2e-bridge.serverUrl',
  token: 'e2e-bridge.token',
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
  clear() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(K.serverUrl);
    localStorage.removeItem(K.token);
  },
};
