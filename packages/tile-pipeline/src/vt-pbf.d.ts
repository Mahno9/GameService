declare module 'vt-pbf' {
  interface FromGeojsonVtOptions {
    version?: number;
    extent?: number;
  }
  const vtpbf: {
    fromGeojsonVt(
      layers: Record<string, unknown>,
      options?: FromGeojsonVtOptions,
    ): Uint8Array;
  };
  export default vtpbf;
}
