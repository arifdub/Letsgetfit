// Small line icons, drawn as SVG so they follow the text colour and need no image files.
// Icons are decorative: the button or heading next to them carries the name.

const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  search: ['M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14z', 'M16.2 16.2L21 21'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3', 'M12 7.5l1.3 3.2l3.2 1.3l-3.2 1.3L12 16.5l-1.3-3.2L7.500 12l3.2-1.300z'],
  describe: ['M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M8 9h8', 'M8 12h5'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  exercise: ['M3 10v4', 'M6 7v10', 'M18 7v10', 'M21 10v4', 'M6 12h12'],
  flame: ['M12 3c1 3.500 5 5.500 5 10a5 5 0 0 1-10 0c0-1.800.8-3 1.800-4c.2 1.500 1 2.300 1.900 2.500C10.400 9 10.800 5.500 12 3z'],
  apple: ['M12 7.500c-1.700-1.700-6-1.400-6.500 3c-.5 4.500 2.300 8.500 4.500 8.500c.8 0 1.300-.4 2-.4s1.200.4 2 .4c2.200 0 5-4 4.500-8.500c-.5-4.400-4.800-4.700-6.500-3z', 'M12 7.500c0-2 .8-3.300 2.500-4'],
  balance: ['M12 4v16', 'M7 20h10', 'M5 8h14', 'M5 8l-2.500 6a2.700 2.700 0 0 0 5 0z', 'M19 8l-2.500 6a2.700 2.700 0 0 0 5 0z'],
  breakfast: ['M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 11h1.500a2.500 2.500 0 0 1 0 5H16', 'M8 4v2.500', 'M12 4v2.500'],
  lunch: ['M4 12h16a8 8 0 0 1-16 0z', 'M8 8.500c0-1.500 1.500-1.500 1.500-3', 'M12.500 8.500c0-1.500 1.500-1.500 1.500-3'],
  dinner: ['M7 3v8', 'M5 3v4a2 2 0 0 0 4 0V3', 'M7 11v10', 'M17 3c-2 1.500-3 4-3 7h3z', 'M17 3v18'],
  snacks: ['M12 8c-1.500-1.500-5-1.200-5.400 2.500c-.4 3.800 1.900 7 3.700 7c.7 0 1.100-.3 1.700-.3s1 .3 1.700.3c1.800 0 4.100-3.200 3.700-7C17 6.800 13.500 6.500 12 8z', 'M12 8c0-1.600.6-2.700 2-3.300'],
};

/** @param {keyof typeof PATHS} name */
export function icon(name, className = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
