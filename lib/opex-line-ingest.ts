import type { Row } from "@/types/finance";
import { isOperatingExpenseRow } from "@/lib/is-classification";

export type IngestedOpExLineV1 = {
  lineId: string;
  label: string;
  parentLabel: string;
  depth: number;
  sectionOwner: string | null;
  sortIndex: number;
};

function findOperatingExpensesRoot(rows: Row[]): Row | null {
  for (const r of rows) {
    if (r.id === "operating_expenses") return r;
  }
  return null;
}

/**
 * Leaf operating-expense rows under the historical IS `operating_expenses` parent, in tree order.
 * Does not invent lines — only rows already on the P&L under OpEx.
 */
export function collectOperatingExpenseLeafLines(incomeStatement: Row[]): IngestedOpExLineV1[] {
  const root = findOperatingExpensesRoot(incomeStatement ?? []);
  if (!root?.children?.length) return [];
  const out: IngestedOpExLineV1[] = [];
  let sortIndex = 0;

  const walk = (node: Row, parentLabel: string, depth: number) => {
    const children = node.children ?? [];
    if (children.length > 0) {
      for (const c of children) {
        walk(c, node.label ?? "", depth + 1);
      }
      return;
    }
    if (!isOperatingExpenseRow(node)) return;
    out.push({
      lineId: node.id,
      label: node.label ?? "",
      parentLabel,
      depth,
      sectionOwner: node.sectionOwner ?? null,
      sortIndex: sortIndex++,
    });
  };

  for (const c of root.children) {
    walk(c, root.label ?? "Operating expenses", 0);
  }
  return out;
}
