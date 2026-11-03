import { Hono } from "hono";
import type { ChangeInput, ApplyResponse } from "../../shared/types.ts";
import { sameValue } from "../../shared/changes.ts";
import { resolveSpaces, spaceIds } from "../../shared/spaces.ts";
import { areaThermostats, canonicalLightGroups } from "../../shared/recipes.ts";
import type { InventorySettings } from "../../shared/inventory.ts";
import type { ParameterSettings } from "../../shared/parameters.ts";
import { validateInventory, validateParameters } from "../settings.ts";
import { installedOf, readInstalled } from "../changes/recipes.ts";
import { settingEffects } from "../changes/direct-settings.ts";
import { enrichPreview, previewChanges, previewVersion, visiblePreview } from "../changes/direct-preview.ts";
import type { AppContext } from "../context.ts";
import { runLockedApply } from "./apply.ts";

export function directSettingsRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const { reader, settings, changes, db } = ctx;
  const revision = (path: string) =>
    String((db.prepare("SELECT revision FROM setting_revisions WHERE path = ?").get(path) as { revision: number } | undefined)?.revision ?? 0);
  app.on("POST", ["/direct-settings-preview", "/direct-settings"], async (c) => {
    const preview = c.req.path.endsWith("/direct-settings-preview");
    if (!ctx.ha || !ctx.rest || !ctx.target.ok) return c.json({ ok: false, error: ctx.notConfigured }, 503);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) => !["kind", "value", "revision", "settingsRevision", ...(preview ? [] : ["previewVersion", "allowWithoutBackup"])].includes(k),
      ) ||
      (body.kind !== "inventory" && body.kind !== "parameters") ||
      typeof body.revision !== "string" ||
      typeof body.settingsRevision !== "string" ||
      (!preview && typeof body.previewVersion !== "string") ||
      (body.allowWithoutBackup !== undefined && typeof body.allowWithoutBackup !== "boolean")
    )
      return c.json({ ok: false, error: "The setting change request wasn't readable." }, 400);
    const checked = body.kind === "inventory" ? validateInventory(body.value) : validateParameters(body.value);
    if (!checked.ok) return c.json({ ok: false, error: checked.error }, 400);
    const value = checked.value;
    const kind = body.kind;
    const settingPath = `/api/settings/${kind}`;
    const current = () =>
      !settings.general().reviewChangesBeforeApplying && revision("/api/settings/general") === body.settingsRevision && revision(settingPath) === body.revision;
    if (!reader.tryBeginApply()) return c.json({ ok: false, error: "Changes are being applied. Try again in a moment." }, 409);
    let handedOver = false;
    let saved: { kind: string; value: InventorySettings | ParameterSettings; revision: string } | null = null;
    try {
      if (!current()) return c.json({ ok: false, error: "The settings changed. Reload and review this change again." }, 409);
      if (changes.list().length) return c.json({ ok: false, error: "Review or discard pending changes before applying a direct setting change." }, 409);
      const before = { inventory: settings.inventory(), parameters: settings.parameters() };
      const after = { ...before, [kind]: value };
      const { read } = await reader.read(true);
      const installed = await readInstalled(
        { ha: ctx.ha, rest: ctx.rest },
        read.raw,
        canonicalLightGroups(read.live, settings.naming()),
        areaThermostats(read.live),
      );
      // A managed recipe that exists but has no readable config is not proof of
      // absence: don't silently promise that it cannot be affected.
      const unreadable = read.raw.states.find((state) => {
        const id = String((state.attributes as { id?: unknown } | undefined)?.id ?? "");
        return state.entity_id.startsWith("automation.") && id.startsWith("taxis_") && !installed.automations[id];
      });
      if (unreadable)
        return c.json({ ok: false, error: `A Taxis automation's stored configuration could not be read. Review it before changing this setting.` }, 409);
      const scriptIds = [
        "taxis_announce",
        "taxis_goodbye",
        ...resolveSpaces(read.live)
          .filter((space) => !space.id.startsWith("new:"))
          .flatMap((space) => {
            const ids = spaceIds(space.id);
            return [ids.announce, ids.goodbye];
          }),
      ];
      for (const id of scriptIds) {
        if (read.raw.states.some((state) => state.entity_id === `script.${id}`) && !installed.scripts[id])
          return c.json({ ok: false, error: `The stored configuration for ${id} could not be read. Review it before changing this setting.` }, 409);
      }
      const effects = settingEffects(read.live, settings.naming(), before, after, installed);
      if ("error" in effects) return c.json({ ok: false, error: effects.error }, 409);
      const configs = new Map<number, unknown>();
      for (const [index, input] of effects.inputs.entries()) {
        if ((input.kind === "automation" || input.kind === "script") && !input.fields?.button_map) {
          const id = String(input.kind === "automation" ? input.fields?.automation_id : input.fields?.script_id);
          const config = await ctx.rest.get(input.kind, id);
          const prior = input.kind === "automation" ? installed.automations[id] : installed.scripts[id];
          if (!config || !prior || !sameValue(installedOf(config), { alias: prior.alias, path: prior.path, input: prior.input }))
            return c.json({ ok: false, error: `${id} changed while its effects were being read. Review again.` }, 409);
          configs.set(index, config);
        }
      }
      if (!current() || changes.list().length) return c.json({ ok: false, error: "The settings or pending changes changed. Review again." }, 409);
      const scopeContext = { inventory: after.inventory, naming: settings.naming(), parameters: after.parameters, installed, transition: { before, after } };
      const planned = previewChanges(effects.inputs, read.live, configs, true, scopeContext);
      if ("error" in planned) return c.json({ ok: false, error: planned.error }, 409);
      const enriched = enrichPreview(planned.changes, read.raw);
      const localOnly = enriched.length === 0;
      const notes = [...effects.notes, ...(localOnly ? ["This changes Taxis settings only; no Home Assistant changes are planned."] : [])];
      const token = previewVersion(body.settingsRevision, enriched, { kind, revision: body.revision, before: before[kind], value, notes });
      if (preview)
        return c.json({
          ok: true,
          changes: enriched.map(visiblePreview),
          previewVersion: token,
          requiresNoBackupConfirmation: false,
          localOnly,
          notes,
        });
      if (body.previewVersion !== token)
        return c.json({ ok: false, error: "The setting or Home Assistant changes changed. Review them again before applying." }, 409);
      const refused = changes.addMany(
        effects.inputs as ChangeInput[],
        read.live,
        configs,
        () => {
          if (kind === "inventory") settings.saveInventory(value as InventorySettings);
          else settings.saveParameters(value as ParameterSettings);
          db.prepare("INSERT INTO setting_revisions(path, revision) VALUES (?, 1) ON CONFLICT(path) DO UPDATE SET revision = revision + 1").run(settingPath);
        },
        true,
        scopeContext,
      );
      if (refused) return c.json({ ok: false, error: `Change ${refused.index + 1}: ${refused.error} Nothing was saved.` }, 409);
      saved = { kind, value, revision: revision(settingPath) };
      if (localOnly) return c.json({ ok: true, saved, apply: null });
      handedOver = true;
      const result = await runLockedApply(ctx, c, changes.list(), { allowWithoutBackup: body.allowWithoutBackup === true });
      const apply = (await result.json()) as ApplyResponse;
      return c.json({ ok: true, saved, apply });
    } catch (e) {
      const error = ctx.errorText(e);
      return saved ? c.json({ ok: true, saved, apply: { ok: false, error } }) : c.json({ ok: false, error }, 502);
    } finally {
      if (!handedOver) reader.endApply();
    }
  });
  return app;
}
