export const getServerBaseUrl = () => {
  // 1. Manual server IP override (LAN setup)
  const savedServerIP = typeof localStorage !== 'undefined' ? localStorage.getItem('serverIP') : null;
  if (savedServerIP) {
    return `http://${savedServerIP}:3000`;
  }

  // 2. Browser access via LAN or localhost
  if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
    const { hostname, port } = window.location;
    // Vite dev server runs on 5173, but backend is always on 3000
    if (port === '5173' || port === '3001') {
      return `http://${hostname}:3000`;
    }
    // Production: Electron or same-origin reverse proxy
    return window.location.origin;
  }

  // 3. Fallback
  const defaultApi = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || 'http://127.0.0.1:3000/api';
  return defaultApi.replace(/\/api\/?$/, '');
};

export const getApiBaseUrl = () => {
  return `${getServerBaseUrl()}/api`;
};
