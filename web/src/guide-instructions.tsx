import { resolveSpaces } from "../../shared/spaces.ts";
import type { PathStepKey } from "../../shared/guide-path.ts";
import { useState } from "react";
import { House, Layers, Zap } from "lucide-react";
import { hasPendingChange, helperExclusions, planHelpers, type HelperRow } from "../../shared/helpers.ts";
import { CAPABILITIES, inventoryMatrix } from "../../shared/inventory.ts";
import { RECIPE_LABEL, type RecipeCell } from "../../shared/recipes.ts";
import type { Change, Hierarchy } from "../../shared/types.ts";
import { useTaxis, type Route } from "./state.tsx";
import { Button, Section, inputClass } from "./ui.tsx";

// The descriptions are deliberately examples, not another recipe planner. The
// actual plan and its missing inputs are rendered from the shared planner below.
export const RECIPE_EXAMPLES: Record<keyof typeof RECIPE_LABEL, string> = {
  occupancy: "A motion or presence sensor or an opted-in TV that starts occupancy; the recipe plans a hold timer, occupied sensor and pause switch.",
  motion_lights: "Occupancy and the room light group; day/night brightness and an override timer shape the behaviour.",
  media_off: "Occupancy and at least one included speaker or TV; turns media off after the room becomes empty.",
  area_climate: "A thermostat and comfort settings; a schedule is planned, while occupancy and window inputs can add behaviour.",
  bathroom_fan: "A humidity sensor, its humidity helper and a fan or switch marked as a fan.",
  exterior_lights: "An exterior area and its light group; included motion sensors and people can add motion and arrival behaviour.",
  left_open: "At least one included door or window; notification targets are optional and otherwise Home Assistant notifications are used.",
  appliance_done: "A power sensor marked as an appliance and valid running and idle thresholds.",
  leak_alert: "A leak sensor; notification targets and a water valve are optional.",
  covers_sun: "A cover and valid closing times; window and outdoor temperature inputs are optional.",
  house_presence: "At least one room with Occupancy and its occupied sensor; a usable away switch and group IDs are needed. People and guest mode add context.",
  battery_low: "A house pause switch is planned as needed. All HA battery sensors are checked; notification targets are optional.",
  unavailable_watch: "At least one included sensor used by the supported room recipes; notification targets are optional.",
  announce: "A text-to-speech entity and a speaker in a room with Occupancy.",
  goodbye: "The house light group and a usable away switch; speakers and TVs are included when available.",
};

export function GuideOverview({ go }: { go: (route: Route) => void }) {
  const [selected, setSelected] = useState<keyof typeof RECIPE_LABEL>("motion_lights");
  return (
    <Section title="How Taxis builds your home" description="Organise your rooms and choose what you want them to do.">
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { Icon: House, title: "Rooms", text: "Place your devices and sensors." },
          { Icon: Layers, title: "Helpers", text: "Bring related equipment together." },
          { Icon: Zap, title: "Automations", text: "Choose what happens and when." },
        ].map(({ Icon, title, text }) => (
          <div key={title} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
            <Icon className="size-4 shrink-0 text-accent" aria-hidden />
            <span>
              <strong>{title}</strong> · {text}
            </span>
          </div>
        ))}
      </div>
      <details className="rounded-lg border border-line bg-surface px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">Learn how it works</summary>
        <div className="mt-2 space-y-2 text-[13px]">
          <p>
            A blueprint is a reusable Home Assistant automation. A recipe selects its inputs for a room: Occupancy uses sensors and a timer; Motion lights can
            use that occupancy and the room's light group.
          </p>
          <p>
            A helper provides a stable room-level identity, such as one light group for several bulbs. Suitable existing helpers can be adopted; not every
            device needs one.
          </p>
          <p>
            Recipes and dependencies go to Changes for review. Apply and verify in Home Assistant; new automations can be active when installed, so try one at a
            time.
          </p>
        </div>
      </details>
      <details className="rounded-lg border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold">Explore recipe examples and their equipment</summary>
        <RecipeExample selected={selected} onSelect={setSelected} />
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

