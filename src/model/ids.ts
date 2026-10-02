const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short random id (10 chars of [a-z0-9]); ~51 bits of entropy is plenty for one drawing. */
export function newId(): string {
	const bytes = new Uint8Array(10);
	crypto.getRandomValues(bytes);
	let id = "";
	for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
	return id;
}

/** Local date and time as "YYYY-MM-DD HH.mm.ss", used to name new drawings. */
export function fileStamp(date: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	const day = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
	return `${day} ${p(date.getHours())}.${p(date.getMinutes())}.${p(date.getSeconds())}`;
}
