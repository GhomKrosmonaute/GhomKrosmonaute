// Generates assets/stats.svg and assets/languages.svg from the GitHub API.
// No dependency and no third-party service: run daily by .github/workflows/stats.yml,
// or locally with `GITHUB_TOKEN=… node scripts/stats.mjs`.

import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.STATS_LOGIN ?? "GhomKrosmonaute";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const C = {
  bg: "#050508",
  panel: "#0a0b12",
  line: "#1b1d2b",
  text: "#e6f6ff",
  muted: "#7d8aa3",
  cyan: "#00f0ff",
  magenta: "#ff2bd6",
  yellow: "#e8ff3a",
};
const FONT = "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace";

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data;
}

async function collect() {
  const repos = [];
  let after = null;
  let user;
  do {
    const data = await graphql(
      `query($login: String!, $after: String) {
        user(login: $login) {
          createdAt
          followers { totalCount }
          contributionsCollection {
            totalCommitContributions
            totalPullRequestContributions
            contributionCalendar { totalContributions }
          }
          organizations(first: 50) { totalCount }
          repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100, after: $after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              stargazerCount
              languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
                edges { size node { name color } }
              }
            }
          }
        }
      }`,
      { login: LOGIN, after },
    );
    user = data.user;
    repos.push(...user.repositories.nodes);
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);

  const languages = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      const current = languages.get(node.name) ?? { size: 0, color: node.color ?? C.muted };
      current.size += size;
      languages.set(node.name, current);
    }
  }

  return {
    since: new Date(user.createdAt).getFullYear(),
    repos: user.repositories.totalCount,
    stars: repos.reduce((sum, r) => sum + r.stargazerCount, 0),
    followers: user.followers.totalCount,
    orgs: user.organizations.totalCount,
    commits: user.contributionsCollection.totalCommitContributions,
    pulls: user.contributionsCollection.totalPullRequestContributions,
    contributions: user.contributionsCollection.contributionCalendar.totalContributions,
    languages: [...languages.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.size - a.size),
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Shared frame: dark panel, faint grid, cut corner, neon edge and a title bar. */
function frame(width, height, title, code, body) {
  const cut = 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="${C.line}" stroke-width="1" opacity=".55"/>
    </pattern>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.cyan}"/>
      <stop offset="1" stop-color="${C.magenta}"/>
    </linearGradient>
    <clipPath id="shape"><path d="M0 0H${width - cut}L${width} ${cut}V${height}H${cut}L0 ${height - cut}Z"/></clipPath>
  </defs>
  <style>
    text { font-family: ${FONT}; }
    .label { fill: ${C.muted}; font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; }
    .value { fill: ${C.text}; font-size: 22px; font-weight: 700; }
    .title { fill: ${C.cyan}; font-size: 12px; letter-spacing: 3px; font-weight: 700; }
    .code { fill: ${C.magenta}; font-size: 11px; letter-spacing: 2px; }
    .grow { animation: grow 1.1s cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: left; }
    @keyframes grow { from { transform: scaleX(0); } }
    .blink { animation: blink 1.4s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
  </style>
  <g clip-path="url(#shape)">
    <rect width="${width}" height="${height}" fill="${C.bg}"/>
    <rect width="${width}" height="${height}" fill="url(#grid)"/>
  </g>
  <path d="M0.5 0.5H${width - cut}L${width - 0.5} ${cut}V${height - 0.5}H${cut}L0.5 ${height - cut}Z" fill="none" stroke="url(#edge)" stroke-opacity=".7"/>
  <text x="20" y="30" class="title">${esc(title)}</text>
  <text x="${width - 22}" y="30" class="code" text-anchor="end">${esc(code)}</text>
  <rect x="20" y="40" width="${width - 40}" height="1" fill="${C.line}"/>
${body}
</svg>
`;
}

function statsCard(s) {
  const year = new Date().getFullYear();
  const cells = [
    ["Public repos", s.repos, C.cyan],
    ["Stars earned", s.stars, C.yellow],
    ["Followers", s.followers, C.magenta],
    [`Contribs ${year}`, s.contributions, C.cyan],
    [`Commits ${year}`, s.commits, C.yellow],
    ["Organizations", s.orgs, C.magenta],
  ];
  const width = 420;
  const body = cells
    .map(([label, value, color], i) => {
      const x = 20 + (i % 2) * 196;
      const y = 62 + Math.floor(i / 2) * 50;
      return `  <rect x="${x}" y="${y}" width="3" height="34" fill="${color}"/>
  <text x="${x + 14}" y="${y + 12}" class="label">${esc(label)}</text>
  <text x="${x + 14}" y="${y + 34}" class="value">${value.toLocaleString("en-US")}</text>`;
    })
    .join("\n");
  const footer = `  <text x="20" y="226" class="label">Online since ${s.since}<tspan class="blink" fill="${C.cyan}"> _</tspan></text>`;
  return frame(width, 240, "SYSTEM STATUS", "SYS.STATS", `${body}\n${footer}`);
}

function languagesCard(s) {
  const top = s.languages.slice(0, 6);
  const total = top.reduce((sum, l) => sum + l.size, 0) || 1;
  const width = 420;
  const barWidth = width - 40;
  let offset = 0;
  const stacked = top
    .map((l) => {
      const w = (l.size / total) * barWidth;
      const rect = `<rect x="${(20 + offset).toFixed(2)}" y="58" width="${Math.max(w - 2, 1).toFixed(2)}" height="8" fill="${l.color}"/>`;
      offset += w;
      return rect;
    })
    .join("");
  const rows = top
    .map((l, i) => {
      const x = 20 + (i % 2) * 196;
      const y = 92 + Math.floor(i / 2) * 44;
      const pct = (l.size / total) * 100;
      return `  <rect x="${x}" y="${y - 9}" width="8" height="8" fill="${l.color}"/>
  <text x="${x + 16}" y="${y}" class="label" style="fill:${C.text}">${esc(l.name)}</text>
  <text x="${x + 176}" y="${y}" class="label" text-anchor="end">${pct.toFixed(1)}%</text>
  <rect x="${x}" y="${y + 9}" width="176" height="3" fill="${C.line}"/>
  <rect x="${x}" y="${y + 9}" width="${((176 * pct) / 100).toFixed(2)}" height="3" fill="${l.color}" class="grow"/>`;
    })
    .join("\n");
  const footer = `  <text x="20" y="226" class="label">By code size · public repos</text>`;
  return frame(width, 240, "LOADOUT", "SYS.LANGS", `  <g class="grow">${stacked}</g>\n${rows}\n${footer}`);
}

const stats = await collect();
await mkdir("assets", { recursive: true });
await writeFile("assets/stats.svg", statsCard(stats));
await writeFile("assets/languages.svg", languagesCard(stats));
console.log(JSON.stringify({ ...stats, languages: stats.languages.slice(0, 6).map((l) => l.name) }));
