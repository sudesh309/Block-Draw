/**
 * The font families a drawing may name in `style.fontFamily`. They are part of the file format
 * (docs/FORMAT.md); render/fonts.ts maps each one to a CSS font stack.
 */
export const FONT_IDS = ["inter", "segoe", "roboto", "arial", "calibri", "aptos", "opensans", "montserrat", "lato", "georgia"] as const;

export type FontFamilyId = (typeof FONT_IDS)[number];
