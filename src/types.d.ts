/** Apps Script source bundled as text (esbuild `text` loader). */
declare module "*.gs" {
	const content: string;
	export default content;
}
