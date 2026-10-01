const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short random id (10 chars of [a-z0-9]); ~51 bits of entropy is plenty for one drawing. */
export function newId(): string {
	const bytes = new Uint8Array(10);
	crypto.getRandomValues(bytes);
	let id = "";
	for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
	return id;
}
