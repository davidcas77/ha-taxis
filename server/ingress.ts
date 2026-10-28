// Inside Home Assistant the app must only answer requests that arrive through
// Ingress, where Home Assistant has already authenticated the user. The
// Supervisor's Ingress proxy always connects from 172.30.32.2
// (https://developers.home-assistant.io/docs/add-ons/presentation#ingress).
// Anything else is refused, loopback included: nothing in the app image needs
// it (no HEALTHCHECK in the Dockerfile, no watchdog in config.yaml; the browser
// and mock scripts run the server in dev mode), and a process sharing the
// container network namespace could otherwise reach every route unauthenticated.

const INGRESS_PEER = "172.30.32.2";

export function normalizePeer(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function isAllowedPeer(address: string | undefined, mode: "app" | "dev"): boolean {
  if (mode === "dev") return true;
  const peer = normalizePeer(address);
  return peer === INGRESS_PEER;
}
