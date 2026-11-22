import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ButtonReference, ButtonReferenceInput } from "../../shared/button-references.ts";

export const MAX_REFERENCES_PER_CONTROL = 100;

export function buttonReferenceStore(db: DatabaseSync) {
  const list = db.prepare("SELECT id, revision, details FROM button_references WHERE control_id = ? ORDER BY rowid");
  const insert = db.prepare(
    `INSERT INTO button_references (control_id, id, revision, details)
     SELECT ?, ?, 1, ? WHERE (SELECT COUNT(*) FROM button_references WHERE control_id = ?) < ?`,
  );
  const replace = db.prepare("UPDATE button_references SET details = ?, revision = revision + 1 WHERE control_id = ? AND id = ? AND revision = ?");
  const remove = db.prepare("DELETE FROM button_references WHERE control_id = ? AND id = ? AND revision = ?");

  return {
    list(controlId: string): ButtonReference[] {
      const rows = list.all(controlId) as { id: string; revision: number; details: string }[];
      return rows.map(({ id, revision, details }) => ({ ...(JSON.parse(details) as ButtonReferenceInput), id, revision }));
    },
    create(controlId: string, input: ButtonReferenceInput) {
      return Number(insert.run(controlId, randomUUID(), JSON.stringify(input), controlId, MAX_REFERENCES_PER_CONTROL).changes) === 1;
    },
    update(controlId: string, id: string, revision: number, input: ButtonReferenceInput) {
      return Number(replace.run(JSON.stringify(input), controlId, id, revision).changes) === 1;
    },
    remove(controlId: string, id: string, revision: number) {
      return Number(remove.run(controlId, id, revision).changes) === 1;
    },
  };
}
