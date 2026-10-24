# Taxis

Taxis shows your whole Home Assistant as one hierarchy: your home, its floors,
the areas on each floor, and every device and entity in them, grouped by what
they do (lights, motion, presence, climate, media, openings and more).

## Using it

Start the app and open **Taxis** from the sidebar. The first load reads your
floors, areas, devices, entities and labels from Home Assistant. Use
**Refresh** after you change something in Home Assistant.

This version only reads. It does not change anything in Home Assistant.

## Data and privacy

- Taxis talks only to your own Home Assistant, through the Supervisor.
- It needs no token and no account, and sends nothing to the internet.
- It keeps a snapshot of what it read in `/data/taxis.db` inside the app. Removing
  the app removes it.
