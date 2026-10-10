// Hugeicons, rendered to inline SVG strings on the server.
import {
  ComputerIcon,
  Download01Icon,
  GithubIcon,
  Link01Icon,
  Moon02Icon,
  Sun03Icon,
  Tick02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";

type IconData = readonly (readonly [string, Readonly<Record<string, string | number>>])[];

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function svg(data: IconData, size: number, className?: string): string {
  const children = data
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => ` ${kebab(k)}="${v}"`)
        .join("");
      return `<${tag}${a}/>`;
    })
    .join("");
  const cls = className ? ` class="${className}"` : "";
  return `<svg${cls} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true">${children}</svg>`;
}

export const icons = {
  download: (size = 18) => svg(Download01Icon as IconData, size),
  link: (size = 18, className?: string) => svg(Link01Icon as IconData, size, className),
  tick: (size = 18, className?: string) => svg(Tick02Icon as IconData, size, className),
  system: (size = 18, className?: string) => svg(ComputerIcon as IconData, size, className),
  light: (size = 18, className?: string) => svg(Sun03Icon as IconData, size, className),
  dark: (size = 18, className?: string) => svg(Moon02Icon as IconData, size, className),
  github: (size = 16) => svg(GithubIcon as IconData, size),
  view: (size = 18, className?: string) => svg(ViewIcon as IconData, size, className),
  viewOff: (size = 18, className?: string) => svg(ViewOffSlashIcon as IconData, size, className),
};
