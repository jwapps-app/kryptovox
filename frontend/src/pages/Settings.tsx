import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { getPrefs, setPref } from "../lib/prefs";
import { enablePush, pushPermission, pushSupported } from "../lib/push";
import { clockTime } from "../lib/format";
import Avatar from "../components/Avatar";
import type { Device, User } from "../lib/types";

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const currentDeviceId = useAuth((s) => s.deviceId);
  const logout = useAuth((s) => s.logout);

  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [saved, setSaved] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [prefs, setPrefsState] = useState(getPrefs());
  const [pushState, setPushState] = useState(pushPermission());
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const onEnablePush = async () => {
    setPushMsg("Requesting…");
    const r = await enablePush();
    setPushState(pushPermission());
    setPushMsg(r.ok ? "Subscribed ✓ — now send a test." : `Couldn't enable: ${r.error}`);
  };

  const onTestPush = async () => {
    setPushMsg("Sending…");
    try {
      const r = await api<{
        subscribed_devices: number;
        results: { ok: boolean; error?: string }[];
      }>("/push/test", { method: "POST" });
      if (r.subscribed_devices === 0) {
        setPushMsg("No subscribed devices on the server — tap Enable first (and on iOS, install to Home Screen).");
      } else {
        const fail = r.results.find((x) => !x.ok);
        setPushMsg(
          fail
            ? `Send failed: ${fail.error}`
            : `Sent to ${r.subscribed_devices} device(s) ✓ — check for the notification.`
        );
      }
    } catch (e) {
      setPushMsg((e as Error).message);
    }
  };

  useEffect(() => {
    api<Device[]>("/devices").then(setDevices).catch(() => {});
  }, []);

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
        <button className="text-2xl text-imsg-blue" onClick={() => navigate("/")}>
          ‹
        </button>
        <span className="font-semibold">Settings</span>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-6 flex flex-col items-center">
          <Avatar name={displayName || user.username} size={72} />
          <div className="mt-2 text-sm text-gray-500">@{user.username}</div>
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

        {pushSupported() ? (
          <Section title="Notifications">
            <div className="mb-2 text-sm text-gray-500">
              Permission: <span className="font-medium">{pushState}</span>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-xl bg-imsg-blue px-4 py-2 text-white"
                onClick={onEnablePush}
              >
                Enable
              </button>
              <button
                className="rounded-xl border border-gray-200 px-4 py-2"
                onClick={onTestPush}
              >
                Send test
              </button>
            </div>
            {pushMsg && <div className="mt-2 text-sm text-gray-600">{pushMsg}</div>}
          </Section>
        ) : (
          <Section title="Notifications">
            <div className="text-sm text-gray-500">
              Push isn't available here. On iPhone, add the app to your Home
              Screen and open it from there (iOS only supports push in installed
              web apps).
            </div>
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
        <span className="h-6 w-6 rounded-full bg-white shadow" />
      </button>
    </div>
  );
}
