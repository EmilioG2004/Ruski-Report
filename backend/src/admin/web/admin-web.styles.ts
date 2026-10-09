export const ADMIN_WEB_CSS = `
:root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; --ink:#17211b; --muted:#526057; --paper:#f5f4ee; --panel:#fff; --line:#cbd3cc; --accent:#17633b; --danger:#9e2a2b; }
* { box-sizing: border-box; }
body { margin:0; color:var(--ink); background:var(--paper); line-height:1.5; }
a { color:#0c5932; text-underline-offset:.18em; }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline:3px solid #f0a202; outline-offset:3px; }
.skip-link { position:absolute; left:-9999px; top:.5rem; z-index:10; padding:.75rem; background:#fff; }
.skip-link:focus { left:.5rem; }
.site-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem clamp(1rem,4vw,3rem); color:#fff; background:#123d29; }
.site-header p { margin:0; }
.site-title { font-size:1.25rem; font-weight:750; }
.eyebrow { text-transform:uppercase; letter-spacing:.1em; font-size:.78rem; font-weight:750; }
nav { display:flex; align-items:center; flex-wrap:wrap; gap:1rem; }
nav a, nav .link-button { color:#fff; }
nav form { margin:0; }
.operator { font-size:.9rem; }
main { width:min(1180px, calc(100% - 2rem)); margin:2rem auto 4rem; }
footer { padding:1rem; color:var(--muted); text-align:center; }
h1, h2, h3 { line-height:1.2; }
.panel { padding:clamp(1rem,3vw,2rem); border:1px solid var(--line); border-radius:.75rem; background:var(--panel); box-shadow:0 1px 5px #00000010; }
.narrow { max-width:36rem; margin-inline:auto; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(17rem,1fr)); gap:1rem; }
.stack { display:grid; gap:1rem; }
.actions { display:flex; flex-wrap:wrap; align-items:center; gap:.75rem; margin-block:1.25rem; }
.field { margin-block:1rem; }
label, legend { font-weight:700; }
input, select { width:100%; min-height:44px; margin-top:.35rem; padding:.65rem; border:1px solid #89958c; border-radius:.35rem; background:#fff; color:var(--ink); font:inherit; }
input[type=radio], input[type=checkbox] { width:auto; min-height:auto; margin-right:.4rem; }
fieldset { min-width:0; margin:1.25rem 0; padding:1rem; border:1px solid var(--line); border-radius:.5rem; }
button, .button { display:inline-flex; min-height:44px; align-items:center; justify-content:center; padding:.65rem 1rem; border:2px solid var(--accent); border-radius:.35rem; color:#fff; background:var(--accent); font:inherit; font-weight:750; text-decoration:none; cursor:pointer; }
.button.secondary { color:var(--accent); background:#fff; }
.link-button { min-height:44px; padding:0; border:0; background:transparent; text-decoration:underline; }
.help, .meta { color:var(--muted); font-size:.92rem; }
.notice { padding:1rem; border-left:5px solid var(--accent); background:#e8f4ec; }
.error-message, .field-errors { color:var(--danger); font-weight:700; }
.error-summary { margin-block:1rem; padding:1rem; border:2px solid var(--danger); background:#fff3f3; }
.error-summary h2 { margin-top:0; font-size:1.15rem; }
.status { display:inline-block; padding:.2rem .55rem; border-radius:999px; background:#e6ece7; font-size:.85rem; font-weight:750; }
table { width:100%; border-collapse:collapse; }
caption { padding:.5rem; font-weight:750; text-align:left; }
th, td { padding:.65rem; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
.table-scroll { overflow-x:auto; }
.team-card { margin-block:1rem; }
.player-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.75rem; }
.locked { border-left:5px solid #68746b; }
@media (max-width:700px) { .site-header { align-items:flex-start; flex-direction:column; } main { width:min(100% - 1rem,1180px); margin-top:1rem; } th,td { padding:.45rem; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; transition:none!important; animation:none!important; } }
`;
