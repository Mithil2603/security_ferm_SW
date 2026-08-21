export const getServerBaseUrl = () => {
  const savedServerIP = typeof localStorage !== 'undefined' ? localStorage.getItem('serverIP') : null;
  if (savedServerIP) {
    return `http://${savedServerIP}:3000`;
  }
  if (typeof window !== 'undefined' && window.location && window.location.protocol && window.location.protocol.startsWith('http')) {
    return window.location.origin;
  }
  const defaultApi = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || 'http://127.0.0.1:3000/api';
  return defaultApi.replace(/\/api\/?$/, '');
};

export const getApiBaseUrl = () => {
  return `${getServerBaseUrl()}/api`;
};
