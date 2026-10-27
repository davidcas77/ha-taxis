// Links that used to open the Devices page or the Entities page now open the same
// section of Organize (with its list or its table, whichever the viewer chose),
// and an area's Devices or Entities tab is the one Devices & entities tab.
// Bookmarks keep working: the old hash is turned into the new one, before it is
// read and in the address bar. Anything else is returned as it came.
//
//   #devices, #devices/<id>      #organize/devices, #organize/devices/<id>
//   #entities, #entities/<id>    #organize/entities, #organize/entities/<id>
//   #area/<id>/devices           #area/<id>/devices-entities
//   #area/<id>/entities          #area/<id>/devices-entities

export const DEVICES_ENTITIES = "devices-entities";

export function normalizeLegacyHash(hash: string): string {
  const parts = hash.replace(/^#/, "").split("/");
  const [head, a, b] = parts;
  if (head === "parameters" && a === "recipes") return "#recipes";
  if ((head === "devices" || head === "entities" || head === DEVICES_ENTITIES) && parts.length <= 2) {
    const section = head === "entities" ? "entities" : "devices";
    return a ? `#organize/${section}/${a}` : `#organize/${section}`;
  }
  if (head === "area" && parts.length === 3 && (b === "devices" || b === "entities")) return `#area/${a}/${DEVICES_ENTITIES}`;
  return hash;
}
