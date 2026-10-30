import type { PathStepKey } from "../../shared/guide-path.ts";
import { hasPendingChange, helperExclusions, planHelpers, type HelperRow } from "../../shared/helpers.ts";
import { CAPABILITIES, inventoryMatrix } from "../../shared/inventory.ts";
import { PARAM_DEF } from "../../shared/parameters.ts";
import { RECIPE_LABEL, type RecipeCell } from "../../shared/recipes.ts";
import type { Change, Hierarchy } from "../../shared/types.ts";
import { useTaxis, type Route } from "./state.tsx";
import { Button, Card, Section } from "./ui.tsx";

// The descriptions are deliberately examples, not another recipe planner. The
// actual plan and its missing inputs are rendered from the shared planner below.
export const RECIPE_EXAMPLES: Record<keyof typeof RECIPE_LABEL, string> = {
  occupancy: "A counted motion or presence sensor that starts occupancy; the recipe plans a hold timer, occupied sensor and pause switch.",
  motion_lights: "Occupancy and the room light group; day/night brightness and an override timer shape the behaviour.",
  media_off: "Occupancy and at least one counted speaker or TV; turns media off after the room becomes empty.",
  area_climate: "A counted thermostat and comfort settings; a schedule is planned, while occupancy and window inputs can add behaviour.",
  bathroom_fan: "A counted humidity sensor, its humidity helper and a counted fan or switch marked as a fan.",
  exterior_lights: "An exterior area and its light group; counted motion sensors and people can add motion and arrival behaviour.",
  left_open: "At least one counted door or window; notification targets are optional and otherwise Home Assistant notifications are used.",
  appliance_done: "A counted power sensor marked as an appliance and valid running and idle thresholds.",
  leak_alert: "A counted leak sensor; notification targets and a water valve are optional.",
  covers_sun: "A counted cover and valid closing times; window and outdoor temperature inputs are optional.",
  house_presence: "At least one room with Occupancy and its occupied sensor; a usable away switch and group IDs are needed. People and guest mode add context.",
  battery_low: "A house pause switch is planned as needed. All HA battery sensors are checked; notification targets are optional.",
  unavailable_watch: "At least one counted sensor used by the supported room recipes; notification targets are optional.",
  announce: "A text-to-speech entity and a counted speaker in a room with Occupancy.",
  goodbye: "The house light group and a usable away switch; counted speakers and TVs are included when available.",
};

