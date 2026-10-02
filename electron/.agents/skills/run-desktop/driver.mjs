// Drives the Verdandi desktop app on macOS: builds it, launches it with
// Playwright against a scratch VERDANDI_HOME, and runs commands read one per
// line from stdin (a prompt when stdin is a terminal). See SKILL.md.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { _electron as electron } from "playwright-core";

const repo = resolve(import.meta.dirname, "../../..");
const appDir = join(repo, "apps/desktop");
const electronBin = join(
  appDir,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const shots = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "verdandi-shots");
const timeout = 60_000;

/** @type {import("playwright-core").ElectronApplication | undefined} */
let app;
/** @type {import("playwright-core").Page | undefined} */
let page;
/** @type {string | undefined} */
let home;
let failed = false;

function window() {
  if (!page) throw new Error("launch first");
  return page;
}

/** The first visible element showing a text, e.g. not in closed `<details>`. */
function visibleText(text) {
  return window().getByText(text).filter({ visible: true }).first();
}

/**
 * Launches the built app with the scratch home, and waits until an element
 * matching `selector` shows; whether it did.
 */
async function start(selector) {
  app = await electron.launch({
    executablePath: electronBin,
    args: [appDir],
    env: { ...process.env, VERDANDI_HOME: home },
    timeout,
  });
  // Links the app would open in the browser are recorded instead.
  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = (url) => {
      globalThis.opened.push(url);
      return Promise.resolve();
    };
  });
  page = await app.firstWindow();
  // Playwright emulates a light scheme; follow the (native) theme instead.
  await page.emulateMedia({ colorScheme: null });
  await page.setViewportSize({ width: 1200, height: 800 });
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

