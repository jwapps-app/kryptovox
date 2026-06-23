// Passkey (WebAuthn) ceremonies via @simplewebauthn/browser, paired with the
// backend's py_webauthn. The options come from the server already JSON-shaped.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api } from "./api";
import type { LoginResponse } from "./types";

interface OptionsOut {
  options: Record<string, unknown>;
  challenge_token: string;
}

// Enroll a passkey as a 2FA method. Returns any newly-issued backup codes.
export async function registerPasskey(name: string): Promise<string[]> {
  const { options, challenge_token } = await api<OptionsOut>(
    "/2fa/passkey/register/options",
    { method: "POST" }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const credential = await startRegistration({ optionsJSON: options as any });
  const r = await api<{ codes: string[] }>("/2fa/passkey/register/verify", {
    method: "POST",
    body: JSON.stringify({ challenge_token, credential, name }),
  });
  return r.codes;
}

// Complete a 2FA login with a passkey. Returns the LoginResponse (with tokens).
export async function loginWithPasskey(
  pendingToken: string,
  deviceName: string
): Promise<LoginResponse> {
  const { options, challenge_token } = await api<OptionsOut>(
    "/auth/2fa/passkey/options",
    { method: "POST", body: JSON.stringify({ pending_token: pendingToken }) }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const credential = await startAuthentication({ optionsJSON: options as any });
  return api<LoginResponse>("/auth/2fa/passkey/verify", {
    method: "POST",
    body: JSON.stringify({
      pending_token: pendingToken,
      challenge_token,
      credential,
      device_name: deviceName || null,
    }),
  });
}
