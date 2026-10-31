import { ENV } from '@/config/app';
import { THEME_LIST } from '@/config/themes';
import { FONT_FAMILIES, CURSOR_STYLES, useSettingsStore } from '@/store/settingsStore';

const control =
  'h-8 w-full rounded-lg border border-ws-border bg-ws-canvas px-2 text-[13px] text-ws-text outline-none focus:border-ws-accent';

function Field({ label, children, hint }) {
  return (
    <label className="block px-5 py-2">
      <span className="mb-1 block text-[13px] font-semibold text-ws-text">{label}</span>
      {hint && <span className="mb-1.5 block text-[12px] text-ws-muted">{hint}</span>}
      {children}
    </label>
  );
}

function Toggle({ label, settingKey, hint }) {
  const value = useSettingsStore((s) => s[settingKey]);
  const toggle = useSettingsStore((s) => s.toggle);
  return (
    <label className="flex cursor-pointer items-start gap-2 px-5 py-2">
      <input
        type="checkbox"
        checked={value}
        onChange={() => toggle(settingKey)}
        className="mt-0.5 accent-[#0078D4]"
      />
      <span>
        <span className="block text-[13px] text-ws-text">{label}</span>
        {hint && <span className="block text-[12px] text-ws-muted">{hint}</span>}
      </span>
    </label>
  );
}

export default function SettingsView() {
  const s = useSettingsStore();
  return (
    <div className="ws-scroll h-full overflow-y-auto pb-6">
      <h2 className="ws-section-title">Settings</h2>
      <Field label="Color Theme">
        <select
          className={control}
          value={s.themeId}
          onChange={(e) => s.setSetting('themeId', e.target.value)}
        >
          {THEME_LIST.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Font Family" hint="Cascadia Code and Fira Code both render the => ligature.">
        <select
          className={control}
          value={s.fontFamily}
          onChange={(e) => s.setSetting('fontFamily', e.target.value)}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Font Size">
        <input
          type="number"
          min={10}
          max={28}
          className={control}
          value={s.fontSize}
          onChange={(e) => s.setSetting('fontSize', e.target.value)}
        />
      </Field>
      <Field label="Tab Size">
        <select
          className={control}
          value={s.tabSize}
          onChange={(e) => s.setSetting('tabSize', e.target.value)}
        >
          {[2, 4, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cursor Style">
        <select
          className={control}
          value={s.cursorStyle}
          onChange={(e) => s.setSetting('cursorStyle', e.target.value)}
        >
          {CURSOR_STYLES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Toggle label="Minimap" settingKey="minimap" />
      <Toggle label="Font Ligatures" settingKey="ligatures" />
      <Toggle label="Word Wrap" settingKey="wordWrap" />
      {ENV.useMock && (
        <Toggle
          label="Simulated collaborators"
          settingKey="simulateCollaborators"
          hint="Mock mode: bots join, move their cursors, select and type in your open file."
        />
      )}
    </div>
  );
}