export function RecipeExample({ selected, onSelect }: { selected: keyof typeof RECIPE_LABEL; onSelect: (key: keyof typeof RECIPE_LABEL) => void }) {
  return (
    <div className="mt-3 max-w-xl">
      <label className="block text-xs font-medium" htmlFor="guide-recipe-example">
        Choose a recipe
      </label>
      <select
        id="guide-recipe-example"
        className={`${inputClass} mt-1 w-full`}
        value={selected}
        onChange={(event) => onSelect(event.target.value as keyof typeof RECIPE_LABEL)}
      >
        {Object.keys(RECIPE_EXAMPLES).map((key) => (
          <option key={key} value={key}>
            {RECIPE_LABEL[key as keyof typeof RECIPE_LABEL]}
          </option>
        ))}
      </select>
      <p className="mt-2 text-[13px]">
        <strong>{RECIPE_LABEL[selected]}:</strong> {RECIPE_EXAMPLES[selected]}
      </p>
    </div>
  );
}

export const INSTRUCTIONS: Partial<Record<PathStepKey, { paragraphs: string[]; links?: { label: string; route: Route }[] }>> = {
  areas: {
    paragraphs: [
      "Create physical floors and areas for your rooms. A Space is a logical Taxis grouping, not a native Home Assistant feature: Taxis uses native area labels such as Space: Office to record membership.",
      "In Floors → Space → area, a Space can contain several areas across floors; each area belongs to at most one Space. For example, Keli and Studio can be separate Spaces, while Coffee, Meeting and Work areas can belong to one Office Space.",
      "Review each Space's controls and recipes separately. The global light.all group is optional legacy support when using Spaces. Changing a Space label alone does not update existing automations; review their plans and changes.",
    ],
    links: [
      { label: "Review area codes", route: { page: "parameters", tab: "area-codes" } },
      { label: "Naming settings", route: { page: "settings", tab: "general" } },
    ],
  },
  entities: {
    paragraphs: [
      "Place devices and entities in their correct area. Entities inherit their device’s area unless assigned their own; review unassigned items and the equipment in each room.",
      "Correct placement lets Taxis find equipment for that room’s helpers and recipes. Not every entity needs to be used.",
    ],
  },
  naming: {
    paragraphs: [
      "Review area codes, device names and entity IDs so each room’s equipment is easy to identify. A matching count does not prove every name is correct.",
      "For example, with code kit and the default pattern, light.bulb_3 could become light.kit_light_counter and Bulb 3 could become Kitchen Counter. Review suggestions in the room’s Naming tab; edit device names in Organize → Devices.",
      "Entity ID changes can affect automations and other configuration. Review references and manual work in Changes; Taxis cannot rewrite every reference.",
    ],
    links: [{ label: "Open devices", route: { page: "organize", type: "devices", id: null } }],
  },
  capabilities: {
    paragraphs: [
      "Check which lights, sensors and other equipment Taxis detects in each area. Include the equipment you want to use and correct its role or exclusion.",
      "These choices feed helper and recipe planning. Only the gaps for the outcomes you want need attention.",
    ],
  },
  helpers: {
    paragraphs: [
      "Review the proposed area groups and their included members; create or adopt suitable helpers. Floor and whole-installation light groups are optional legacy uses when using Spaces; Space groups are planned in Recipes.",
      "A stable group such as light.kit_all can keep the same ID when its bulb membership changes. Review and apply the new membership so automations can continue targeting the group.",
      "Temperature, humidity and illuminance helpers can average sensors; media groups combine speakers and TVs. Recipes may also plan timers, occupied sensors and pause switches. Review their sources and dependencies before adding them.",
    ],
  },
  parameters: {
    paragraphs: [
      "Review the source shown for each value: parameters can inherit from installation, type, Space and area settings. Space control bindings do not inherit legacy House bindings.",
      "Keep the defaults or override settings where needed. For example, adjust a room’s brightness or hold timeout; climate comfort periods, temperatures and notifications have their own settings.",
    ],
  },
  recipes: {
    paragraphs: [
      "Choose the outcomes you want for each room or Space. The planner shows readiness, missing inputs, conflicts and dependencies; add ready recipes to Changes and review the proposed objects.",
      "Goodbye can target a chosen Space or the optional legacy all-areas scope, each with its own light group and mode bindings. Review presence and guest mode before using away behaviour, then test it.",
    ],
  },
  buttons: {
    paragraphs: [
      "After the room recipes work, review detected buttons and remotes. Assign the gestures you want, check existing automations for overlap, and test each action after applying changes.",
    ],
  },
  health: {
    paragraphs: [
      "Open Health and address errors first, then review warnings and notes. Recheck after applying changes and test the intended behaviour in Home Assistant.",
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
    <div className="mt-2 w-full text-[13px]">
      <h4 className="font-semibold">What to do and why</h4>
      <div className="mt-2 space-y-2 text-fg">
        {instruction.paragraphs.map((p, index) =>
          step === "areas" && index === 0 ? (
            <div key={p} className="rounded border border-accent/60 bg-accent/10 p-3">
              <strong>Spaces are a Taxis feature</strong>
              <p className="mt-1">
                {p}{" "}
                <a className="text-accent underline" href="https://www.home-assistant.io/docs/organizing/labels/" target="_blank" rel="noreferrer">
                  Home Assistant labels
                </a>
              </p>
            </div>
          ) : (
            <p key={p}>{p}</p>
          ),
        )}
        {step === "areas" && (
          <details className="rounded border border-line p-3">
            <summary className="cursor-pointer">Naming and group examples</summary>
            <p className="mt-2">
              Choose unique area codes under Parameters → Area codes. With code kit and the default pattern, light.bulb_3 might be suggested as
              light.kit_light_counter, with display name Kitchen Counter. The legacy light group may be light.kit_all; actual IDs follow your settings. Review
              suggestions and references before applying them.
            </p>
          </details>
        )}
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
                    .map((c) => `${c.label} ${area.perCapability[c.key].counted}/${area.perCapability[c.key].total} included`)
                    .join(", ") || "No detected equipment"}
                  .{" "}
                  {area.perCapability.motion.counted + area.perCapability.presence.counted === 0 &&
                    "No included motion or presence sensor. An opted-in included TV can also start Occupancy through qualifying interactions. "}
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
        {step === "recipes" && plan && (
          <>
            <p>Area readiness is shown below. Select a Space in Recipes to review its scoped plan; legacy all-areas goals are separate.</p>
            <RecipeReadiness cells={plan.area} />
          </>
        )}
        {step === "helpers" && inventoryLoaded && namingLoaded && (
          <HelperPlan
            rows={planHelpers(h, inventory, naming, changes).filter((row) => resolveSpaces(h, changes).length === 0 || row.level === "area")}
            changes={changes}
            plan={resolveSpaces(h, changes).length && plan ? { ...plan, house: [] } : plan}
          />
        )}
        {step === "recipes" && (
          <details className="rounded border border-line p-3">
            <summary className="cursor-pointer">Phone presence and arrival</summary>
            <p className="mt-2">
              Welcome is not a Taxis recipe. To create arrival behaviour yourself in Home Assistant, connect the Companion app's device tracker to a Person,
              review the Home zone and use a zone trigger. Enable location and background tracking, and check phone permissions and battery restrictions.
              Delayed, unknown or unavailable tracker states are not reliable evidence that someone has left. A visitor may be home without a tracked phone;
              review the guest mode guard and test presence before relying on it.
            </p>
            <p className="mt-2">
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
          </details>
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
    </div>
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
      <summary className="cursor-pointer">Current helper plan</summary>
      <p className="mt-2 text-muted">
        These are planner results, not changes already queued. A pending marker indicates an existing item in Changes. Open Helpers to review and add a
        proposal.
      </p>
      {groups.length === 0 && <p className="mt-2">No helpers can be planned from the currently included equipment.</p>}
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
