import React from 'react';

const paths = {
  copy: 'M9 9h11v11H9z M5 15H3V3h12v2',
  expand: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
  close: 'm6 6 12 12 M18 6 6 18',
  info: 'M12 16v-4 M12 8h.01',
  search: 'm16.5 16.5 4.5 4.5',
  reset: 'M3 10a9 9 0 1 1 2 8 M3 3v7h7',
  code: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
  check: 'm5 12 4 4 10-10',
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'info' && <circle cx="12" cy="12" r="9" />}
    {name === 'search' && <circle cx="10.5" cy="10.5" r="6.5" />}
    <path d={paths[name]} />
  </svg>;
}
