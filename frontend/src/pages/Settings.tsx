import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { buildAvatar } from "../crypto/avatar";
import { invalidateAvatar } from "../lib/avatars";
import {
  biometricsAvailable,
  disableLock,
  enableBiometric,
  lockMethod,
  setPin,
  type LockMethod,
} from "../lib/appLock";
import type { RecipientKey } from "../crypto/messaging";
import { getPrefs, setPref } from "../lib/prefs";
import { applyTheme } from "../lib/theme";
import {
  disablePush,
  enablePush,
  getPushState,
  isIOS,
  isStandalone,
  sendTestPush,
  type PushState,
} from "../lib/push";
import { clockTime } from "../lib/format";
import Avatar from "../components/Avatar";
import BackButton from "../components/BackButton";
import TwoFactorSetup from "../components/TwoFactorSetup";
import RecoveryKeySetup from "../components/RecoveryKeySetup";
import {
  attestPasskey,
  preloadPasskeyRegisterOptions,
  verifyPasskeyRegister,
  type PasskeyOptions,
} from "../lib/passkey";
import type { Device, User } from "../lib/types";

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const identity = useAuth((s) => s.identity);
  const currentDeviceId = useAuth((s) => s.deviceId);
  const logout = useAuth((s) => s.logout);
  const changePassword = useAuth((s) => s.changePassword);
  const deleteAccount = useAuth((s) => s.deleteAccount);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  // Change password
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  // Delete account
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const submitPasswordChange = async () => {
    setPwMsg(null);
    setPwBusy(true);
    try {
      await changePassword(curPw, newPw);
      setPwOpen(false);
      setCurPw("");
      setNewPw("");
      setPwMsg("Password changed.");
    } catch {
      setPwMsg("Couldn't change password — check your current password.");
    } finally {
      setPwBusy(false);
    }
  };

  const submitDelete = async () => {
    setDelErr(null);
    setDelBusy(true);
    try {
      await deleteAccount(delPw);
      navigate("/"); // store is now anon → the app routes to the login screen
    } catch {
      setDelErr("Couldn't delete account — check your password.");
      setDelBusy(false);
    }
  };
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarVer, setAvatarVer] = useState(0); // bump to re-render my avatar
  const [lock, setLock] = useState<LockMethod | null>(lockMethod());
  const [setup2fa, setSetup2fa] = useState(false);
  const [setupTotp, setSetupTotp] = useState(false);
  const [twofaStatus, setTwofaStatus] = useState<{
    totp_enabled: boolean;
    passkey_count: number;
  } | null>(null);
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);

  const loadTwofaStatus = () =>
    api<{ totp_enabled: boolean; passkey_count: number }>("/2fa/status")
      .then(setTwofaStatus)
      .catch(() => {});
  const [adminRequire2fa, setAdminRequire2fa] = useState(false);
  const [recoverySetup, setRecoverySetup] = useState(false);

  const removeRecovery = async () => {
    if (!confirm("Remove your recovery key? You won't be able to recover a lost password.")) return;
    await api("/recovery/setup", { method: "DELETE" }).catch(() => {});
    useAuth.setState({ user: { ...user, has_recovery: false } });
  };

  const disable2fa = async () => {
    if (!confirm("Turn off two-factor authentication (including passkeys)?")) return;
    await api("/2fa", { method: "DELETE" }).catch(() => {});
    useAuth.setState({ user: { ...user, twofa_enabled: false } });
    setRegenCodes(null);
  };

  const [pkRegOpts, setPkRegOpts] = useState<PasskeyOptions | null>(null);

  const addPasskey = async () => {
    if (!pkRegOpts) return;
    let credential: unknown;
    try {
      credential = await attestPasskey(pkRegOpts.options); // must be first await
    } catch {
      alert("Couldn't add a passkey. Your device may not support it, or it was cancelled.");
      return;
    }
    try {
      await verifyPasskeyRegister(pkRegOpts.challenge_token, credential, "Passkey");
      alert("Passkey added.");
    } catch {
      alert("Passkey registration failed.");
    } finally {
      // Refresh options for a possible next add, and the method count.
      preloadPasskeyRegisterOptions().then(setPkRegOpts).catch(() => {});
      void loadTwofaStatus();
    }
  };

  const regenBackup = async () => {
    try {
      const r = await api<{ codes: string[] }>("/2fa/backup/regenerate", { method: "POST" });
      setRegenCodes(r.codes);
    } catch {
      /* ignore */
    }
  };

  const toggleRequire2fa = async () => {
    const next = !adminRequire2fa;
    setAdminRequire2fa(next);
    await api("/config", {
      method: "PUT",
      body: JSON.stringify({ require_2fa: next }),
    }).catch(() => setAdminRequire2fa(!next));
  };

  const chooseLock = async (method: LockMethod | null) => {
    if (method === null) {
      disableLock();
      setLock(null);
      return;
    }
    if (method === "biometric") {
      const ok = await enableBiometric(user.username);
      if (ok) setLock("biometric");
      else alert("Couldn't enable Face ID. Your device may not support it, or it was cancelled.");
      return;
    }
    // PIN
    const pin = prompt("Set a 4–6 digit PIN")?.replace(/\D/g, "") ?? "";
    if (pin.length < 4 || pin.length > 6) {
      if (pin) alert("PIN must be 4–6 digits.");
      return;
    }
    if ((prompt("Re-enter your PIN to confirm")?.replace(/\D/g, "") ?? "") !== pin) {
      alert("PINs didn't match.");
      return;
    }
    await setPin(pin);
    setLock("pin");
  };

  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [saved, setSaved] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [prefs, setPrefsState] = useState(getPrefs());
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    api<Device[]>("/devices").then(setDevices).catch(() => {});
    getPushState().then(setPush).catch(() => {});
    if (user.is_admin) {
      api<{ require_2fa: boolean }>("/config")
        .then((c) => setAdminRequire2fa(c.require_2fa))
        .catch(() => {});
    }
    if (user.twofa_enabled) {
      preloadPasskeyRegisterOptions().then(setPkRegOpts).catch(() => {});
      void loadTwofaStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.is_admin, user.twofa_enabled]);

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (push?.subscribed) await disablePush();
      else await enablePush();
      setPush(await getPushState());
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Couldn't change notifications");
    } finally {
      setPushBusy(false);
    }
  };

  const testPush = async () => {
    setPushMsg(null);
    try {
      const r = await sendTestPush();
      setPushMsg(
        r.sent > 0
          ? `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"} — check your banner.`
          : "No devices received it. Try toggling notifications off and on."
      );
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Test failed");
    }
  };

  // The set of contacts who may view my photo: everyone I share a chat with.
  const gatherContacts = async (): Promise<RecipientKey[]> => {
    await useChat.getState().loadConversations().catch(() => {});
    const seen = new Set<string>();
    const out: RecipientKey[] = [];
    for (const c of useChat.getState().conversations) {
      for (const m of c.members) {
        if (m.id !== user.id && m.identity_public_key && !seen.has(m.id)) {
          seen.add(m.id);
          out.push({ userId: m.id, publicKeyB64: m.identity_public_key });
        }
      }
    }
    return out;
  };

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !identity || !user.identity_public_key || avatarBusy) return;
    setAvatarBusy(true);
    try {
      const contacts = await gatherContacts();
      const payload = await buildAvatar(
        file,
        identity.privateKey,
        user.identity_public_key,
        contacts
      );
      await api("/users/me/avatar", { method: "PUT", body: JSON.stringify(payload) });
      useAuth.setState({ user: { ...user, has_avatar: true } });
      invalidateAvatar(user.id);
      setAvatarVer((v) => v + 1);
    } catch {
      /* best-effort */
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    try {
      await api("/users/me/avatar", { method: "DELETE" });
      useAuth.setState({ user: { ...user, has_avatar: false } });
      invalidateAvatar(user.id);
      setAvatarVer((v) => v + 1);
    } catch {
      /* best-effort */
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveName = async () => {
    const updated = await api<User>("/users/me", {
      method: "PATCH",
      body: JSON.stringify({ display_name: displayName.trim() }),
    });
    useAuth.setState({ user: updated });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this device? It will be signed out.")) return;
    await api(`/devices/${id}`, { method: "DELETE" });
    setDevices((d) => d.filter((x) => x.id !== id));
  };

  const toggle = (key: keyof ReturnType<typeof getPrefs>) => {
    setPrefsState(setPref(key, !prefs[key]));
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <BackButton onClick={() => navigate("/")} />
        <span className="font-semibold">Settings</span>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-6 flex flex-col items-center">
          <button
            onClick={() => avatarFileRef.current?.click()}
            disabled={avatarBusy}
            className="relative rounded-full active:opacity-70 disabled:opacity-50"
            aria-label="Change photo"
          >
            <Avatar
              key={avatarVer}
              name={displayName || user.username}
              size={72}
              userId={user.id}
              hasAvatar={user.has_avatar}
            />
          </button>
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickAvatar}
          />
          <div className="mt-2 flex items-center gap-3 text-sm">
            <button
              className="text-imsg-blue disabled:opacity-50"
              disabled={avatarBusy}
              onClick={() => avatarFileRef.current?.click()}
            >
              {avatarBusy ? "Saving…" : user.has_avatar ? "Change Photo" : "Add Photo"}
            </button>
            {user.has_avatar && !avatarBusy && (
              <button className="text-red-500" onClick={() => void removeAvatar()}>
                Remove
              </button>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500">@{user.username}</div>
        </div>

        <Section title="Profile">
          <label className="block text-sm text-gray-500">Display name</label>
          <div className="mt-1 flex gap-2">
            <input
              className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[17px] outline-none focus:border-imsg-blue"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <button
              className="rounded-xl bg-imsg-blue px-4 text-white"
              onClick={saveName}
            >
              {saved ? "✓" : "Save"}
            </button>
          </div>
        </Section>

        <Section title="Appearance">
          <div className="flex items-center justify-between py-1">
            <span className="text-[15px]">Theme</span>
            <div className="flex gap-1">
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setPrefsState(setPref("theme", t));
                    applyTheme();
                  }}
                  className={`rounded-full border px-3 py-1 text-sm capitalize ${
                    prefs.theme === t
                      ? "border-imsg-blue bg-blue-50 text-imsg-blue"
                      : "border-gray-200 text-gray-600"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {user.is_admin && (
          <Section title="Administration">
            <button
              className="flex w-full items-center justify-between py-1 text-left text-[15px] text-imsg-blue"
              onClick={() => navigate("/admin")}
            >
              <span>Manage users</span>
              <span className="text-gray-300">›</span>
            </button>
            <Toggle
              label="Require two-factor for everyone"
              on={adminRequire2fa}
              onClick={() => void toggleRequire2fa()}
            />
            <p className="px-1 pt-1 text-xs text-gray-400">
              When on, every user must set up two-factor after their next sign-in.
            </p>
          </Section>
        )}

        <Section title="Privacy">
          <Toggle
            label="Send read receipts"
            on={prefs.readReceipts}
            onClick={() => toggle("readReceipts")}
          />
          <Toggle
            label="Send typing indicators"
            on={prefs.typingIndicators}
            onClick={() => toggle("typingIndicators")}
          />
        </Section>

        <Section title="App Lock">
          <div className="flex items-center justify-between py-1">
            <span className="text-[15px]">Lock</span>
            <div className="flex gap-1">
              {(
                [
                  { v: null, label: "Off" },
                  ...(biometricsAvailable()
                    ? [{ v: "biometric" as const, label: "Passkey" }]
                    : []),
                  { v: "pin" as const, label: "PIN" },
                ] as { v: LockMethod | null; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => void chooseLock(opt.v)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    lock === opt.v
                      ? "border-imsg-blue bg-blue-50 text-imsg-blue"
                      : "border-gray-200 text-gray-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <p className="px-1 pt-1 text-xs text-gray-400">
            Locks Kryptovox on launch and after it’s been in the background. PIN
            opens with a typed code; Passkey uses your device biometric or
            passkey app (e.g. your password manager).
          </p>
        </Section>

        <Section title="Two-Factor Authentication">
          {user.twofa_enabled ? (
            setupTotp ? (
              <TwoFactorSetup
                forceTotp
                onEnabled={() => {
                  setSetupTotp(false);
                  void loadTwofaStatus();
                }}
                onCancel={() => setSetupTotp(false)}
              />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between py-1">
                  <span className="text-[15px]">Two-factor</span>
                  <span className="text-sm font-medium text-green-600">On ✓</span>
                </div>
                {twofaStatus && (
                  <p className="text-xs text-gray-400">
                    {[
                      twofaStatus.totp_enabled ? "Authenticator" : null,
                      twofaStatus.passkey_count > 0
                        ? `${twofaStatus.passkey_count} passkey${twofaStatus.passkey_count === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {regenCodes && (
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-3 font-mono text-sm">
                    {regenCodes.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                )}
                {twofaStatus && !twofaStatus.totp_enabled && (
                  <button
                    className="block text-sm text-imsg-blue"
                    onClick={() => setSetupTotp(true)}
                  >
                    Add authenticator app
                  </button>
                )}
                <button className="block text-sm text-imsg-blue" onClick={() => void addPasskey()}>
                  Add a passkey
                </button>
                <button className="block text-sm text-imsg-blue" onClick={() => void regenBackup()}>
                  Show new backup codes
                </button>
                <button
                  className="block text-sm text-red-500"
                  onClick={() => void disable2fa()}
                >
                  Turn off two-factor
                </button>
              </div>
            )
          ) : setup2fa ? (
            <TwoFactorSetup
              onEnabled={() => {
                useAuth.setState({ user: { ...user, twofa_enabled: true } });
                setSetup2fa(false);
              }}
              onCancel={() => setSetup2fa(false)}
            />
          ) : (
            <button
              className="w-full rounded-xl border border-gray-200 py-2 text-imsg-blue"
              onClick={() => setSetup2fa(true)}
            >
              Set up two-factor
            </button>
          )}
        </Section>

        <Section title="Account Recovery">
          {recoverySetup ? (
            <RecoveryKeySetup
              onDone={() => setRecoverySetup(false)}
              onCancel={() => setRecoverySetup(false)}
            />
          ) : user.has_recovery ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1">
                <span className="text-[15px]">Recovery key</span>
                <span className="text-sm font-medium text-green-600">On ✓</span>
              </div>
              <button
                className="text-sm text-imsg-blue"
                onClick={() => setRecoverySetup(true)}
              >
                Replace recovery key
              </button>
              <button
                className="block text-sm text-red-500"
                onClick={() => void removeRecovery()}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              className="w-full rounded-xl border border-gray-200 py-2 text-imsg-blue"
              onClick={() => setRecoverySetup(true)}
            >
              Set up recovery key
            </button>
          )}
          <p className="px-1 pt-1 text-xs text-gray-400">
            Lets you reset your password and keep your message history if you’re ever
            locked out. Without it, a forgotten password can’t be recovered.
          </p>
        </Section>

        <Section title="Location">
          <div className="flex items-center justify-between py-1">
            <span className="text-[15px]">Open locations in</span>
            <div className="flex gap-1">
              {(["apple", "google"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPrefsState(setPref("mapsProvider", p))}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    prefs.mapsProvider === p
                      ? "border-imsg-blue bg-blue-50 text-imsg-blue"
                      : "border-gray-200 text-gray-600"
                  }`}
                >
                  {p === "apple" ? "Apple Maps" : "Google Maps"}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Notifications">
          {push && !push.supported && (
            <p className="text-sm text-gray-500">
              {isIOS() && !isStandalone()
                ? "Add Kryptovox to your Home Screen, then open it from there to turn on notifications."
                : "Notifications aren’t supported in this browser."}
            </p>
          )}
          {push?.supported && (
            <>
              <Toggle
                label="Push notifications"
                on={push.subscribed}
                onClick={() => void togglePush()}
              />
              {push.permission === "denied" && !push.subscribed && (
                <p className="mt-1 text-xs text-gray-400">
                  Notifications are blocked — enable them for Kryptovox in your
                  device settings, then toggle this on.
                </p>
              )}
              {push.subscribed && (
                <button
                  className="mt-2 text-sm text-imsg-blue"
                  onClick={() => void testPush()}
                >
                  Send test notification
                </button>
              )}
            </>
          )}
          {pushMsg && <p className="mt-2 text-xs text-gray-500">{pushMsg}</p>}
        </Section>

        <Section title="Linked devices">
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between border-b border-gray-50 py-2 last:border-0"
            >
              <div>
                <div className="text-[15px]">
                  {d.device_name || "Device"}
                  {d.id === currentDeviceId && (
                    <span className="ml-2 text-xs text-imsg-blue">This device</span>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  Added {new Date(d.created_at).toLocaleDateString()}
                  {d.last_seen && ` · last seen ${clockTime(d.last_seen)}`}
                </div>
              </div>
              {d.id !== currentDeviceId && (
                <button className="text-sm text-red-500" onClick={() => revoke(d.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </Section>

        <Section title="Password">
          {!pwOpen ? (
            <button
              className="text-sm text-imsg-blue"
              onClick={() => {
                setPwOpen(true);
                setPwMsg(null);
              }}
            >
              Change password
            </button>
          ) : (
            <div className="space-y-2">
              <input
                type="password"
                placeholder="Current password"
                autoComplete="current-password"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[15px] outline-none focus:border-imsg-blue"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
              />
              <input
                type="password"
                placeholder="New password (at least 8 characters)"
                autoComplete="new-password"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[15px] outline-none focus:border-imsg-blue"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <button
                  className="rounded-xl bg-imsg-blue px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={pwBusy || !curPw || newPw.length < 8}
                  onClick={() => void submitPasswordChange()}
                >
                  {pwBusy ? "…" : "Save"}
                </button>
                <button
                  className="text-sm text-gray-400"
                  onClick={() => {
                    setPwOpen(false);
                    setCurPw("");
                    setNewPw("");
                    setPwMsg(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {pwMsg && <p className="mt-2 text-xs text-gray-500">{pwMsg}</p>}
        </Section>

        <Section title="Danger zone">
          {!delOpen ? (
            <button
              className="text-sm text-red-500"
              onClick={() => {
                setDelOpen(true);
                setDelErr(null);
              }}
            >
              Delete account
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                Permanently deletes your account, devices, notes, and recovery key.
                Messages you’ve already sent stay in others’ chats. This can’t be undone.
              </p>
              <input
                type="password"
                placeholder="Confirm your password"
                autoComplete="current-password"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[15px] outline-none focus:border-imsg-blue"
                value={delPw}
                onChange={(e) => setDelPw(e.target.value)}
              />
              {delErr && <p className="text-xs text-red-500">{delErr}</p>}
              <div className="flex items-center gap-3">
                <button
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={delBusy || !delPw}
                  onClick={() => void submitDelete()}
                >
                  {delBusy ? "…" : "Delete my account"}
                </button>
                <button
                  className="text-sm text-gray-400"
                  onClick={() => {
                    setDelOpen(false);
                    setDelPw("");
                    setDelErr(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Section>

        <button
          className="mt-4 w-full rounded-xl border border-gray-200 py-3 text-red-500"
          onClick={() => logout()}
        >
          Sign out
        </button>

        <div className="mt-4 text-center text-xs text-gray-300">
          Build {__BUILD_ID__}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase text-gray-400">{title}</h2>
      <div className="rounded-2xl bg-white p-4 shadow-sm">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[15px]">{label}</span>
      <button
        onClick={onClick}
        aria-pressed={on}
        className={`flex h-7 w-12 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          on ? "justify-end" : "justify-start"
        }`}
        style={{ background: on ? "#34C759" : "#E9E9EB" }}
      >
        <span className="h-6 w-6 rounded-full shadow" style={{ background: "#fff" }} />
      </button>
    </div>
  );
}
