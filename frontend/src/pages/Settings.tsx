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
import type { Device, User } from "../lib/types";

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const identity = useAuth((s) => s.identity);
  const currentDeviceId = useAuth((s) => s.deviceId);
  const logout = useAuth((s) => s.logout);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarVer, setAvatarVer] = useState(0); // bump to re-render my avatar
  const [lock, setLock] = useState<LockMethod | null>(lockMethod());

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
  }, []);

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
