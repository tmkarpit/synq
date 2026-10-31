import { useCallback, useEffect, useRef, useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '@/store/settingsStore';
import { useRoomStore } from '@/store/roomStore';
import { canEdit } from '@/services/collab';
import { openLive } from '@/features/room/liveActions';
import { requestRun } from '@/features/run/runActions';
import { saveRoom } from '@/features/room/saveActions';
import { useRoom } from '@/features/room/RoomContext';
import Spinner from '@/components/ui/Spinner';
import { loadMonaco } from './monaco/setupMonaco';
import { EditorController } from './EditorController';
import './remote-cursors.css';

const SETTING_KEYS = [
  'themeId',
  'fontSize',
  'fontFamily',
  'tabSize',
  'wordWrap',
  'minimap',
  'ligatures',
  'cursorStyle',
];
const pickSettings = (s) => Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]]));

/** Collaborative Monaco editor (Monaco + Shiki load lazily on first mount). */
export default function CodeEditor() {
  const { service, feed } = useRoom();
  const containerRef = useRef(null);
  const controllerRef = useRef(null);
  const [monaco, setMonaco] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const activeFileId = useRoomStore((s) => s.activeFileId);
  const readOnly = useRoomStore((s) => !canEdit(s.self));
  const hasFiles = useRoomStore((s) => Object.values(s.nodes).some((n) => n.type === 'file'));
  const settings = useSettingsStore(useShallow(pickSettings));

  useEffect(() => {
    let alive = true;
    loadMonaco().then(
      (m) => alive && setMonaco(m),
      (err) => {
        console.error('[synq] editor failed to load', err);
        if (alive) setLoadError('The editor failed to load. Check your connection and reload.');
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(() => requestRun({ service, feed }), [service, feed]);

  useEffect(() => {
    if (!monaco || !containerRef.current) return undefined;
    const controller = new EditorController({
      monaco,
      container: containerRef.current,
      service,
      settings: pickSettings(useSettingsStore.getState()),
      readOnly: !canEdit(useRoomStore.getState().self),
      onRun: run,
      onSave: () => saveRoom({ service }),
      onOpenFile: (fileId) => useRoomStore.getState().openFile(fileId),
      onGoLive: (fileId) => openLive(service, fileId),
    });
    controllerRef.current = controller;
    controller.setFile(useRoomStore.getState().activeFileId);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [monaco, service, run]);

  useEffect(() => {
    controllerRef.current?.setFile(activeFileId);
  }, [activeFileId, monaco]);

  const nodes = useRoomStore((s) => s.nodes);
  useEffect(() => {
    controllerRef.current?.syncLanguages(nodes);
  }, [nodes, monaco]);

  useEffect(() => {
    controllerRef.current?.updateSettings(settings);
  }, [settings]);

  useEffect(() => {
    controllerRef.current?.setReadOnly(readOnly);
  }, [readOnly, monaco]);

  return (
    <div className="relative h-full w-full bg-ws-editor">
      <div ref={containerRef} className="absolute inset-0" />
      {!monaco && !loadError && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-ws-muted"
          role="status"
        >
          <Spinner size={14} /> Loading editor...
        </div>
      )}
      {loadError && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-[#F14C4C]">
          {loadError}
        </p>
      )}
      {monaco && !activeFileId && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ws-editor text-center">
          <FileCode2 size={40} className="text-ws-muted" aria-hidden />
          <p className="text-sm">No file open</p>
          <p className="text-xs text-ws-muted">
            {hasFiles
              ? 'Select a file in the Explorer to start editing.'
              : 'Create a file in the Explorer to start coding.'}
          </p>
        </div>
      )}
    </div>
  );
}
