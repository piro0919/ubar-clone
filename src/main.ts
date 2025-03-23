import { exec, execSync, spawn } from "child_process";
import {
  app,
  BrowserWindow,
  type Display,
  ipcMain,
  screen,
  nativeImage,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import activeWin from "active-win";

// 定数
const isDev = process.env.NODE_ENV === "development";
const SCRIPT_CACHE_TTL = 10000; // 10秒
const APP_CACHE_DURATION = 5000; // 5秒

// 型定義
interface WindowInfo {
  app: string;
  title: string;
  id: string;
  x: number;
  y: number;
}

// グローバル変数
let dockWindows: BrowserWindow[] = [];
let previousRunningApps: string[] = [];
let previousPositions: { [windowId: string]: { displayId: number } } = {};
let isMonitoring = false;
let debounceTimers: { [key: string]: NodeJS.Timeout } = {};

// スクリプトキャッシュ
const scriptCache: { [key: string]: { result: any; timestamp: number } } = {};

// アプリケーションキャッシュ
const appCache = {
  clear(): void {
    this.data = null;
    this.timestamp = 0;
  },
  data: null as any,
  duration: APP_CACHE_DURATION,
  get(): any | null {
    return this.isValid() ? this.data : null;
  },
  isValid(): boolean {
    return this.data && Date.now() - this.timestamp < this.duration;
  },
  set(data: any): void {
    this.data = data;
    this.timestamp = Date.now();
  },
  timestamp: 0,
};

// ElectronのGPUプロセスの設定
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
app.commandLine.appendSwitch("disable-frame-rate-limit");
app.commandLine.appendSwitch("disable-gpu-vsync");

/**
 * デバウンス関数 - 連続呼び出しを防止
 */
function debounce(key: string, fn: Function, delay: number = 300): void {
  if (debounceTimers[key]) {
    clearTimeout(debounceTimers[key]);
  }

  debounceTimers[key] = setTimeout(() => {
    fn();
    delete debounceTimers[key];
  }, delay);
}

/**
 * エラーハンドラー
 */
function handleError(
  operation: string,
  error: Error,
  fallback: any = null
): any {
  console.error(`${operation}エラー:`, error);
  return fallback;
}

/**
 * イベントからウィンドウIDを取得
 */
function getWindowIdFromEvent(event: Electron.IpcMainEvent): number {
  for (let i = 0; i < dockWindows.length; i++) {
    if (dockWindows[i].webContents === event.sender) {
      return i;
    }
  }
  return -1;
}

/**
 * リソース解放
 */
function cleanupResources() {
  // タイマーのクリーンアップ
  Object.values(debounceTimers).forEach(clearTimeout);
  debounceTimers = {};

  // キャッシュのクリア
  appCache.clear();
  Object.keys(scriptCache).forEach((key) => delete scriptCache[key]);

  // 状態のリセット
  previousRunningApps = [];
  previousPositions = {};
  isMonitoring = false;
}

/**
 * AppleScriptの実行を最適化
 */
async function executeAppleScript(
  script: string,
  cacheKey?: string
): Promise<string> {
  // キャッシュ対象のスクリプトでキャッシュが有効な場合は再利用
  if (
    cacheKey &&
    scriptCache[cacheKey] &&
    Date.now() - scriptCache[cacheKey].timestamp < SCRIPT_CACHE_TTL
  ) {
    return scriptCache[cacheKey].result;
  }

  // 一時ディレクトリを一度だけ作成
  const scriptDir = path.join(app.getPath("temp"), "app_scripts");
  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(scriptDir, { recursive: true });
  }

  const scriptId = Date.now().toString(36);
  const scriptPath = path.join(scriptDir, `script_${scriptId}.scpt`);

  return new Promise((resolve, reject) => {
    // スクリプトファイルを書き込む
    fs.writeFile(scriptPath, script, (err) => {
      if (err) {
        reject(err);
        return;
      }

      // スクリプトを実行
      const process = spawn("osascript", [scriptPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => (stdout += data));
      process.stderr.on("data", (data) => (stderr += data));

      process.on("close", (code) => {
        // ファイル削除を非同期に変更
        fs.unlink(scriptPath, () => {});

        if (code !== 0) {
          reject(new Error(`AppleScript実行エラー: ${stderr}`));
          return;
        }

        // 結果をキャッシュに保存
        if (cacheKey) {
          scriptCache[cacheKey] = {
            result: stdout.trim(),
            timestamp: Date.now(),
          };
        }

        resolve(stdout.trim());
      });

      process.on("error", (err) => {
        fs.unlink(scriptPath, () => {});
        reject(err);
      });
    });
  });
}

/**
 * アプリ名のバリデーション
 */
function isValidAppName(appName: string): boolean {
  if (!appName || typeof appName !== "string") return false;
  const validAppNameRegex = /^[a-zA-Z0-9\s._-]+$/;
  return validAppNameRegex.test(appName) && appName.length < 256;
}

/**
 * 実行中アプリの取得
 */
async function getRunningAppsNative(): Promise<string[]> {
  const cacheKey = "running_apps";

  const script = `
  tell application "System Events"
    set jsonOutput to "["
    set allApps to application processes whose background only is false

    repeat with appProcess in allApps
      set appName to name of appProcess

      if appName does not start with "." and appName does not contain "Helper" and appName is not "Electron" then
        set jsonOutput to jsonOutput & "\\""& appName & "\\","
      end if
    end repeat

    if length of jsonOutput > 1 then
      set jsonOutput to text 1 thru -2 of jsonOutput
    end if

    return jsonOutput & "]"
  end tell
  `;

  try {
    const result = await executeAppleScript(script, cacheKey);
    const apps = JSON.parse(result) as string[];

    return apps.filter(
      (app) => typeof app === "string" && app.length > 1 && !app.startsWith(".")
    );
  } catch (error) {
    return handleError("アプリリスト取得", error as Error, []);
  }
}

/**
 * ディスプレイ情報を取得
 */
function getDisplaysInfo(): {
  [id: number]: { height: number; width: number; x: number; y: number };
} {
  const displaysInfo: {
    [id: number]: { height: number; width: number; x: number; y: number };
  } = {};

  screen.getAllDisplays().forEach((display, index) => {
    displaysInfo[index] = {
      height: display.bounds.height,
      width: display.bounds.width,
      x: display.bounds.x,
      y: display.bounds.y,
    };
  });

  return displaysInfo;
}

/**
 * ウィンドウ位置取得の最適化版
 */
async function getWindowsOnDisplays(): Promise<{
  [displayId: number]: WindowInfo[];
}> {
  // キャッシュをチェック
  const cached = appCache.get();
  if (cached) return cached;

  // 戻り値の初期化
  const displayApps: { [displayId: number]: WindowInfo[] } = {};
  const displays = screen.getAllDisplays();

  displays.forEach((_, index) => {
    displayApps[index] = [];
  });

  // ディスプレイ情報を取得
  const displaysInfo = getDisplaysInfo();

  // AppleScriptを実行
  const script = `
  tell application "System Events"
    set jsonOutput to "["
    set allApps to application processes whose background only is false

    repeat with appProcess in allApps
      set appName to name of appProcess

      if appName is not "Electron" and visible of appProcess then
        try
          set allWindows to windows of appProcess
          set windowIndex to 0

          repeat with appWindow in allWindows
            if exists appWindow then
              set windowIndex to windowIndex + 1

              try
                set winTitle to name of appWindow
              on error
                set winTitle to appName & " Window " & windowIndex
              end try

              set winPos to position of appWindow
              set winSize to size of appWindow

              set centerX to (item 1 of winPos) + ((item 1 of winSize) / 2)
              set centerY to (item 2 of winPos) + ((item 2 of winSize) / 2)

              set uniqueId to appName & "-" & windowIndex
              set jsonOutput to jsonOutput & "{\\"app\\":\\"" & appName & "\\",\\"title\\":\\"" & winTitle & "\\",\\"id\\":\\"" & uniqueId & "\\",\\"x\\":" & centerX & ",\\"y\\":" & centerY & "},"
            end if
          end repeat
        end try
      end if
    end repeat
  end tell

  if length of jsonOutput > 1 then
    set jsonOutput to text 1 thru -2 of jsonOutput
  end if

  return jsonOutput & "]"
  `;

  try {
    const result = await executeAppleScript(script, "window_positions");
    const windowsData = JSON.parse(result) as WindowInfo[];

    // 各ウィンドウが属するディスプレイを特定
    windowsData.forEach((window: WindowInfo) => {
      // 各ディスプレイをチェック
      for (const [displayId, display] of Object.entries(displaysInfo)) {
        // ウィンドウの中心がこのディスプレイ内にあるか確認
        if (
          window.x >= display.x &&
          window.x < display.x + display.width &&
          window.y >= display.y &&
          window.y < display.y + display.height
        ) {
          // このウィンドウをこのディスプレイに追加
          const id = parseInt(displayId);
          if (!displayApps[id]) displayApps[id] = [];
          displayApps[id].push(window);
          break;
        }
      }
    });

    // キャッシュに保存
    appCache.set(displayApps);
    return displayApps;
  } catch (error) {
    return handleError("JSONパース", error as Error, displayApps);
  }
}

/**
 * ディスプレイごとのアプリリスト取得
 */
async function getAppsByDisplayNative() {
  // キャッシュチェック
  const cached = appCache.get();
  if (cached) return cached;

  try {
    // 新しいデータを取得
    const result = await getWindowsOnDisplays();
    return result;
  } catch (error) {
    // エラー時はフォールバック
    const displays = screen.getAllDisplays();
    const fallback: { [key: number]: WindowInfo[] } = {};

    displays.forEach((_, index) => {
      fallback[index] = [];
    });

    return handleError("アプリリスト取得", error as Error, fallback);
  }
}

/**
 * ウィンドウ位置の比較用にコンバート
 */
function convertWindowPositions(newPos: {
  [displayId: number]: WindowInfo[];
}): { [windowId: string]: { displayId: number } } {
  const result: { [windowId: string]: { displayId: number } } = {};

  for (const [displayId, windows] of Object.entries(newPos)) {
    const dispId = parseInt(displayId);
    for (const window of windows) {
      result[window.id] = { displayId: dispId };
    }
  }

  return result;
}

/**
 * アプリリスト変更の検出
 */
function hasAppsChanged(oldApps: string[], newApps: string[]): boolean {
  if (oldApps.length !== newApps.length) return true;

  const oldSet = new Set(oldApps);
  const newSet = new Set(newApps);

  // セットの差分を検出
  for (const app of newSet) {
    if (!oldSet.has(app)) return true;
  }

  for (const app of oldSet) {
    if (!newSet.has(app)) return true;
  }

  return false;
}

/**
 * ウィンドウ位置変更の検出
 */
function hasWindowPositionsChanged(
  oldPos: { [windowId: string]: { displayId: number } },
  newPos: { [displayId: number]: WindowInfo[] }
): boolean {
  // 新しい形式から比較用の形式に変換
  const convertedNewPos = convertWindowPositions(newPos);

  // 追加または移動されたウィンドウの検出
  for (const [windowId, pos] of Object.entries(convertedNewPos)) {
    if (!oldPos[windowId] || oldPos[windowId].displayId !== pos.displayId) {
      return true;
    }
  }

  // 削除されたウィンドウの検出
  for (const windowId in oldPos) {
    if (!convertedNewPos[windowId]) {
      return true;
    }
  }

  return false;
}

/**
 * すべてのウィンドウにデータを送信
 */
function broadcastToAllWindows(channel: string, data: any) {
  for (const win of dockWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

/**
 * メイン監視関数
 */
async function checkAllUpdates() {
  try {
    // 現在の実行中アプリとウィンドウ位置を一度の呼び出しで取得
    const [currentApps, windowPositions] = await Promise.all([
      getRunningAppsNative(),
      getWindowsOnDisplays(),
    ]);

    // 変更を検出
    const appsChanged = hasAppsChanged(previousRunningApps, currentApps);
    const windowsChanged = hasWindowPositionsChanged(
      previousPositions,
      windowPositions
    );

    // 変更があった場合のみブロードキャスト
    if (appsChanged || windowsChanged) {
      if (isDev) {
        console.log("===== ディスプレイごとのアプリリスト更新 =====");
        Object.entries(windowPositions).forEach(([displayId, windows]) => {
          console.log(
            `ディスプレイ ${displayId}: ${windows.map((w) => w.app).join(", ")}`
          );
        });
        console.log("=======================================");
      }

      broadcastToAllWindows("apps-by-display", windowPositions);

      // 保存しておく最新の状態を更新
      previousRunningApps = [...currentApps];
      previousPositions = convertWindowPositions(windowPositions);
    }
  } catch (error) {
    handleError("監視処理", error as Error);
  }
}

/**
 * モニタリング開始
 */
function startNativeMonitoring() {
  if (isMonitoring) return;

  // 既存のタイマーをクリア
  Object.values(debounceTimers).forEach(clearTimeout);
  debounceTimers = {};

  // 監視状態を設定
  isMonitoring = true;

  // 初回実行
  checkAllUpdates();

  // 単一のインターバルで更新
  const monitorKey = "primary-monitor";
  debounceTimers[monitorKey] = setInterval(() => {
    checkAllUpdates();
  }, 5000); // 5秒間隔
}

/**
 * 各ディスプレイにドックウィンドウを作成
 */
function createDockWindows() {
  dockWindows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
  dockWindows = [];

  const displays = screen.getAllDisplays();
  displays.forEach((display, index) => {
    createDockWindowForDisplay(display, index);
  });
}

/**
 * 特定のディスプレイ用のドックウィンドウを作成
 */
function createDockWindowForDisplay(display: Display, index: number) {
  const { height: displayHeight, width: displayWidth } = display.bounds;
  const dockHeight = 30;
  const dockWindow = new BrowserWindow({
    alwaysOnTop: true,
    frame: false,
    height: dockHeight,
    resizable: false,
    roundedCorners: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      backgroundThrottling: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      spellcheck: false,
    },
    width: displayWidth,
    x: display.bounds.x,
    y: display.bounds.y + displayHeight - dockHeight,
  });

  // イベントハンドラの最適化
  dockWindow.webContents.on("did-finish-load", () => {
    dockWindow.webContents.send("set-window-id", { displayId: index });

    // 必要なデータのみ送信するように最適化
    getAppsByDisplayNative().then((appsByDisplay) => {
      if (appsByDisplay[index]) {
        dockWindow.webContents.send("apps-by-display", {
          [index]: appsByDisplay[index],
        });
      }
    });
  });

  dockWindow.webContents.on("crashed", () => {
    debounce(
      `recreate-window-${index}`,
      () => {
        createDockWindowForDisplay(display, index);
      },
      500
    );
  });

  dockWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "index.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  // 開発環境のみDevToolsを開く
  if (isDev && index === 0) {
    dockWindow.webContents.openDevTools({ mode: "detach" });
  }

  dockWindow.on("closed", () => {
    const windowIndex = dockWindows.indexOf(dockWindow);
    if (windowIndex !== -1) {
      dockWindows.splice(windowIndex, 1);
    }
  });

  dockWindows.push(dockWindow);
}

/**
 * ディスプレイ構成の変更検出
 */
function setupDisplayChangeDetection() {
  // 既存のリスナーがあれば削除
  screen.removeAllListeners("display-added");
  screen.removeAllListeners("display-removed");
  screen.removeAllListeners("display-metrics-changed");

  // 単一のハンドラーにまとめる
  const handleDisplayChange = () => {
    debounce(
      "display-change",
      () => {
        createDockWindows();
        // キャッシュをクリア
        appCache.clear();
        checkAllUpdates();
      },
      1000
    );
  };

  // イベントリスナーを設定
  screen.on("display-added", handleDisplayChange);
  screen.on("display-removed", handleDisplayChange);
  screen.on("display-metrics-changed", handleDisplayChange);
}

/**
 * 特定ウィンドウをアクティブ化（最小化対応版）
 */
async function activateSpecificWindow(
  appName: string,
  windowTitle: string,
  windowId: string
): Promise<boolean> {
  if (!isValidAppName(appName) || typeof windowTitle !== "string") {
    console.error("無効なウィンドウ情報:", { appName, windowTitle, windowId });
    return false;
  }

  const sanitizedAppName = appName.replace(/"/g, '\\"');
  // ID部分を抽出（タイトル内の一意の識別子として使用）
  const windowIndex = windowId.split("-").pop();

  // 最小化ウィンドウにも対応した改良版スクリプト
  const script = `
  tell application "${sanitizedAppName}"
    activate
  end tell

  tell application "System Events"
    set targetApp to application process "${sanitizedAppName}"
    if exists targetApp then
      set targetWindow to {}

      -- ウィンドウをウィンドウIDの数値部分に基づいて選択
      if ${windowIndex} is a number then
        try
          set allWindows to windows of targetApp
          if ${windowIndex} <= count of allWindows then
            set targetWindow to item ${windowIndex} of allWindows
          end if
        end try
      end if

      -- インデックスが失敗した場合、タイトルでバックアップ
      if targetWindow is {} then
        set allWindows to windows of targetApp
        repeat with i from 1 to count of allWindows
          set theWindow to item i of allWindows
          try
            if name of theWindow contains "${windowTitle.replace(
              /"/g,
              '\\"'
            )}" then
              set targetWindow to theWindow
              exit repeat
            end if
          on error
            -- 名前取得できない場合はスキップ
          end try
        end repeat
      end if

      -- ウィンドウが見つかった場合の処理
      if targetWindow is not {} then
        -- 最小化されていたら復元
        try
          if value of attribute "AXMinimized" of targetWindow is true then
            set value of attribute "AXMinimized" of targetWindow to false
          end if
        on error
          -- 最小化属性がなければスキップ
        end try

        -- ウィンドウを前面に
        tell targetApp
          set frontmost to true
        end tell

        -- ウィンドウをアクティブに
        tell targetWindow
          try
            perform action "AXRaise"
          on error
            -- Raiseできない場合はフォーカスを試みる
            set focused to true
          end try
        end tell

        return "SUCCESS: Window activated"
      else
        -- アプリのみアクティブ化
        return "WARNING: App activated but specific window not found"
      end if
    else
      return "WARNING: App not found in System Events"
    end if
  end tell
  `;

  try {
    const result = await executeAppleScript(script);
    if (isDev) console.log("ウィンドウアクティベーション結果:", result);
    return true;
  } catch (error) {
    console.error("ウィンドウアクティベーションエラー:", error);

    // フォールバック: 単純に起動
    try {
      await executeAppleScript(
        `tell application "${sanitizedAppName}"\nactivate\nend tell`
      );
      if (isDev) console.log("フォールバックアクティベーション成功");
      return true;
    } catch (fallbackError) {
      console.error("フォールバックアクティベーションエラー:", fallbackError);
      return false;
    }
  }
}

/**
 * ウィンドウID指定でフォーカス
 */
async function focusWindowById(windowId: number): Promise<boolean> {
  try {
    // macOSのコマンドラインツールを使用して直接ウィンドウIDを指定してフォーカス
    const script = `
    tell application "System Events"
      set frontWindow to first window whose id is ${windowId}
      set frontmost of frontWindow to true
      set frontmost of process of frontWindow to true
    end tell
    `;

    execSync(`osascript -e '${script}'`);
    return true;
  } catch (error) {
    console.error("ウィンドウID指定のフォーカス失敗:", error);
    return false;
  }
}

/**
 * IPCハンドラーのセットアップ
 */
function setupIPCHandlers() {
  // 監視開始リクエスト
  ipcMain.on("start-app-monitoring", (event) => {
    const windowId = getWindowIdFromEvent(event);
    event.reply("set-window-id", { displayId: windowId });

    if (!isMonitoring) {
      startNativeMonitoring();
    } else {
      debounce("ipc-refresh", checkAllUpdates, 200);
    }
  });

  // 強制更新リクエスト
  ipcMain.on("force-refresh-apps", () => {
    appCache.clear();
    debounce("force-refresh", checkAllUpdates, 100);
  });

  // アプリリスト要求
  ipcMain.on("get-apps-by-display", (event) => {
    const windowId = getWindowIdFromEvent(event);
    event.reply("set-window-id", { displayId: windowId });
    debounce("get-apps", checkAllUpdates, 200);
  });

  // 同期的な取得
  ipcMain.handle("get-apps-by-display-sync", async () => {
    try {
      return await getAppsByDisplayNative();
    } catch (error) {
      return handleError("アプリリスト同期取得", error as Error, {});
    }
  });

  // ウィンドウタイトル一覧を取得するIPCハンドラー
  ipcMain.handle("get-all-window-titles", async () => {
    return await getAllWindowTitles();
  });

  // キャッシュクリア
  ipcMain.on("clear-app-cache", () => {
    appCache.clear();
    debounce("clear-cache", checkAllUpdates, 200);
  });

  // アプリ起動処理
  ipcMain.on("launch-app", (_, appName: string) => {
    if (!isValidAppName(appName)) {
      console.error("無効なアプリ名:", appName);
      return;
    }

    const sanitizedAppName = appName.replace(/"/g, '\\"');
    const script = `tell application "${sanitizedAppName}"\nactivate\nend tell`;

    // スクリプト実行
    executeAppleScript(script)
      .then(() => {
        debounce("app-launch", checkAllUpdates, 1000);
      })
      .catch((error) => {
        handleError("アプリ起動", error as Error);
      });
  });

  // 特定のウィンドウをアクティブ化
  ipcMain.on(
    "activate-specific-window",
    async (
      event,
      data: {
        appName: string;
        windowTitle: string;
        windowId: string;
      }
    ) => {
      if (!isValidAppName(data.appName)) {
        console.error("無効なアプリ名:", data.appName);
        event.sender.send("window-activated", {
          windowId: data.windowId,
          success: false,
        });
        return;
      }

      try {
        // すべての開いているウィンドウを取得
        const windows = await activeWin.getOpenWindows();
        let targetWindow = null;

        // アプリ名とタイトルで目的のウィンドウを検索
        for (const win of windows) {
          if (
            win.owner.name === data.appName &&
            win.title.includes(data.windowTitle)
          ) {
            targetWindow = win;
            break;
          }
        }

        if (targetWindow) {
          // ウィンドウIDを使って直接アクティブ化
          const success = await focusWindowById(targetWindow.id);

          event.sender.send("window-activated", {
            windowId: data.windowId,
            success,
          });

          // ウィンドウリストを更新
          debounce("window-activate", checkAllUpdates, 500);
        } else {
          // 目的のウィンドウが見つからない場合、通常の起動に戻る
          const sanitizedAppName = data.appName.replace(/"/g, '\\"');
          await executeAppleScript(
            `tell application "${sanitizedAppName}" to activate`
          );

          event.sender.send("window-activated", {
            windowId: data.windowId,
            success: true,
          });

          debounce("window-activate", checkAllUpdates, 500);
        }
      } catch (error) {
        console.error("ウィンドウ特定エラー:", error);

        // エラー時はフォールバックとして通常の起動を試みる
        try {
          const sanitizedAppName = data.appName.replace(/"/g, '\\"');
          await executeAppleScript(
            `tell application "${sanitizedAppName}" to activate`
          );

          event.sender.send("window-activated", {
            windowId: data.windowId,
            success: true,
          });
        } catch (fallbackErr) {
          console.error("フォールバック起動エラー:", fallbackErr);
          event.sender.send("window-activated", {
            windowId: data.windowId,
            success: false,
          });
        }
      }
    }
  );
}

/**
 * 現在のウィンドウタイトル一覧を取得する関数（デバッグ用）
 */
async function getAllWindowTitles(): Promise<string> {
  const script = `
  tell application "System Events"
    set titleList to ""
    set allProcesses to application processes whose background only is false

    repeat with appProcess in allProcesses
      set appName to name of appProcess
      if appName is not "Electron" then
        set titleList to titleList & appName & ":" & linefeed

        try
          set appWindows to windows of appProcess
          repeat with i from 1 to count of appWindows
            set winTitle to name of item i of appWindows
            set titleList to titleList & "  [" & i & "] " & winTitle & linefeed
          end repeat
        end try

        set titleList to titleList & linefeed
      end if
    end repeat

    return titleList
  end tell
  `;

  try {
    return await executeAppleScript(script);
  } catch (error) {
    console.error("ウィンドウタイトル取得エラー:", error);
    return "取得エラー";
  }
}

/**
 * アプリケーションのライフサイクル処理
 */
app.on("ready", () => {
  // 順番に初期化
  setupIPCHandlers();
  setupDisplayChangeDetection();

  // UI表示
  createDockWindows();

  // 監視開始
  setTimeout(() => {
    startNativeMonitoring();
  }, 500);
});

// アプリのライフサイクルイベント処理
app.on("window-all-closed", () => {
  cleanupResources();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (dockWindows.length === 0) {
    createDockWindows();
  }
});

app.on("before-quit", cleanupResources);

// レンダラープロセスのクラッシュ時の処理
app.on("renderer-process-crashed", (event, webContents, killed) => {
  const displays = screen.getAllDisplays();

  displays.forEach((display, index) => {
    const existingWindow = dockWindows.find(
      (win, idx) => idx === index && (!win || win.isDestroyed())
    );

    if (existingWindow) {
      createDockWindowForDisplay(display, index);
    }
  });
});

// ウィンドウフォーカス時
app.on("browser-window-focus", () => {
  if (isMonitoring) {
    debounce("focus-check", checkAllUpdates, 500);
  }
});
