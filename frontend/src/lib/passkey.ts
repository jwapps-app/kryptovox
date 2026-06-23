// Passkey (WebAuthn) ceremonies via @simplewebauthn/browser, paired with the
// backend's py_webauthn.
//
// iOS Safari is strict about "transient user activation": the WebAuthn call
// (start*Authentication/Registration) must run immediately on the user's tap,
// with NO awaited network request in between — otherwise it fails with
// NotAllowedError. So options are FETCHED AHEAD (preload*Options) and the
// gesture handler only does the WebAuthn call + the verify afterwards.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Options = any;
import { api } from "./api";
import type { LoginResponse } from "./types";

export interface PasskeyOptions {
  options: Options;
  challenge_token: string;
}

// ---- Login (assertion) ----
export function preloadPasskeyLoginOptions(pendingToken: string): Promise<PasskeyOptions> {
  return api<PasskeyOptions>("/auth/2fa/passkey/options", {
    method: "POST",
    body: JSON.stringify({ pending_token: pendingToken }),
  });
}

// MUST be called directly in the tap handler (no awaits before it).
export function assertPasskey(options: Options) {
  return startAuthentication({ optionsJSON: options });
}

export function verifyPasskeyLogin(
  pendingToken: string,
  challengeToken: string,
  credential: unknown,
  deviceName: string
): Promise<LoginResponse> {
  return api<LoginResponse>("/auth/2fa/passkey/verify", {
    method: "POST",
    body: JSON.stringify({
      pending_token: pendingToken,
      challenge_token: challengeToken,
      credential,
      device_name: deviceName || null,
    }),
  });
}

// ---- Enrollment (attestation) ----
export function preloadPasskeyRegisterOptions(): Promise<PasskeyOptions> {
  return api<PasskeyOptions>("/2fa/passkey/register/options", { method: "POST" });
}

// MUST be called directly in the tap handler.
export function attestPasskey(options: Options) {
  return startRegistration({ optionsJSON: options });
}

export async function verifyPasskeyRegister(
  challengeToken: string,
  credential: unknown,
  name: string
): Promise<string[]> {
  const r = await api<{ codes: string[] }>("/2fa/passkey/register/verify", {
    method: "POST",
    body: JSON.stringify({ challenge_token: challengeToken, credential, name }),
  });
  return r.codes;
}
