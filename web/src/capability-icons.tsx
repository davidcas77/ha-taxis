import {
  Activity,
  AirVent,
  AppWindow,
  Blinds,
  DoorOpen,
  Droplet,
  Droplets,
  Fan,
  Lightbulb,
  Speaker,
  Sun,
  Thermometer,
  Tv,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { Capability } from "../../shared/inventory.ts";

// One icon per capability, for the headers of the matrices (Capabilities and
// Helpers coverage). The name goes in the tooltip, so the header stays short.
const ICONS: Record<Capability, LucideIcon> = {
  lights: Lightbulb,
  motion: Activity,
  presence: UserRound,
  door: DoorOpen,
  window: AppWindow,
  temperature: Thermometer,
  humidity: Droplets,
  illuminance: Sun,
  thermostat: AirVent,
  speaker: Speaker,
  tv: Tv,
  cover: Blinds,
  leak: Droplet,
  fan: Fan,
  power: Zap,
};

export function CapabilityIcon({ capability }: { capability: Capability }) {
  const Icon = ICONS[capability];
  return <Icon className="size-3.5 shrink-0" aria-hidden />;
}
