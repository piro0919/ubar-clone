declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}

declare module "*.css" {
  const css: { [key: string]: string };
  export default css;
}

// declarations.d.tsに追加
declare module "active-win" {
  interface WindowInfo {
    title: string;
    id: number;
    bounds: {
      x: number;
      y: number;
      height: number;
      width: number;
    };
    owner: {
      name: string;
      path: string;
      pid: number;
    };
    memoryUsage: number;
  }

  function getActiveWindow(): Promise<WindowInfo | undefined>;
  function getOpenWindows(): Promise<WindowInfo[]>;

  export default {
    getActiveWindow,
    getOpenWindows,
  };
}
