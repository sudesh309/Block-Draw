import fixtureJson from "../fixtures/sheets-v4-schemas.json";

/** Validates JSON values against Google API discovery schemas (types, enums, unknown fields). */

interface Schema {
	type?: string;
	$ref?: string;
	properties?: Record<string, Schema>;
	items?: Schema;
	additionalProperties?: Schema;
	enum?: string[];
	format?: string;
}

const fixture = fixtureJson as unknown as { schemas: Record<string, Schema> };

export function validate(value: unknown, schemaName: string): string[] {
	const errors: string[] = [];
	check(value, { $ref: schemaName }, schemaName, errors);
	return errors;
}

function check(value: unknown, schema: Schema, path: string, errors: string[]): void {
	if (schema.$ref) {
		const target = fixture.schemas[schema.$ref];
		if (!target) {
			errors.push(`${path}: schema ${schema.$ref} not in fixture`);
			return;
		}
		check(value, target, path, errors);
		return;
	}
	switch (schema.type) {
		case "object": {
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				errors.push(`${path}: expected object`);
				return;
			}
			for (const [k, v] of Object.entries(value)) {
				if (v === undefined) continue;
				const prop = schema.properties?.[k] ?? schema.additionalProperties;
				if (!prop) {
					errors.push(`${path}.${k}: unknown field`);
					continue;
				}
				check(v, prop, `${path}.${k}`, errors);
			}
			return;
		}
		case "array":
			if (!Array.isArray(value)) {
				errors.push(`${path}: expected array`);
				return;
			}
			value.forEach((v, i) => check(v, schema.items as Schema, `${path}[${i}]`, errors));
			return;
		case "string":
			if (typeof value !== "string") errors.push(`${path}: expected string`);
			else if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${value} not in enum`);
			return;
		case "integer":
			if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${path}: expected integer, got ${String(value)}`);
			else if (schema.format === "int32" && (value > 2147483647 || value < -2147483648)) errors.push(`${path}: int32 overflow`);
			return;
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path}: expected number`);
			return;
		case "boolean":
			if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
			return;
		case "any":
		case undefined:
			return;
		default:
			errors.push(`${path}: unsupported schema type ${schema.type}`);
	}
}
