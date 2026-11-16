// Page navigation shared by every page: inserted at the top of <main>.
// Uses each page's --fg / --dim / --accent colour tokens.

const PAGES = [
  { label: "Live", href: "./", match: (u) => !u.pathname.endsWith("workbench.html") && u.searchParams.get("source") !== "synthetic" },
  { label: "Synthetic", href: "./?source=synthetic", match: (u) => !u.pathname.endsWith("workbench.html") && u.searchParams.get("source") === "synthetic" },
  { label: "Workbench", href: "workbench.html", match: (u) => u.pathname.endsWith("workbench.html") },
];

const style = document.createElement("style");
style.textContent = `
  nav.site { display: flex; gap: 4px; flex-wrap: wrap; margin: 0 0 16px; font-size: 14px; }
  nav.site a { color: var(--dim); text-decoration: none; padding: 4px 10px; border-radius: 6px; border: 1px solid transparent; }
  nav.site a:hover { color: var(--fg); border-color: var(--dim); }
  nav.site a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  nav.site a[aria-current="page"] { color: var(--accent); border-color: var(--accent); }
`;
document.head.appendChild(style);

const here = new URL(location.href);
const nav = document.createElement("nav");
nav.className = "site";
nav.setAttribute("aria-label", "Pages");
for (const p of PAGES) {
  const a = document.createElement("a");
  a.href = p.href;
  a.textContent = p.label;
  if (p.match(here)) a.setAttribute("aria-current", "page");
  nav.appendChild(a);
}
document.querySelector("main").prepend(nav);
