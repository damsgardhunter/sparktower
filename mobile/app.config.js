/**
 * app.json, with the one plugin that can be missing made optional.
 *
 * `expo-image-picker` arrived with the photo upload work, and a config plugin
 * named in app.json is resolved when the config is *read* — so on any checkout
 * whose node_modules predates the dependency, every Expo command dies before
 * it does anything:
 *
 *   PluginError: Failed to resolve plugin for module "expo-image-picker"
 *
 * That is a correct complaint and a miserable way to make it. `expo start`,
 * `expo prebuild`, `eas build` and anything else that reads the config all
 * stop, and the message points at a plugin rather than at "run npm install".
 *
 * So the plugin is dropped when the module isn't there, with a line saying
 * what that costs. It costs the iOS permission string: a build made without
 * it opens the photo library and is refused by the system, because the
 * Info.plist has nothing to show in the dialog. That is a real consequence and
 * it is why this prints rather than passing quietly — but it is a consequence
 * of a machine mid-install, and CI and EAS both install before they build.
 */
const config = require("./app.json");

function resolvable(moduleName) {
  try {
    require.resolve(`${moduleName}/app.plugin.js`, { paths: [__dirname] });
    return true;
  } catch {
    try {
      require.resolve(moduleName, { paths: [__dirname] });
      return true;
    } catch {
      return false;
    }
  }
}

/** The name of a plugin entry, which is either a string or [name, options]. */
const nameOf = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin);

module.exports = () => {
  const plugins = (config.expo.plugins ?? []).filter((plugin) => {
    const name = nameOf(plugin);
    if (typeof name !== "string" || !name.startsWith("expo-") || resolvable(name)) return true;
    console.warn(
      `[expo] ${name} is in app.json but not installed, so its config plugin is being skipped. ` +
      "Run `npm install` in mobile/. A build made like this will be missing whatever that plugin adds — " +
      "for expo-image-picker, the iOS photo-library permission string, without which the picker is refused.",
    );
    return false;
  });

  return { ...config.expo, plugins };
};
