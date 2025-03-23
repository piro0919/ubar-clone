import { contextBridge, ipcRenderer } from "electron";

// 型定義
type WindowInfo = {
  app: string;
  title: string;
  id: string;
  x: number;
  y: number;
};

type AppsByDisplayData = { [displayId: number]: WindowInfo[] };

// 有効なチャンネル定義
const VALID_SEND_CHANNELS = [
  "get-running-apps",
  "start-app-monitoring",
  "stop-app-monitoring",
  "get-apps-by-display",
  "force-refresh-apps",
  "launch-app",
  "activate-specific-window",
] as const;

const VALID_RECEIVE_CHANNELS = [
  "running-apps",
  "apps-by-display",
  "app-launched",
  "set-window-id",
  "app-event",
  "window-activated",
] as const;

// 型定義
type SendChannels = (typeof VALID_SEND_CHANNELS)[number];
type ReceiveChannels = (typeof VALID_RECEIVE_CHANNELS)[number];

// チャンネルセット（高速検索用）
const SEND_CHANNEL_SET = new Set(VALID_SEND_CHANNELS);
const RECEIVE_CHANNEL_SET = new Set(VALID_RECEIVE_CHANNELS);

// チャンネル検証
const isValidSendChannel = (channel: string): channel is SendChannels =>
  SEND_CHANNEL_SET.has(channel as SendChannels);
const isValidReceiveChannel = (channel: string): channel is ReceiveChannels =>
  RECEIVE_CHANNEL_SET.has(channel as ReceiveChannels);

// リスナー追跡用（リソースリーク防止）
const listeners = new Map<string, ((...args: any[]) => void)[]>();

// レンダラープロセスに公開するAPI
contextBridge.exposeInMainWorld("electronAPI", {
  // 強制更新リクエスト
  forceRefreshApps: () => ipcRenderer.send("force-refresh-apps"),

  // 同期的にディスプレイ別アプリリストを取得
  getAppsByDisplaySync: async (): Promise<AppsByDisplayData> => {
    try {
      return await ipcRenderer.invoke("get-apps-by-display-sync");
    } catch {
      return {}; // エラー時は空オブジェクト
    }
  },

  // アプリリスト取得（同期）
  getAppsSync: async (): Promise<string[]> => {
    try {
      return await ipcRenderer.invoke("get-apps-sync");
    } catch {
      return []; // エラー時は空配列
    }
  },

  // ウィンドウタイトル一覧取得（デバッグ用）
  invoke: async (channel: string, ...args: any[]): Promise<any> => {
    if (channel === "get-all-window-titles") {
      return await ipcRenderer.invoke("get-all-window-titles");
    }
    throw new Error(`Invalid invoke channel: ${channel}`);
  },

  // アプリを起動または前面に表示
  launchApp: (appName: string): void => {
    // 入力検証
    if (typeof appName !== "string" || !appName.trim()) return;

    // 安全なアプリ名のみを許可
    const safeAppNameRegex = /^[a-zA-Z0-9\s._-]+$/;
    if (safeAppNameRegex.test(appName)) {
      ipcRenderer.send("launch-app", appName);
    }
  },

  // イベントリスナー登録
  on: (channel: string, func: (...args: any[]) => void) => {
    if (!isValidReceiveChannel(channel)) return undefined;

    const subscription = (_event: any, ...args: any[]) => func(...args);
    ipcRenderer.on(channel, subscription);

    // リスナー追跡に追加
    if (!listeners.has(channel)) {
      listeners.set(channel, []);
    }
    listeners.get(channel)?.push(subscription);

    // クリーンアップ関数
    return () => {
      ipcRenderer.removeListener(channel, subscription);
      const channelListeners = listeners.get(channel);
      if (channelListeners) {
        const index = channelListeners.indexOf(subscription);
        if (index !== -1) {
          channelListeners.splice(index, 1);
        }
      }
    };
  },

  // アプリ起動/終了イベントリスナー
  onAppEvent: (
    callback: (data: { appName: string; isLaunched: boolean }) => void
  ) => {
    const channel = "app-event";
    const subscription = (
      _event: any,
      data: { appName: string; isLaunched: boolean }
    ) => callback(data);

    ipcRenderer.on(channel, subscription);

    // リスナー追跡に追加
    if (!listeners.has(channel)) {
      listeners.set(channel, []);
    }
    listeners.get(channel)?.push(subscription);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
      const channelListeners = listeners.get(channel);
      if (channelListeners) {
        const index = channelListeners.indexOf(subscription);
        if (index !== -1) {
          channelListeners.splice(index, 1);
        }
      }
    };
  },

  // ディスプレイごとのアプリリスト更新リスナー
  onAppsByDisplayUpdate: (callback: (data: AppsByDisplayData) => void) => {
    const channel = "apps-by-display";
    const subscription = (_event: any, data: AppsByDisplayData) =>
      callback(data);

    ipcRenderer.on(channel, subscription);

    // リスナー追跡に追加
    if (!listeners.has(channel)) {
      listeners.set(channel, []);
    }
    listeners.get(channel)?.push(subscription);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
      const channelListeners = listeners.get(channel);
      if (channelListeners) {
        const index = channelListeners.indexOf(subscription);
        if (index !== -1) {
          channelListeners.splice(index, 1);
        }
      }
    };
  },

  // ウィンドウIDの受信用リスナー
  onSetWindowId: (callback: (data: { displayId: number }) => void) => {
    const subscription = (_event: any, data: { displayId: number }) =>
      callback(data);

    ipcRenderer.on("set-window-id", subscription);

    // リスナー追跡に追加
    if (!listeners.has("set-window-id")) {
      listeners.set("set-window-id", []);
    }
    listeners.get("set-window-id")?.push(subscription);

    return () => {
      ipcRenderer.removeListener("set-window-id", subscription);
      const windowIdListeners = listeners.get("set-window-id");
      if (windowIdListeners) {
        const index = windowIdListeners.indexOf(subscription);
        if (index !== -1) {
          windowIdListeners.splice(index, 1);
        }
      }
    };
  },

  // リスナーのクリーンアップ
  removeAllListeners: (channel: string) => {
    if (isValidReceiveChannel(channel)) {
      ipcRenderer.removeAllListeners(channel);
      listeners.delete(channel);
    }
  },

  // ディスプレイ別アプリリスト要求
  requestApps: () => ipcRenderer.send("get-apps-by-display"),

  // メッセージ送信
  send: (channel: string, data?: unknown) => {
    if (isValidSendChannel(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
});

// プロセス終了時の自動クリーンアップ
window.addEventListener("unload", () => {
  for (const [channel, channelListeners] of listeners.entries()) {
    for (const listener of channelListeners) {
      ipcRenderer.removeListener(channel, listener);
    }
  }
  listeners.clear();
});
