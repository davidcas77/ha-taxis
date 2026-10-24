// The Supervisor's own API, used for one thing: a backup of Home Assistant's
// configuration before Taxis applies changes.
// https://developers.home-assistant.io/docs/api/supervisor/endpoints#backup
//
// Needs `hassio_api: true` and `hassio_role: backup` in taxis/config.yaml.

export type BackupResult = { ok: true; name: string; slug: string | null } | { ok: false; reason: string };

export async function backupHomeAssistant(
  token: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10 * 60_000,
): Promise<BackupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // A partial backup of Home Assistant's configuration (its .storage
    // registries are what Taxis changes). Add-ons, media and the history
    // database are left out, so it stays small and quick.
    const res = await fetchImpl("http://supervisor/backups/new/partial", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, homeassistant: true, homeassistant_exclude_database: true, addons: [], folders: [] }),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: string; message?: string; data?: { slug?: string } };
    if (!res.ok || body.result !== "ok") {
      return { ok: false, reason: `The Supervisor didn't make the backup (HTTP ${res.status}${body.message ? `: ${body.message}` : ""}).` };
    }
    return { ok: true, name, slug: body.data?.slug ?? null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, reason: aborted ? "The backup took longer than 10 minutes." : `Couldn't reach the Supervisor: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
