const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = [
  {
    // メインプロセスの設定
    mode: "development",
    entry: "./src/main.ts",
    target: "electron-main",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "main.js",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: /src/,
          use: [{ loader: "ts-loader" }],
        },
      ],
    },
  },
  {
    // preloadスクリプトの設定を追加
    mode: "development",
    entry: "./src/preload.ts",
    target: "electron-preload",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "preload.js",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: /src/,
          use: [{ loader: "ts-loader" }],
        },
      ],
    },
  },
  {
    // レンダラープロセスの設定
    // （以下変更なし）
    mode: "development",
    entry: "./src/renderer/index.tsx",
    target: "electron-renderer",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "renderer.js",
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          include: /src/,
          use: [{ loader: "ts-loader" }],
        },
        {
          test: /\.module\.css$/,
          use: [
            "style-loader",
            {
              loader: "css-loader",
              options: {
                modules: true,
                importLoaders: 1,
              },
            },
          ],
        },
        {
          test: /\.css$/,
          exclude: /\.module\.css$/,
          use: ["style-loader", "css-loader"],
        },
        {
          test: /\.(png|jpg|svg|gif)$/,
          use: ["file-loader"],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "./src/renderer/index.html",
      }),
    ],
  },
];
