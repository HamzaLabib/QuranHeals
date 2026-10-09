// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Test probes copy a hook's result into a module variable during render
    // (`function Probe() { account = useAuth(); }`) so the test can read it.
    files: ["tests/**"],
    rules: {
      "react-hooks/globals": "off",
    },
  },
]);
