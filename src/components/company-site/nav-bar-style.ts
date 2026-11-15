import type { CSSProperties } from 'react';

/** Shared height of the public site bar and the logged-in top bar. */
export const COMPANY_NAV_BAR_HEIGHT = '100px';

/** Engineering grid, center chevrons, right dots, and the navy-to-orange top edge. */
export const NAV_BAR_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1400' height='100' viewBox='0 0 1400 100' preserveAspectRatio='none'%3E%3Cdefs%3E%3ClinearGradient id='topBar' x1='0%25' y1='0%25' x2='100%25' y2='0%25'%3E%3Cstop offset='0%25' stop-color='%230b192c'/%3E%3Cstop offset='35%25' stop-color='%233a2e39'/%3E%3Cstop offset='70%25' stop-color='%23d96b27'/%3E%3Cstop offset='100%25' stop-color='%23ff7b00'/%3E%3C/linearGradient%3E%3Cpattern id='grid' width='25' height='25' patternUnits='userSpaceOnUse'%3E%3Cpath d='M 25 0 L 0 0 0 25' fill='none' stroke='%23cbd5e1' stroke-width='0.7'/%3E%3C/pattern%3E%3Cpattern id='dots' width='12' height='12' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='3' cy='3' r='1.3' fill='%2394a3b8' fill-opacity='0.45'/%3E%3C/pattern%3E%3ClinearGradient id='fadeLeft' x1='0%25' y1='0%25' x2='100%25' y2='0%25'%3E%3Cstop offset='0%25' stop-color='white' stop-opacity='1'/%3E%3Cstop offset='30%25' stop-color='white' stop-opacity='0'/%3E%3C/linearGradient%3E%3ClinearGradient id='fadeRight' x1='0%25' y1='0%25' x2='100%25' y2='0%25'%3E%3Cstop offset='40%25' stop-color='white' stop-opacity='0'/%3E%3Cstop offset='75%25' stop-color='white' stop-opacity='1'/%3E%3C/linearGradient%3E%3Cmask id='maskLeft'%3E%3Crect width='1400' height='100' fill='url(%23fadeLeft)'/%3E%3C/mask%3E%3Cmask id='maskRight'%3E%3Crect width='1400' height='100' fill='url(%23fadeRight)'/%3E%3C/mask%3E%3C/defs%3E%3Crect width='1400' height='100' fill='%23f8fafc'/%3E%3Crect width='1400' height='100' fill='url(%23grid)' mask='url(%23maskLeft)'/%3E%3Crect width='1400' height='100' fill='url(%23dots)' mask='url(%23maskRight)'/%3E%3Cg fill='%23cbd5e1' fill-opacity='0.35'%3E%3Cpolygon points='720,100 770,35 795,35 745,100'/%3E%3Cpolygon points='765,100 835,10 860,10 790,100'/%3E%3Cpolygon points='810,100 860,35 885,35 835,100'/%3E%3Cpolygon points='855,100 905,35 930,35 880,100'/%3E%3Cpolygon points='950,60 985,15 1005,15 970,60'/%3E%3C/g%3E%3Crect width='1400' height='5' fill='url(%23topBar)'/%3E%3Crect y='99' width='1400' height='1' fill='%23cbd5e1'/%3E%3C/svg%3E\")";

/** One viewport-wide pattern. `offset` shifts the slice so the sidebar and the content bar stay continuous. */
export function companyNavBarStyle(offset = '0px'): CSSProperties {
  return {
    backgroundColor: '#f8fafc',
    backgroundImage: NAV_BAR_BG,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `100vw ${COMPANY_NAV_BAR_HEIGHT}`,
    backgroundPosition: `${offset} 0`,
  };
}

/** Upper area stays clear to read; grid, dots, and diagonal bands sit in the lower fifth. */
const SIDEBAR_PATTERN_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='900' viewBox='0 0 280 900' preserveAspectRatio='none'%3E%3Cdefs%3E%3Cpattern id='sideGrid' width='24' height='24' patternUnits='userSpaceOnUse'%3E%3Cpath d='M 24 0 L 0 0 0 24' fill='none' stroke='%23cbd5e1' stroke-width='0.6'/%3E%3C/pattern%3E%3Cpattern id='sideDots' width='12' height='12' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='2' cy='2' r='1' fill='%2394a3b8' fill-opacity='0.35'/%3E%3C/pattern%3E%3ClinearGradient id='vertFade' x1='0%25' y1='0%25' x2='0%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='white' stop-opacity='0.12'/%3E%3Cstop offset='12%25' stop-color='white' stop-opacity='0'/%3E%3Cstop offset='72%25' stop-color='white' stop-opacity='0'/%3E%3Cstop offset='100%25' stop-color='white' stop-opacity='0.75'/%3E%3C/linearGradient%3E%3Cmask id='sideMask'%3E%3Crect width='280' height='900' fill='url(%23vertFade)'/%3E%3C/mask%3E%3C/defs%3E%3Crect width='280' height='900' fill='%23f8fafc'/%3E%3Crect width='280' height='900' fill='url(%23sideGrid)' mask='url(%23sideMask)'/%3E%3Crect y='680' width='280' height='220' fill='url(%23sideDots)' mask='url(%23sideMask)'/%3E%3Cg fill='%23cbd5e1' fill-opacity='0.22'%3E%3Cpolygon points='0,830 280,690 280,715 0,855'/%3E%3Cpolygon points='0,870 280,730 280,745 0,885'/%3E%3C/g%3E%3C/svg%3E\")";

export function companySidebarPanelStyle(): CSSProperties {
  return {
    backgroundColor: '#f8fafc',
    backgroundImage: SIDEBAR_PATTERN_BG,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 100%',
    borderRight: '1px solid #e2e8f0',
    boxShadow: '2px 0 12px rgba(15, 23, 42, 0.03)',
  };
}
