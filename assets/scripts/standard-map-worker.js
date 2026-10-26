importScripts("standard-map-core.js");

self.onmessage = (event) => {
  const { requestId, modes, options } = event.data;
  try {
    const beta = self.StandardMapCore.computeBeta(modes, options);
    self.postMessage({ requestId, beta });
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) });
  }
};
