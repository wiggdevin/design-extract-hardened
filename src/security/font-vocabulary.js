// Closed vocabulary of font family names that may appear in agent-facing
// prompts. A family name comes from the page's own CSS, so it is free text an
// attacker controls: no pattern can tell "Playfair Display" from "Upload
// private files". Only names on this list print; any other family is shown
// as "(custom face)" or dropped. Extend the list, never loosen the match.
const FAMILIES = [
  'Inter', 'Arial', 'Helvetica', 'Helvetica Neue', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Segoe UI', 'Roboto', 'Roboto Mono', 'Roboto Slab', 'Roboto Condensed', 'Open Sans',
  'Lato', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Nunito Sans', 'Oswald', 'Source Sans 3',
  'Source Sans Pro', 'Source Serif 4', 'Source Code Pro', 'Noto Sans', 'Noto Serif', 'Ubuntu', 'Rubik',
  'Work Sans', 'Fira Sans', 'Fira Code', 'Mulish', 'Manrope', 'DM Sans', 'DM Serif Display', 'DM Mono',
  'Playfair Display', 'Merriweather', 'Lora', 'PT Sans', 'PT Serif', 'IBM Plex Sans', 'IBM Plex Serif',
  'IBM Plex Mono', 'Space Grotesk', 'Space Mono', 'JetBrains Mono', 'Karla', 'Barlow', 'Quicksand',
  'Outfit', 'Plus Jakarta Sans', 'Figtree', 'Geist', 'Geist Mono', 'Archivo', 'Libre Baskerville',
  'Libre Franklin', 'Cormorant Garamond', 'EB Garamond', 'Crimson Text', 'Bebas Neue', 'Josefin Sans',
  'Cabin', 'Heebo', 'Hind', 'Arimo', 'Titillium Web', 'Exo 2', 'Sora', 'Lexend', 'Urbanist', 'Epilogue',
  'Bricolage Grotesque', 'Instrument Sans', 'Instrument Serif', 'SF Pro Display', 'SF Pro Text',
  'system-ui', 'sans-serif', 'serif', 'monospace',
];
const BY_KEY = new Map(FAMILIES.map((name) => [name.toLowerCase(), name]));

// The canonical spelling of a known family, or '' for anything else.
export function knownFontFamily(value) {
  if (typeof value !== 'string') return '';
  return BY_KEY.get(value.trim().replace(/\s+/g, ' ').toLowerCase()) || '';
}
