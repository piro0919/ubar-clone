/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/preload.ts":
/*!************************!*\
  !*** ./src/preload.ts ***!
  \************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

eval("\nObject.defineProperty(exports, \"__esModule\", ({ value: true }));\nconst electron_1 = __webpack_require__(/*! electron */ \"electron\");\n// 有効なチャンネル定義\nconst VALID_SEND_CHANNELS = [\n    \"get-running-apps\",\n    \"start-app-monitoring\",\n    \"stop-app-monitoring\",\n    \"get-apps-by-display\",\n    \"force-refresh-apps\",\n    \"launch-app\",\n    \"activate-specific-window\",\n];\nconst VALID_RECEIVE_CHANNELS = [\n    \"running-apps\",\n    \"apps-by-display\",\n    \"app-launched\",\n    \"set-window-id\",\n    \"app-event\",\n    \"window-activated\",\n];\n// チャンネルセット（高速検索用）\nconst SEND_CHANNEL_SET = new Set(VALID_SEND_CHANNELS);\nconst RECEIVE_CHANNEL_SET = new Set(VALID_RECEIVE_CHANNELS);\n// チャンネル検証\nconst isValidSendChannel = (channel) => SEND_CHANNEL_SET.has(channel);\nconst isValidReceiveChannel = (channel) => RECEIVE_CHANNEL_SET.has(channel);\n// リスナー追跡用（リソースリーク防止）\nconst listeners = new Map();\n// レンダラープロセスに公開するAPI\nelectron_1.contextBridge.exposeInMainWorld(\"electronAPI\", {\n    // 強制更新リクエスト\n    forceRefreshApps: () => electron_1.ipcRenderer.send(\"force-refresh-apps\"),\n    // 同期的にディスプレイ別アプリリストを取得\n    getAppsByDisplaySync: async () => {\n        try {\n            return await electron_1.ipcRenderer.invoke(\"get-apps-by-display-sync\");\n        }\n        catch {\n            return {}; // エラー時は空オブジェクト\n        }\n    },\n    // アプリリスト取得（同期）\n    getAppsSync: async () => {\n        try {\n            return await electron_1.ipcRenderer.invoke(\"get-apps-sync\");\n        }\n        catch {\n            return []; // エラー時は空配列\n        }\n    },\n    // ウィンドウタイトル一覧取得（デバッグ用）\n    invoke: async (channel, ...args) => {\n        if (channel === \"get-all-window-titles\") {\n            return await electron_1.ipcRenderer.invoke(\"get-all-window-titles\");\n        }\n        throw new Error(`Invalid invoke channel: ${channel}`);\n    },\n    // アプリを起動または前面に表示\n    launchApp: (appName) => {\n        // 入力検証\n        if (typeof appName !== \"string\" || !appName.trim())\n            return;\n        // 安全なアプリ名のみを許可\n        const safeAppNameRegex = /^[a-zA-Z0-9\\s._-]+$/;\n        if (safeAppNameRegex.test(appName)) {\n            electron_1.ipcRenderer.send(\"launch-app\", appName);\n        }\n    },\n    // イベントリスナー登録\n    on: (channel, func) => {\n        if (!isValidReceiveChannel(channel))\n            return undefined;\n        const subscription = (_event, ...args) => func(...args);\n        electron_1.ipcRenderer.on(channel, subscription);\n        // リスナー追跡に追加\n        if (!listeners.has(channel)) {\n            listeners.set(channel, []);\n        }\n        listeners.get(channel)?.push(subscription);\n        // クリーンアップ関数\n        return () => {\n            electron_1.ipcRenderer.removeListener(channel, subscription);\n            const channelListeners = listeners.get(channel);\n            if (channelListeners) {\n                const index = channelListeners.indexOf(subscription);\n                if (index !== -1) {\n                    channelListeners.splice(index, 1);\n                }\n            }\n        };\n    },\n    // アプリ起動/終了イベントリスナー\n    onAppEvent: (callback) => {\n        const channel = \"app-event\";\n        const subscription = (_event, data) => callback(data);\n        electron_1.ipcRenderer.on(channel, subscription);\n        // リスナー追跡に追加\n        if (!listeners.has(channel)) {\n            listeners.set(channel, []);\n        }\n        listeners.get(channel)?.push(subscription);\n        return () => {\n            electron_1.ipcRenderer.removeListener(channel, subscription);\n            const channelListeners = listeners.get(channel);\n            if (channelListeners) {\n                const index = channelListeners.indexOf(subscription);\n                if (index !== -1) {\n                    channelListeners.splice(index, 1);\n                }\n            }\n        };\n    },\n    // ディスプレイごとのアプリリスト更新リスナー\n    onAppsByDisplayUpdate: (callback) => {\n        const channel = \"apps-by-display\";\n        const subscription = (_event, data) => callback(data);\n        electron_1.ipcRenderer.on(channel, subscription);\n        // リスナー追跡に追加\n        if (!listeners.has(channel)) {\n            listeners.set(channel, []);\n        }\n        listeners.get(channel)?.push(subscription);\n        return () => {\n            electron_1.ipcRenderer.removeListener(channel, subscription);\n            const channelListeners = listeners.get(channel);\n            if (channelListeners) {\n                const index = channelListeners.indexOf(subscription);\n                if (index !== -1) {\n                    channelListeners.splice(index, 1);\n                }\n            }\n        };\n    },\n    // ウィンドウIDの受信用リスナー\n    onSetWindowId: (callback) => {\n        const subscription = (_event, data) => callback(data);\n        electron_1.ipcRenderer.on(\"set-window-id\", subscription);\n        // リスナー追跡に追加\n        if (!listeners.has(\"set-window-id\")) {\n            listeners.set(\"set-window-id\", []);\n        }\n        listeners.get(\"set-window-id\")?.push(subscription);\n        return () => {\n            electron_1.ipcRenderer.removeListener(\"set-window-id\", subscription);\n            const windowIdListeners = listeners.get(\"set-window-id\");\n            if (windowIdListeners) {\n                const index = windowIdListeners.indexOf(subscription);\n                if (index !== -1) {\n                    windowIdListeners.splice(index, 1);\n                }\n            }\n        };\n    },\n    // リスナーのクリーンアップ\n    removeAllListeners: (channel) => {\n        if (isValidReceiveChannel(channel)) {\n            electron_1.ipcRenderer.removeAllListeners(channel);\n            listeners.delete(channel);\n        }\n    },\n    // ディスプレイ別アプリリスト要求\n    requestApps: () => electron_1.ipcRenderer.send(\"get-apps-by-display\"),\n    // メッセージ送信\n    send: (channel, data) => {\n        if (isValidSendChannel(channel)) {\n            electron_1.ipcRenderer.send(channel, data);\n        }\n    },\n});\n// プロセス終了時の自動クリーンアップ\nwindow.addEventListener(\"unload\", () => {\n    for (const [channel, channelListeners] of listeners.entries()) {\n        for (const listener of channelListeners) {\n            electron_1.ipcRenderer.removeListener(channel, listener);\n        }\n    }\n    listeners.clear();\n});\n\n\n//# sourceURL=webpack://ubar-clone/./src/preload.ts?");

/***/ }),

/***/ "electron":
/*!***************************!*\
  !*** external "electron" ***!
  \***************************/
/***/ ((module) => {

module.exports = require("electron");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = __webpack_require__("./src/preload.ts");
/******/ 	
/******/ })()
;