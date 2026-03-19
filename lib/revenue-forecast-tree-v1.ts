/**
 * Forecast-only revenue hierarchy (Forecast Drivers). Never mutates incomeStatement.
 */

import type { Row } from "@/types/finance";
import type { ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";

export function rowToForecastNode(r: Row): ForecastRevenueNodeV1 {
  return {
    id: r.id,
    label: r.label,
    isForecastOnly: false,
    children: (r.children ?? []).map(rowToForecastNode),
  };
}

export function cloneRevChildrenToForecastTree(revChildren: Row[]): ForecastRevenueNodeV1[] {
  return revChildren.map(rowToForecastNode);
}

export function collectForecastTreeIds(nodes: ForecastRevenueNodeV1[]): string[] {
  const out: string[] = [];
  const walk = (n: ForecastRevenueNodeV1) => {
    out.push(n.id);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/** Remove rowId from tree (stream or nested child); removes entire subtree if stream matches. */
export function removeForecastRowDeep(
  nodes: ForecastRevenueNodeV1[],
  rowId: string
): ForecastRevenueNodeV1[] {
  const out: ForecastRevenueNodeV1[] = [];
  for (const n of nodes) {
    if (n.id === rowId) continue;
    out.push({
      ...n,
      children: removeForecastRowDeep(n.children, rowId),
    });
  }
  return out;
}

export function addChildToForecastTree(
  nodes: ForecastRevenueNodeV1[],
  parentId: string,
  child: ForecastRevenueNodeV1
): ForecastRevenueNodeV1[] {
  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, children: [...n.children, child] };
    return { ...n, children: addChildToForecastTree(n.children, parentId, child) };
  });
}

export function findForecastNode(
  nodes: ForecastRevenueNodeV1[],
  id: string
): ForecastRevenueNodeV1 | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findForecastNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Update display label for a node anywhere in the tree (immutable). */
export function updateForecastTreeNodeLabel(
  nodes: ForecastRevenueNodeV1[],
  id: string,
  label: string
): ForecastRevenueNodeV1[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, label };
    if (!n.children.length) return n;
    return { ...n, children: updateForecastTreeNodeLabel(n.children, id, label) };
  });
}

/** All ids in subtree rooted at rowId (including rowId). */
export function collectSubtreeIdsFromForecastTree(
  nodes: ForecastRevenueNodeV1[],
  rowId: string
): string[] {
  const node = findForecastNode(nodes, rowId);
  if (!node) return [rowId];
  const ids: string[] = [];
  const walk = (n: ForecastRevenueNodeV1) => {
    ids.push(n.id);
    n.children.forEach(walk);
  };
  walk(node);
  return ids;
}

/** Prune any node whose id is in removeSet (entire subtrees). */
export function pruneForecastTreeByIds(
  nodes: ForecastRevenueNodeV1[],
  removeSet: Set<string>
): ForecastRevenueNodeV1[] {
  return nodes
    .filter((n) => !removeSet.has(n.id))
    .map((n) => ({
      ...n,
      children: pruneForecastTreeByIds(n.children, removeSet),
    }));
}

/**
 * Move an allocation child out from under its direct parent to sit as a sibling
 * immediately after that parent (under the same grandparent). Fails if the
 * allocation's parent is a top-level forest node (no grandparent).
 */
export function promoteAllocationRowToForecastSibling(
  tree: ForecastRevenueNodeV1[],
  rowId: string
): { tree: ForecastRevenueNodeV1[] } | { error: "not_found" | "top_level_parent" } {
  function findContext(
    nodes: ForecastRevenueNodeV1[],
    grandparent: ForecastRevenueNodeV1 | null
  ): { gp: ForecastRevenueNodeV1; parent: ForecastRevenueNodeV1; promoted: ForecastRevenueNodeV1 } | null {
    for (const n of nodes) {
      const j = n.children.findIndex((c) => c.id === rowId);
      if (j >= 0) {
        if (!grandparent) return null;
        return { gp: grandparent, parent: n, promoted: n.children[j]! };
      }
      const inner = findContext(n.children, n);
      if (inner) return inner;
    }
    return null;
  }

  const hit = findContext(tree, null);
  if (!hit) {
    if (!findForecastNode(tree, rowId)) return { error: "not_found" };
    return { error: "top_level_parent" };
  }

  const { gp, parent, promoted } = hit;
  function applyPromote(
    nodes: ForecastRevenueNodeV1[],
    gpId: string,
    parentId: string,
    rid: string,
    prom: ForecastRevenueNodeV1
  ): ForecastRevenueNodeV1[] {
    return nodes.map((n) => {
      if (n.id === gpId) {
        const newChildren: ForecastRevenueNodeV1[] = [];
        for (const c of n.children) {
          if (c.id === parentId) {
            newChildren.push({
              ...c,
              children: c.children.filter((x) => x.id !== rid),
            });
            newChildren.push({ ...prom, children: [] });
          } else {
            newChildren.push(c);
          }
        }
        return { ...n, children: newChildren };
      }
      return { ...n, children: applyPromote(n.children, gpId, parentId, rid, prom) };
    });
  }
  return { tree: applyPromote(tree, gp.id, parent.id, rowId, promoted) };
}
