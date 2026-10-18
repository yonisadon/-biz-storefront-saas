export const BRAND_PALETTES = {
  lavender: { label: 'סגול ולבן', description: 'מראה רך, אלגנטי ומודרני', colors: { primary: '#76539B', secondary: '#E8DDF2', accent: '#A78BC4', background: '#FCFAFE', text: '#30263A' } },
  rose: { label: 'ורוד אלגנטי', description: 'מתאים ליופי, טיפוח ואופנה', colors: { primary: '#A95768', secondary: '#F6E5E8', accent: '#81505A', background: '#FFFBFA', text: '#33272A' } },
  natural: { label: 'טבעי ומרגיע', description: 'מתאים לקליניקות, טיפול וייעוץ', colors: { primary: '#55745D', secondary: '#E5EDE5', accent: '#B27A4B', background: '#FAFBF8', text: '#27342A' } },
  luxury: { label: 'יוקרתי', description: 'גווני אבן, שחור וזהב', colors: { primary: '#80623F', secondary: '#EEE6DA', accent: '#B99A5E', background: '#FCFAF6', text: '#292722' } },
  blue: { label: 'מודרני וכחול', description: 'מתאים לשירותים מקצועיים ולעסקים', colors: { primary: '#426B91', secondary: '#E4EDF5', accent: '#B77942', background: '#F8FAFC', text: '#202D3A' } },
  minimal: { label: 'נקי ומינימליסטי', description: 'עיצוב מאופק שמתאים כמעט לכל תחום', colors: { primary: '#334155', secondary: '#E2E8F0', accent: '#64748B', background: '#FFFFFF', text: '#1F2937' } },
} as const;
export type PaletteId = keyof typeof BRAND_PALETTES;
export function paletteIdForColors(colors?: Record<string, string | undefined> | null): PaletteId {
  const primary = colors?.primary?.toLowerCase();
  return (Object.keys(BRAND_PALETTES) as PaletteId[]).find(id => BRAND_PALETTES[id].colors.primary.toLowerCase() === primary) ?? 'natural';
}