/** Commands by name, each taking the rest of its line. */
const commands = {
  /**
   * Builds the app, then launches it tracking these repositories, or with no
   * settings file at all for `--fresh`, as on first launch.
   */
  async launch(args) {
    if (app) return "already launched";
    execFileSync("pnpm", ["--filter", "@verdandi/desktop", "build"], {
      cwd: repo,
      stdio: "pipe",
    });
    const fresh = args === "--fresh";
    const tracked = fresh ? [] : args ? args.split(/\s+/) : ["cli/cli"];
    home ??= mkdtempSync(join(tmpdir(), "verdandi-run-"));
    if (!fresh) {
      writeFileSync(
        join(home, "settings.json"),
        JSON.stringify({
          version: 1,
          repositories: tracked.map((name) => ({ name })),
          views: [],
        }),
      );
    }
    const shown = await start(
      fresh ? '[role="dialog"]' : '[aria-label="Repositories"] [role="option"]',
    );
    if (!shown)
      return `launched, but ${fresh ? "no dialog" : "no tracked repository"} shows:\n${await page.innerText("body")}`;
    return fresh
      ? `launched without settings.json (VERDANDI_HOME=${home})`
      : `launched, tracking ${tracked.join(", ")} (VERDANDI_HOME=${home})`;
  },

  /**
   * Quits the app and launches it again with the same scratch home, as the
   * user would, e.g. to see what it restores; it is not built again.
   */
  async relaunch() {
    if (!app) throw new Error("launch first");
    await app.close();
    app = page = undefined;
    const shown = await start('[role="tablist"]');
    return shown
      ? `relaunched (VERDANDI_HOME=${home})`
      : `relaunched, but no tabs show:\n${await page.innerText("body")}`;
  },

  /** Selects a sidebar entry: All, or a tracked repository by owner/name. */
  async entry(name) {
    const selector =
      name === "All"
        ? '[aria-label="All"] [role="option"]'
        : `[role="option"][title="${name}"]`;
    await window().click(selector, { timeout });
    return `selected ${name}`;
  },

  /**
   * Opens an issue from the list shown, by number or owner/name#number, and
   * waits until its page has read the issue.
   */
  async issue(reference) {
    const shown = reference.includes("#") ? reference : `#${reference}`;
    // Its number, as the middle of a row may be a label, which filters.
    await window()
      .locator('[role="treeitem"]')
      .getByText(shown, { exact: true })
      .first()
      .click({ timeout });
    await window().waitForSelector('section[aria-label="Description"]', {
      timeout,
    });
    return `opened ${await window().innerText("h1")}`;
  },

  /** Clicks the first element matching a CSS selector, as the mouse would. */
  async click(selector) {
    await window().click(selector, { timeout });
    return `clicked ${selector}`;
  },

  /** Right-clicks the first element matching a CSS selector, for its menu. */
  async rightclick(selector) {
    await window().click(selector, { button: "right", timeout });
    return `right-clicked ${selector}`;
  },

  /** Clicks the first visible element showing this text. */
  async "click-text"(text) {
    await visibleText(text).click({ timeout });
    return `clicked "${text}"`;
  },

  /**
   * Chooses an item of the application menu by its label, e.g. Settings…,
   * as a click on it would: key presses never reach native menus.
   */
  async menu(label) {
    if (!app) throw new Error("launch first");
    await app.evaluate(({ Menu }, label) => {
      const find = (items) => {
        for (const item of items) {
          if (item.label === label) return item;
          const found = item.submenu && find(item.submenu.items);
          if (found) return found;
        }
        return undefined;
      };
      const item = find(Menu.getApplicationMenu()?.items ?? []);
      if (!item) throw new Error(`no menu item ${label}`);
      item.click();
    }, label);
    return `chose ${label}`;
  },

  /** Presses a key, e.g. Escape or r, where the keyboard is. */
  async press(key) {
    await window().keyboard.press(key);
    return `pressed ${key}`;
  },

  /** Types text where the keyboard is, as a user would. */
  async type(text) {
    await window().keyboard.type(text);
    return `typed ${text}`;
  },

  /** Prints the scratch home's settings.json, or says there is none. */
  settings() {
    if (!home) throw new Error("launch first");
    const file = join(home, "settings.json");
    return existsSync(file)
      ? readFileSync(file, "utf8").trim()
      : "no settings.json";
  },

  /**
   * Prints the scratch home's config.toml; with TOML, writes it, `\n`
   * separating lines; with `--remove`, deletes it. Before `launch`, the app
   * starts with it; after, this waits until the app has read the change.
   */
  async config(args) {
    if (!args) {
      if (!home) throw new Error("launch or write a config first");
      const file = join(home, "config.toml");
      return existsSync(file)
        ? readFileSync(file, "utf8").trim()
        : "no config.toml";
    }
    home ??= mkdtempSync(join(tmpdir(), "verdandi-run-"));
    const file = join(home, "config.toml");
    const change = () => {
      if (args === "--remove") rmSync(file, { force: true });
      else writeFileSync(file, `${args.replaceAll("\\n", "\n")}\n`);
    };
    if (!page || !app) {
      change();
      return args === "--remove" ? "no config.toml" : `wrote ${file}`;
    }
    await page.evaluate(() => {
      globalThis.configPushed = new Promise((resolve) => {
        const stop = globalThis.verdandi.on("configChanged", (state) => {
          stop();
          resolve(state);
        });
      });
    });
    change();
    const state = await page.evaluate(() =>
      Promise.race([
        globalThis.configPushed,
        new Promise((_, reject) =>
          globalThis.setTimeout(() => {
            reject(new Error("the app did not see the change"));
          }, 10_000),
        ),
      ]),
    );
    // The page also hears of the appearance, from main, on its own.
    const dark = await app.evaluate(
      ({ nativeTheme }) => nativeTheme.shouldUseDarkColors,
    );
    await page.waitForFunction(
      (dark) =>
        document.defaultView.matchMedia("(prefers-color-scheme: dark)")
          .matches === dark,
      dark,
      { timeout },
    );
    return JSON.stringify(
      { status: state.status, config: state.config, problems: state.problems },
      null,
      2,
    );
  },

  /**
   * Waits until the screen shown has loaded, or failed: its header's refresh
   * button stops spinning.
   */
  async loaded() {
    await window().waitForFunction(
      () => {
        const refresh = document.querySelector(
          'main header [aria-label="Refresh"]',
        );
        return refresh !== null && !refresh.querySelector(".animate-spin");
      },
      undefined,
      { timeout },
    );
    return window().innerText('main header [role="status"]');
  },

  async wait(selector) {
    await window().waitForSelector(selector, { timeout });
    return `found ${selector}`;
  },

  async "wait-text"(text) {
    await visibleText(text).waitFor({ timeout });
    return `found "${text}"`;
  },

  /** Scrolls the first element matching a CSS selector to the top. */
  async scroll(selector) {
    await window()
      .locator(selector)
      .first()
      .evaluate((element) => {
        element.scrollIntoView({ block: "start" });
      });
    return `scrolled to ${selector}`;
  },

  /** The text shown by the first match of a CSS selector, or the window. */
  async text(selector) {
    return window().innerText(selector || "body");
  },

  /** Evaluates JavaScript in the window, printing the result as JSON. */
  async eval(expression) {
    return JSON.stringify(await window().evaluate(expression), null, 2);
  },

  /**
   * Pushes a contract event to the window from main, as the core does, e.g.
   * to show a state GitHub does not bring about on demand. The payload is a
   * JavaScript expression, evaluated here, so it can use `Date.now()`.
   */
  async push(args) {
    const [, name, expression] = /^(\S+)\s+(.+)$/.exec(args) ?? [];
    if (!name) throw new Error("push <event> <payload>");
    if (!app) throw new Error("launch first");
    const payload = new Function(`return (${expression});`)();
    await app.evaluate(
      ({ BrowserWindow }, [event, value]) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send("verdandi:event", event, value);
        }
      },
      [name, payload],
    );
    return `pushed ${name}`;
  },

  /**
   * Switches the operating system's appearance to light or dark, so the page
   * gets its `prefers-color-scheme` change event: emulating the media query
   * changes what it matches, but fires no event.
   */
  async theme(scheme) {
    if (scheme !== "light" && scheme !== "dark") {
      throw new Error("theme light or theme dark");
    }
    if (!app) throw new Error("launch first");
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    await window().waitForFunction(
      (dark) =>
        document.defaultView.matchMedia("(prefers-color-scheme: dark)")
          .matches === dark,
      scheme === "dark",
      { timeout },
    );
    return `theme ${scheme}`;
  },

  /** Resizes the window's page, 1200 × 800 at launch. */
  async size(args) {
    const [width, height] = args.split(/\s+/).map(Number);
    if (!width || !height) throw new Error("size <width> <height>");
    await window().setViewportSize({ width, height });
    return `size ${String(width)} × ${String(height)}`;
  },

  async ss(name) {
    mkdirSync(shots, { recursive: true });
    const file = join(shots, `${name || `ss-${String(Date.now())}`}.png`);
    await window().screenshot({ path: file });
    return `screenshot ${file}`;
  },

  /** The links the app opened in the browser, in order. */
  async opened() {
    if (!app) throw new Error("launch first");
    return JSON.stringify(await app.evaluate(() => globalThis.opened));
  },

  async quit() {
    await app?.close();
    if (home) rmSync(home, { recursive: true, force: true });
    app = page = home = undefined;
    return "quit";
  },

  help() {
    return `commands: ${Object.keys(commands).join(", ")}`;
  },
};

const interactive = process.stdin.isTTY;
const lines = createInterface({ input: process.stdin });
const prompt = () => {
  if (interactive) process.stdout.write("driver> ");
};
prompt();
for await (const line of lines) {
  // The rest of the line as written, e.g. the spaces in a config's text.
  const [, name = "", rest = ""] = /^(\S*)\s*(.*)$/.exec(line.trim()) ?? [];
  const command = commands[name];
  if (name === "" || name.startsWith("//")) {
    prompt();
    continue;
  }
  if (!command) {
    console.log(`unknown command: ${name} (try help)`);
    failed = true;
  } else {
    try {
      console.log(await command(rest));
    } catch (error) {
      failed = true;
      console.log(`ERROR ${name}: ${error.message.split("\n")[0]}`);
    }
  }
  if (name === "quit") break;
  prompt();
}
if (app) console.log(await commands.quit());
process.exitCode = failed ? 1 : 0;
