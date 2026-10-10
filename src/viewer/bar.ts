// The top bar shared by the Markdown viewer and the frame around HTML pages.

type ThemeChoice = "system" | "light" | "dark";
const THEME_ORDER: ThemeChoice[] = ["system", "light", "dark"];
const THEME_LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

function themeChoice(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  return set === "light" || set === "dark" ? set : "system";
}

export function currentTheme(): "light" | "dark" {
  const choice = themeChoice();
  if (choice !== "system") return choice;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function labelThemeButton(btn: HTMLElement) {
  const choice = themeChoice();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(choice) + 1) % THEME_ORDER.length];
  btn.setAttribute("aria-label", `Theme: ${THEME_LABEL[choice]}. Switch to ${THEME_LABEL[next]}`);
  btn.title = `Theme: ${THEME_LABEL[choice]}`;
}

/** Wires the copy-link and theme buttons. `link` gives the URL to copy. */
export function wireBar(link: () => string = () => location.origin + location.pathname) {
  document.querySelector<HTMLButtonElement>("[data-copy-link]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLElement;
    await navigator.clipboard.writeText(link());
    // Icon-only button: swap the link icon for a tick instead of changing its text.
    btn.dataset.copied = "";
    btn.title = "Copied";
    setTimeout(() => {
      delete btn.dataset.copied;
      btn.title = "Copy link";
    }, 1400);
  });
  const themeBtn = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (!themeBtn) return;
  labelThemeButton(themeBtn);
  // Cycles system, light, dark. "System" follows the OS setting and stores nothing.
  themeBtn.addEventListener("click", () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(themeChoice()) + 1) % THEME_ORDER.length];
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === "system") localStorage.removeItem("sharecli-theme");
      else localStorage.setItem("sharecli-theme", next);
    } catch {}
    labelThemeButton(themeBtn);
  });
}
