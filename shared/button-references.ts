export type ButtonReferenceInput = {
  button: string;
  press: string;
  action: { kind: "service"; service: string; target?: { id: string; name: string } } | { kind: "custom"; description: string };
};

export type ButtonReference = ButtonReferenceInput & { id: string; revision: number };

export type ButtonReferencesResponse = { ok: true; references: ButtonReference[] } | { ok: false; error: string };

export const BUTTON_REFERENCE_LIMITS = { button: 80, press: 80, service: 100, targetId: 240, targetName: 120, description: 500 } as const;
