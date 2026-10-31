import { useEffect } from 'react';
import { APP } from '@/config/app';

export function useDocumentTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ${APP.name}` : `${APP.name} · Real-time collaborative code editor`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
