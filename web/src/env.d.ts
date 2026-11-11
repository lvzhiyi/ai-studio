/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 接口地址前缀，留空表示同源（开发时走 Vite 代理）。例：http://127.0.0.1:3000 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
