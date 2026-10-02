import { isConnector, type DrawElement } from "./types";

export interface DependencyTrace {
	rootId: string;
	/** Blocks the root depends on (reached by walking connectors backwards). */
	upstream: Set<string>;
	/** Blocks that depend on the root (reached by walking connectors forwards). */
	downstream: Set<string>;
	/** Connectors on any upstream or downstream path. */
	connectors: Set<string>;
}

/**
 * Impact analysis for a block: everything reachable along connector direction (downstream) and
 * against it (upstream). Cycles are handled; a block in a cycle with the root is in both sets.
 */
export function traceDependencies(elements: readonly DrawElement[], rootId: string): DependencyTrace {
	const out = new Map<string, { to: string; conn: string }[]>();
	const inc = new Map<string, { to: string; conn: string }[]>();
	for (const el of elements) {
		if (!isConnector(el)) continue;
		if (!out.has(el.from.id)) out.set(el.from.id, []);
		if (!inc.has(el.to.id)) inc.set(el.to.id, []);
		out.get(el.from.id)?.push({ to: el.to.id, conn: el.id });
		inc.get(el.to.id)?.push({ to: el.from.id, conn: el.id });
	}
	const connectors = new Set<string>();
	const walk = (adj: Map<string, { to: string; conn: string }[]>): Set<string> => {
		const seen = new Set<string>();
		const queue = [rootId];
		while (queue.length) {
			const id = queue.shift() as string;
			for (const edge of adj.get(id) ?? []) {
				connectors.add(edge.conn);
				if (edge.to === rootId || seen.has(edge.to)) continue;
				seen.add(edge.to);
				queue.push(edge.to);
			}
		}
		return seen;
	};
	const downstream = walk(out);
	const upstream = walk(inc);
	return { rootId, upstream, downstream, connectors };
}

/** Every element id that stays highlighted while a trace is shown. */
export function traceMembers(trace: DependencyTrace): Set<string> {
	return new Set([trace.rootId, ...trace.upstream, ...trace.downstream, ...trace.connectors]);
}
