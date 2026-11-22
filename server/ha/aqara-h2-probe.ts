export const AQARA_H2_BLUEPRINT = "homeassistant/aqara_h2_router.yaml";
const FIRST_ENTITY = "event.taxis_blueprint_probe_1";
const BRANCHES = ["b1_single", "b2_single", "b3_single", "b3_double", "b3_long", "b4_single", "b4_double", "b4_long"];
const marker = (branch: string) => `Taxis contract probe: ${branch}`;

// Blueprint substitution expands inputs without running or saving anything.
// Fixed sentinel values check the contract without forwarding household data.
export function aqaraH2Probe() {
  return {
    domain: "automation",
    path: AQARA_H2_BLUEPRINT,
    input: { button1_entity: FIRST_ENTITY, ...Object.fromEntries(BRANCHES.map((branch) => [branch, [{ stop: marker(branch) }]])) },
  };
}

export function isAqaraH2Probe(payload: Record<string, unknown>) {
  const { domain, path, input } = payload;
  if (
    Object.keys(payload).length !== 3 ||
    domain !== "automation" ||
    path !== AQARA_H2_BLUEPRINT ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  )
    return false;
  const values = input as Record<string, unknown>;
  return (
    Object.keys(values).length === BRANCHES.length + 1 &&
    values.button1_entity === FIRST_ENTITY &&
    BRANCHES.every((branch) => {
      const steps = values[branch];
      if (!Array.isArray(steps) || steps.length !== 1) return false;
      const [step] = steps;
      return step !== null && typeof step === "object" && Object.keys(step).length === 1 && step.stop === marker(branch);
    })
  );
}
