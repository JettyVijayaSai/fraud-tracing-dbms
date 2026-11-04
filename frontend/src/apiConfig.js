// Dynamic API & WebSocket configuration for Local & Cloud deployments
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const getWsUrl = (path = '/ws/alerts') => {
  if (import.meta.env.VITE_WS_URL) {
    return `${import.meta.env.VITE_WS_URL.replace(/\/$/, '')}${path}`;
  }
  if (import.meta.env.VITE_API_URL) {
    // Convert https://... to wss://... or http://... to ws://...
    const raw = import.meta.env.VITE_API_URL.replace(/^http/, 'ws').replace(/\/$/, '');
    return `${raw}${path}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
};
