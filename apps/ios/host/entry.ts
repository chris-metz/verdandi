/**
 * The bundle's entry on JavaScriptCore: it installs what the engine lacks,
 * then hands the app the host as `globalThis.__host`. The app has set
 * `globalThis.__native` before it runs this.
 */
import { createHost } from "./host.ts";
import { useNative, type Native } from "./native.ts";
import { installPolyfills } from "./polyfills.ts";

const scope = globalThis as { __native?: Native; __host?: unknown };
if (!scope.__native) throw new Error("The app has not set __native.");
useNative(scope.__native);
installPolyfills();
scope.__host = createHost();
