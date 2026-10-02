/**
 * The 10 most used fonts in the world for business presentations.
 *
 * Covers modern executive sans-serifs, corporate boardroom standards, high-impact
 * startup pitch deck fonts, and authoritative digital serifs with robust cross-platform
 * fallback stacks for Windows, macOS, iOS, Android, and Linux.
 */

export type FontFamilyId =
	| "inter"
	| "segoe"
	| "roboto"
	| "arial"
	| "calibri"
	| "aptos"
	| "opensans"
	| "montserrat"
	| "lato"
	| "georgia";

export interface PresentationFont {
	id: FontFamilyId;
	name: string;
	label: string;
	category: "sans-serif" | "serif";
	tagline: string;
	stack: string;
}

export const PRESENTATION_FONTS: readonly PresentationFont[] = [
	{
		id: "inter",
		name: "Inter",
		label: "Inter",
		category: "sans-serif",
		tagline: "Modern tech standard",
		stack: 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif',
	},
	{
		id: "segoe",
		name: "Segoe UI",
		label: "Segoe UI",
		category: "sans-serif",
		tagline: "Microsoft enterprise",
		stack: '"Segoe UI", Tahoma, Geneva, Verdana, -apple-system, sans-serif',
	},
	{
		id: "roboto",
		name: "Roboto",
		label: "Roboto",
		category: "sans-serif",
		tagline: "Google & Android clean",
		stack: 'Roboto, "Helvetica Neue", Arial, -apple-system, sans-serif',
	},
	{
		id: "arial",
		name: "Arial / Helvetica",
		label: "Arial",
		category: "sans-serif",
		tagline: "Universal boardroom classic",
		stack: '"Helvetica Neue", Helvetica, Arial, -apple-system, sans-serif',
	},
	{
		id: "calibri",
		name: "Calibri",
		label: "Calibri",
		category: "sans-serif",
		tagline: "Office & PowerPoint classic",
		stack: 'Calibri, Candara, "Segoe UI", Optima, Arial, sans-serif',
	},
	{
		id: "aptos",
		name: "Aptos",
		label: "Aptos",
		category: "sans-serif",
		tagline: "Microsoft 365 modern",
		stack: 'Aptos, Calibri, "Segoe UI", sans-serif',
	},
	{
		id: "opensans",
		name: "Open Sans",
		label: "Open Sans",
		category: "sans-serif",
		tagline: "High-legibility decks",
		stack: '"Open Sans", "Helvetica Neue", Arial, sans-serif',
	},
	{
		id: "montserrat",
		name: "Montserrat",
		label: "Montserrat",
		category: "sans-serif",
		tagline: "Executive pitch & headings",
		stack: 'Montserrat, "Segoe UI", Arial, sans-serif',
	},
	{
		id: "lato",
		name: "Lato",
		label: "Lato",
		category: "sans-serif",
		tagline: "Corporate & consulting",
		stack: 'Lato, "Helvetica Neue", Arial, sans-serif',
	},
	{
		id: "georgia",
		name: "Georgia",
		label: "Georgia",
		category: "serif",
		tagline: "Editorial & prestige serif",
		stack: 'Georgia, "Times New Roman", Times, serif',
	},
];

export const FONT_IDS: readonly FontFamilyId[] = PRESENTATION_FONTS.map((f) => f.id);

export const DEFAULT_FONT_FAMILY: FontFamilyId = "inter";

export function fontDefinitionById(id: string | null | undefined): PresentationFont {
	if (!id) return PRESENTATION_FONTS[0];
	return PRESENTATION_FONTS.find((f) => f.id === id) ?? PRESENTATION_FONTS[0];
}

export function fontStack(id: string | null | undefined): string {
	return fontDefinitionById(id).stack;
}
