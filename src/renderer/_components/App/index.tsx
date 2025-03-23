import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./style.module.css";

// 型定義
type WindowInfo = {
  app: string;
  title: string;
  id: string;
  x: number;
  y: number;
};

type AppsByDisplay = {
  [displayId: number]: WindowInfo[];
};

type AppEventData = {
  appName: string;
  isLaunched: boolean;
};

// グローバル型拡張
declare global {
  interface Window {
    electronAPI: {
      forceRefreshApps: () => void;
      getAppsByDisplaySync: () => Promise<AppsByDisplay>;
      getAppsSync: () => Promise<string[]>;
      launchApp: (appName: string) => void;
      on: (
        channel: string,
        func: (...args: any[]) => void
      ) => (() => void) | undefined;
      onAppEvent: (
        callback: (data: AppEventData) => void
      ) => (() => void) | undefined;
      onAppsByDisplayUpdate: (
        callback: (data: AppsByDisplay) => void
      ) => (() => void) | undefined;
      onSetWindowId: (
        callback: (data: { displayId: number }) => void
      ) => (() => void) | undefined;
      removeAllListeners: (channel: string) => void;
      requestApps: () => void;
      send: (channel: string, data?: any) => void;
    };
  }
}

// 定数
const NORMAL_UPDATE_INTERVAL = 3000;
const ACTIVE_UPDATE_INTERVAL = 500;
const USER_ACTIVITY_TIMEOUT = 3000;
const INITIAL_LOAD_TIMEOUT = 2000;

const App: React.FC = () => {
  // ステート定義
  const [runningApps, setRunningApps] = useState<WindowInfo[]>([]);
  const [displayId, setDisplayId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [activeWindow, setActiveWindow] = useState<string | null>(null);

  // アプリイベントハンドラ
  const handleAppEvent = useCallback(
    (data: AppEventData) => {
      if (data.isLaunched) {
        const now = Date.now();
        if (now - lastUpdated > 1000) {
          window.electronAPI.forceRefreshApps();
          setLastUpdated(now);
        }
      }
    },
    [lastUpdated]
  );

  // ウィンドウクリックハンドラ
  const handleWindowClick = useCallback((windowInfo: WindowInfo) => {
    window.electronAPI?.send("activate-specific-window", {
      appName: windowInfo.app,
      windowTitle: windowInfo.title,
      windowId: windowInfo.id,
      x: windowInfo.x,
      y: windowInfo.y,
    });
    setActiveWindow(windowInfo.id);
  }, []);

  // ウィンドウID設定
  const handleWindowId = useCallback((data: { displayId: number }) => {
    setDisplayId(data.displayId);
  }, []);

  // アプリリスト更新
  const handleAppsByDisplayUpdate = useCallback(
    (appsByDisplay: AppsByDisplay) => {
      if (displayId === null) return;

      const newApps = appsByDisplay[displayId];
      if (!newApps) {
        setRunningApps([]);
        setIsLoading(false);
        return;
      }

      // Electronアプリを除外
      const filteredApps = newApps.filter(
        (window) => window.app !== "Electron"
      );

      setRunningApps(filteredApps);
      setIsLoading(false);
    },
    [displayId]
  );

  // 初期化処理
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      setIsLoading(false);
      return;
    }

    // リスナー登録
    const cleanup = [
      api.onSetWindowId(handleWindowId),
      api.onAppsByDisplayUpdate(handleAppsByDisplayUpdate),
      api.onAppEvent(handleAppEvent),
      api.on(
        "window-activated",
        (result: { windowId: string; success: boolean }) => {
          if (result.success) {
            setActiveWindow(result.windowId);
          }
        }
      ),
    ];

    // 監視開始
    api.send("start-app-monitoring");

    // ロード時の自動更新
    const loadingTimer = setTimeout(() => {
      if (isLoading) api.requestApps();
    }, INITIAL_LOAD_TIMEOUT);

    // クリーンアップ
    return () => {
      clearTimeout(loadingTimer);
      cleanup.forEach((removeListener) => removeListener?.());
    };
  }, [handleWindowId, handleAppsByDisplayUpdate, handleAppEvent, isLoading]);

  // displayId設定時のデータ取得
  useEffect(() => {
    if (displayId === null) return;

    (async () => {
      try {
        const allApps = await window.electronAPI.getAppsByDisplaySync();
        setRunningApps(allApps[displayId] || []);
      } catch (error) {
        console.error("初期アプリリスト取得エラー");
        setRunningApps([]);
      } finally {
        setIsLoading(false);
        window.electronAPI.requestApps();
      }
    })();
  }, [displayId]);

  // 定期更新処理
  useEffect(() => {
    if (displayId === null) return;

    let updateTimer: NodeJS.Timeout;
    let activityResetTimer: NodeJS.Timeout;
    let isUserActive = false;

    const checkForUpdates = () => window.electronAPI.requestApps();
    updateTimer = setInterval(checkForUpdates, NORMAL_UPDATE_INTERVAL);

    const handleActivity = () => {
      isUserActive = true;
      clearInterval(updateTimer);
      updateTimer = setInterval(checkForUpdates, ACTIVE_UPDATE_INTERVAL);

      if (activityResetTimer) clearTimeout(activityResetTimer);
      activityResetTimer = setTimeout(() => {
        isUserActive = false;
        clearInterval(updateTimer);
        updateTimer = setInterval(checkForUpdates, NORMAL_UPDATE_INTERVAL);
      }, USER_ACTIVITY_TIMEOUT);
    };

    window.addEventListener("mousemove", handleActivity);

    return () => {
      clearInterval(updateTimer);
      clearTimeout(activityResetTimer);
      window.removeEventListener("mousemove", handleActivity);
    };
  }, [displayId]);

  // ユーザー操作時の更新
  useEffect(() => {
    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastUpdated > USER_ACTIVITY_TIMEOUT) {
        window.electronAPI.requestApps();
        setLastUpdated(now);
      }
    };

    window.addEventListener("mouseup", handleUserActivity, { passive: true });
    return () => window.removeEventListener("mouseup", handleUserActivity);
  }, [lastUpdated]);

  // ウィンドウリストのレンダリング
  const windowItems = useMemo(() => {
    return runningApps.map((window) => (
      <div
        className={`${styles.appItem} ${
          activeWindow === window.id ? styles.active : ""
        }`}
        key={window.id}
        onClick={() => handleWindowClick(window)}
        role="button"
        tabIndex={0}
        title={`${window.title || window.app} (ID: ${window.id})`}
      >
        <div className={styles.textContent}>
          <div className={styles.appName}>{window.app}</div>
          {window.title && window.title !== window.app && (
            <div className={styles.appTitle}>{window.title}</div>
          )}
        </div>
      </div>
    ));
  }, [runningApps, handleWindowClick, activeWindow]);

  // ローディング表示
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.startButton} title="スタート"></div>
        <div className={styles.appList}>
          <div className={styles.loadingSpinner}></div>
        </div>
      </div>
    );
  }

  // メインレンダリング
  return (
    <div className={styles.container}>
      {/* スタートボタン */}
      <div className={styles.startButton} title="スタート"></div>
      {/* ウィンドウリスト */}
      <div className={styles.appList}>
        {runningApps.length > 0 ? (
          windowItems
        ) : (
          <div className={styles.noApps}>
            このディスプレイにはアプリが表示されていません
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
