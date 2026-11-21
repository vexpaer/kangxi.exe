import { useEffect, useState } from "react";
import {
  CommandPalette,
  ConnectionGate,
  NewTaskModal,
} from "./components/ModalsAndPanels";
import { useKangXiStore } from "./state/useKangXiStore";
import { ImperialWorkbench } from "./themes/imperial/ImperialWorkbench";
import { ModernWorkbench } from "./themes/modern/ModernWorkbench";

export function App() {
  const store = useKangXiStore();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (store.loadingCreds) {
    return (
      <div className="boot-screen">
        <div className="gate-seal">御</div>
        <p>正在探测本机 Agent 环境并自动导入历史会话...</p>
      </div>
    );
  }

  // Desktop boots straight into Local-First mode (workspaceMode === "local") without any backend gate!
  // Only mobile/unconnected devices show ConnectionGate as the entry screen.
  const ready = store.workspaceMode !== "unconnected";

  return (
    <>
      {!ready ? (
        <ConnectionGate store={store} />
      ) : store.prefs.themeMode === "imperial" ? (
        <ImperialWorkbench
          store={store}
          onOpenNewTask={() => setNewTaskOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
      ) : (
        <ModernWorkbench
          store={store}
          onOpenNewTask={() => setNewTaskOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
      )}

      {store.remoteModalOpen && (
        <ConnectionGate
          store={store}
          asModal
          onClose={() => store.setRemoteModalOpen(false)}
        />
      )}

      {newTaskOpen && (
        <NewTaskModal store={store} onClose={() => setNewTaskOpen(false)} />
      )}
      {paletteOpen && (
        <CommandPalette
          store={store}
          onClose={() => setPaletteOpen(false)}
          onNewTask={() => setNewTaskOpen(true)}
        />
      )}

      {store.toast && (
        <div
          key={store.toast.id}
          className={`toast-banner tone-${store.toast.tone}`}
          role="status"
        >
          {store.toast.text}
        </div>
      )}
    </>
  );
}

export default App;
