const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'sqlite', 'wasm', 'txt'])];

const previousEnhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const nextMiddleware = previousEnhance ? previousEnhance(middleware, server) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    nextMiddleware(req, res, next);
  };
};

module.exports = config;