export function GuideOverview({ go }: { go: (route: Route) => void }) {
  return (
    <Section title="How Taxis builds your home" description="Start with your rooms and equipment, then choose only the automations useful to you.">
      <Card>
        <p className="text-sm">
          Taxis organises native Home Assistant objects. A reusable blueprint describes an automation; a recipe selects its inputs and creates an automation for
          a particular room. For example, Occupancy uses that room's sensors and timer, and Motion lights can then use its occupancy and light group.
        </p>
        <p className="mt-2 text-sm">
          Canonical helpers give shared equipment a predictable room-level identity: a light group can represent a room's lights, or a group sensor can combine
          its motion sensors. Existing suitable helpers can be adopted. Not every device needs a helper, and what is needed depends on the recipe.
        </p>
        <p className="mt-2 text-sm">
          Recipes and their dependencies are proposed to Changes. Review the list, apply it and verify the result in Home Assistant. Applying can enable a new
          automation; try one at a time and turn it off in Home Assistant if needed.
        </p>
      </Card>
      <details className="rounded-lg border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold">Explore recipe examples and their equipment</summary>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(RECIPE_EXAMPLES).map(([key, description]) => (
            <li key={key} className="text-[13px]">
              <strong>{RECIPE_LABEL[key as keyof typeof RECIPE_LABEL]}.</strong> {description}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          These are examples, not a complete list of requirements. The Recipes planner checks your actual room, settings, dependencies and conflicts.
        </p>
        <Button className="mt-3" onClick={() => go({ page: "automations", tab: "recipes", controlId: null })}>
          Open recipes
        </Button>
      </details>
    </Section>
  );
}

export const INSTRUCTIONS: Partial<Record<PathStepKey, { paragraphs: string[]; links?: { label: string; route: Route }[] }>> = {
  areas: {
    paragraphs: [
      "Create floors and areas that match the house and put each room on its floor. Short, unique floor and area codes make groups and generated IDs recognisable; review them under Parameters → Area codes.",
      "For example, with the legacy default light suffix all, a Ground Floor code gf makes light.gf_all and Kitchen code kit makes light.kit_all. Search for kit_ to find the room's objects; predictable names make troubleshooting and replacement easier. Choose your own unique codes and review the configured suffix.",
      "Settings → General contains the naming patterns. The default entity ID pattern is {area}_{type}_{name}, for example light.kitchen_light_counter, and the default display name pattern is {Area} {Name}. Your configured codes and type words determine the actual suggestions.",
      "Example with code kit and the default pattern: light.bulb_3 → light.kit_light_counter and display name 'Bulb 3' → 'Kitchen Counter'. These are illustrations, not automatic renames; inspect each suggestion and its references.",
    ],
    links: [
      { label: "Review area codes", route: { page: "parameters", tab: "area-codes" } },
      { label: "Naming settings", route: { page: "settings", tab: "general" } },
    ],
  },
  entities: {
    paragraphs: [
      "Assign devices and entities to the right area. A device's area is inherited unless an entity has its own area. Check unassigned entities and the equipment in each room; not all entities need to be used by an automation.",
      "The room view and Capabilities show detected equipment and what is missing for an intended outcome. A sensor on a different floor or in another room may need its assignment reviewed before it can count.",
    ],
  },
  naming: {
    paragraphs: [
      "Review device names and entity IDs so you can identify what belongs to each room. Area naming suggestions cover supported entities; a matching count is not proof that every device or entity is correctly named.",
      "For example, light.bulb_3 could become light.kit_light_counter and 'Bulb 3' could become 'Kitchen Counter' using the default pattern and code kit. Open Organize → Devices to select and edit a device name; use the room's Naming tab to review entity suggestions.",
      "Renaming an entity ID can affect references in automations and other configuration. Review the listed uses and manual work in Changes before applying; Taxis cannot rewrite every possible reference.",
    ],
    links: [{ label: "Open devices", route: { page: "organize", type: "devices", id: null } }],
  },
  capabilities: {
    paragraphs: [
      "Review the equipment Taxis detects in each area, such as lights, motion, presence, openings, temperature, humidity, media, climate and power. Confirm what should count and correct any role or exclusion.",
      "Capabilities are inputs to helper and recipe planning, not a checklist of devices every room must own. The recipes you select determine which gaps matter.",
    ],
  },
  helpers: {
    paragraphs: [
      "Review the proposed room, floor and house groups. Adopt a suitable existing helper or queue a missing one; resolve naming conflicts and review group members. These groups provide stable room-level inputs when equipment changes.",
      "For example, a kitchen light group can keep its ID light.kit_all while you replace one old bulb in its member list with a new bulb. Automations can keep targeting that group; review and apply the updated membership. The actual suffix follows your naming settings.",
      "Temperature, humidity and illuminance helpers can average counted sensors so recipes use one room-level value; media groups can bring counted speakers and TVs together. Review the actual sources and helper configuration before creating or adopting them.",
      "Recipes can also plan runtime helpers: occupancy uses a hold timer and occupied sensor, lighting can use an override timer, and recipes use pause switches. House modes include away, sleep and guest where needed. Day/night times and brightness are parameters, not a promised day/night helper. Check each recipe's dependencies before adding it.",
    ],
  },
  parameters: {
    paragraphs: [
      "Parameters inherit from the house to interior or exterior and then to an individual area; the nearest chosen value wins, otherwise Taxis uses its default. Some are house-only or area-only. Review the source shown in the table before overriding a value.",
      `For example, night starts at ${PARAM_DEF.night_start.default} and ends at ${PARAM_DEF.night_end.default} by default; day brightness is ${PARAM_DEF.day_brightness.default}%, night brightness ${PARAM_DEF.night_brightness.default}%, and hold timeout ${PARAM_DEF.hold_timeout.default} minutes. Override a room's brightness or timeout when it needs different behaviour. Climate comfort periods, temperatures and notifications have their own settings.`,
    ],
  },
  recipes: {
    paragraphs: [
      "Select only recipes that fit each room. The planner shows ready, installed, out-of-date and missing inputs, including conflicts and dependencies. Add a ready recipe to Changes and review its proposed blueprint, helpers and automation.",
      "Goodbye is a house script that can turn off the house light group and counted media and set away mode. Welcome is not a Taxis recipe: if you want arrival behaviour, configure an existing or new Home Assistant automation yourself, for example using a zone and a person tracked by the mobile app. Check presence accuracy and test it before relying on it.",
      "For phone presence, enable location and background tracking in the Home Assistant Companion app, connect its device_tracker to a Person, and review the Home zone. A Home Assistant zone trigger can react when that person enters or leaves. A tracker that is unknown or unavailable is not reliable evidence that someone has left. Phone permissions, battery restrictions and delayed updates affect accuracy.",
      "A visitor may be home without a tracked phone. Use a suitable guest mode guard and review the House presence notes before enabling away behaviour; the planner warns when no guest switch is in place. For a welcome example, create your own Home Assistant automation triggered by a person entering Home, with conditions and actions you choose. Taxis does not create this welcome automation.",
    ],
  },
};

export function StepInstruction({
  step,
  h,
  plan,
  go,
}: {
  step: PathStepKey;
  h: Hierarchy;
  plan: { area: RecipeCell[]; house: RecipeCell[] } | null;
  go: (route: Route) => void;
}) {
  const { inventory, naming, changes, inventoryLoaded, namingLoaded } = useTaxis();
  const instruction = INSTRUCTIONS[step];
  if (!instruction) return null;
  return (
    <details className="mt-2 w-full text-[13px]">
      <summary className="cursor-pointer text-accent">What to do and why</summary>
      <div className="mt-2 space-y-2 text-fg">
        {instruction.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {step === "entities" && inventoryLoaded && namingLoaded && (
          <details className="rounded border border-line p-3">
            <summary className="cursor-pointer">Equipment by area</summary>
            <ul className="mt-2 space-y-2">
              {inventoryMatrix(h, inventory, helperExclusions(h, naming)).map((area) => (
                <li key={area.areaId}>
                  <button
                    className="text-accent hover:underline"
                    onClick={() => go({ page: "areas", sel: { kind: "area", id: area.areaId }, tab: "capabilities" })}
                  >
                    {area.name}
                  </button>
                  :{" "}
                  {CAPABILITIES.filter((c) => area.perCapability[c.key].total > 0)
                    .map((c) => `${c.label} ${area.perCapability[c.key].counted}/${area.perCapability[c.key].total} counted`)
                    .join(", ") || "No detected equipment"}
                  .{" "}
                  {area.perCapability.motion.counted + area.perCapability.presence.counted === 0 &&
                    "No counted motion or presence sensor: Occupancy cannot start, so motion-controlled lights need a suitable sensor first. "}
                  {plan &&
                    plan.area
                      .filter((cell) => cell.areaId === area.areaId && cell.status === "missing" && cell.missing.length > 0)
                      .map((cell) => (
                        <span key={cell.recipe} className="block pl-3 text-muted">
                          {RECIPE_LABEL[cell.recipe]}: {cell.missing.join("; ")}
                        </span>
                      ))}
                </li>
              ))}
            </ul>
          </details>
        )}
        {step === "recipes" && plan && <RecipeReadiness cells={[...plan.area, ...plan.house]} />}
        {step === "helpers" && inventoryLoaded && namingLoaded && (
          <HelperPlan rows={planHelpers(h, inventory, naming, changes)} changes={changes} plan={plan} />
        )}
        {step === "recipes" && (
          <p>
            Home Assistant documentation:{" "}
            <a className="text-accent underline" href="https://companion.home-assistant.io/docs/core/location/" target="_blank" rel="noreferrer">
              Companion app location
            </a>
            ,{" "}
            <a className="text-accent underline" href="https://www.home-assistant.io/integrations/person/" target="_blank" rel="noreferrer">
              Person and zone triggers
            </a>
            , and{" "}
            <a className="text-accent underline" href="https://www.home-assistant.io/integrations/device_tracker/" target="_blank" rel="noreferrer">
              device tracker states
            </a>
            .
          </p>
        )}
        {instruction.links && (
          <div className="flex flex-wrap gap-2">
            {instruction.links.map((link) => (
              <Button key={link.label} onClick={() => go(link.route)}>
                {link.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function runtimeHelperInputs(cells: readonly RecipeCell[]) {
  return cells
    .filter((cell) => cell.actionable)
    .flatMap((cell) =>
      cell.inputs
        .filter((input) => input.kind === "helper")
        .map((input) => ({
          area: cell.areaName,
          recipe: RECIPE_LABEL[cell.recipe],
          operation: input.op,
          id: String(input.fields?.entity_id ?? input.targetId ?? ""),
          sources: Array.isArray(input.fields?.entities) ? input.fields.entities.filter((s): s is string => typeof s === "string") : [],
        }))
        .filter((input) => input.id),
    );
}

function HelperPlan({ rows, changes, plan }: { rows: HelperRow[]; changes: Change[]; plan: { area: RecipeCell[]; house: RecipeCell[] } | null }) {
  const groups = [...new Set(rows.map((row) => `${row.level}:${row.areaId ?? row.floorId ?? "house"}`))];
  const runtime = plan ? runtimeHelperInputs([...plan.area, ...plan.house]) : [];
  return (
    <details className="rounded border border-line p-3">
      <summary className="cursor-pointer">Current helper plan by area, floor and house</summary>
      <p className="mt-2 text-muted">
        These are planner results, not changes already queued. A pending marker indicates an existing item in Changes. Open Helpers to review and add a
        proposal.
      </p>
      {groups.length === 0 && <p className="mt-2">No helpers can be planned from the currently counted equipment.</p>}
      {groups.map((group) => {
        const items = rows.filter((row) => `${row.level}:${row.areaId ?? row.floorId ?? "house"}` === group);
        return (
          <div key={group} className="mt-3">
            <h4 className="font-semibold">
              {items[0].areaName} ({items[0].level})
            </h4>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {items.map((row) => (
                <li key={row.canonicalId}>
                  <code>{row.canonicalId}</code> — {row.status}
                  {hasPendingChange(row, changes) ? "; in Changes" : ""}
                  {row.adoptFrom ? `; adopt ${row.adoptFrom}` : ""}
                  {row.heldBy ? `; held by ${row.heldBy}` : ""}
                  {row.membersUnknown ? "; existing members cannot be read" : ""}. Sources: {row.sources.join(", ") || "none"}.
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <h4 className="mt-3 font-semibold">Runtime helpers from actionable recipe plans</h4>
      <p className="text-muted">
        These are included only if you add the named recipe; blocked and already queued recipes may not show inputs here. See Recipes for their blockers.
      </p>
      {!plan ? (
        <p>Waiting for recipe status.</p>
      ) : runtime.length === 0 ? (
        <p>There are no runtime helper inputs in the currently actionable plans.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {runtime.map((input, i) => (
            <li key={`${input.area}:${input.recipe}:${input.id}:${i}`}>
              {input.area} · {input.recipe}: {input.operation} <code>{input.id}</code>
              {input.sources.length ? `; sources: ${input.sources.join(", ")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function RecipeReadiness({ cells }: { cells: RecipeCell[] }) {
  const ready = cells.filter((cell) => cell.actionable);
  const blocked = cells.filter((cell) => cell.status === "missing" && cell.missing.length);
  return (
    <details className="rounded border border-line p-3">
      <summary className="cursor-pointer">
        Current planner: {ready.length} ready to add or update, {blocked.length} with missing inputs
      </summary>
      {ready.length > 0 && <p className="mt-2">Ready: {ready.map((cell) => `${cell.areaName}: ${RECIPE_LABEL[cell.recipe]}`).join("; ")}</p>}
      {blocked.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {blocked.map((cell) => (
            <li key={`${cell.areaId}:${cell.recipe}`}>
              <strong>
                {cell.areaName}: {RECIPE_LABEL[cell.recipe]}
              </strong>{" "}
              — {cell.missing.join("; ")}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
