import { useSyncExternalStore } from 'react';

const sub = (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
const snap = () => window.location.hash.replace(/^#\/?/, '') || 'bots';
export const useRoute = () => useSyncExternalStore(sub, snap).split('/');
export const go = (path) => { window.location.hash = `/${path}`; };
