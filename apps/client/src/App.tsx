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

  // Global Ctrl+K / Cmd+K quick command palette shortcut
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
        <p>正在开启 KangXi.exe...</p>
      </div>
    );
  }

  const connected = Boolean(store.creds) || store.sandboxMode;

  return (
    <>
      {!connected ? (
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
