#!/usr/bin/env node
// Builds movies.json (poster, cast, plot, IMDb / Rotten Tomatoes / Metacritic scores) for the 100 films in index.html.
//
// Setup:   get a free key at https://www.omdbapi.com/apikey.aspx  (1,000 requests per day)
// Run:     OMDB_API_KEY=yourkey node fetch-metadata.js
// Needs:   Node 18 or newer. Run it from the folder that holds index.html.
// Output:  movies.json next to index.html. Commit it with the page. The key never ships to the browser.
//
// Safe to run again: films already in movies.json are skipped. Delete an entry to refetch it.

const fs = require("fs");
const path = require("path");

const KEY = process.env.OMDB_API_KEY;
if (!KEY) {
  console.error("Set OMDB_API_KEY first, for example:  OMDB_API_KEY=abc123 node fetch-metadata.js");
  process.exit(1);
}

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const raw = html.match(/const RAW = `([\s\S]*?)`;/);
if (!raw) {
  console.error("Could not find the film list in index.html.");
  process.exit(1);
}
const films = raw[1].split("\n").map((line) => {
  const [rank, title, year] = line.split("|");
  return { rank: Number(rank), title, year: parseInt(year, 10) };
});

// Films whose title on IMDb differs from the Time Out title. Add more here if the report lists misses.
const OVERRIDES = {
  17: { t: "La grande illusion", y: 1937 },
  55: { t: "Rome, Open City", y: 1945 },
  64: { t: "Pather Panchali", y: 1955 },
  87: { t: "Se7en", y: 1995 },
};

const outFile = path.join(dir, "movies.json");
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function omdb(params) {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function find(f) {
  const o = OVERRIDES[f.rank] || {};
  const t = o.t || f.title;
  const y = o.y || f.year;
  let d = await omdb({ t, y, type: "movie", plot: "short" });
  if (d.Response === "True") return d;
  d = await omdb({ t, type: "movie", plot: "short" });
  if (d.Response === "True") return d;
  const s = await omdb({ s: t, y, type: "movie" });
  if (s.Response === "True" && s.Search && s.Search[0]) {
    return omdb({ i: s.Search[0].imdbID, plot: "short" });
  }
  if (d.Error && /limit/i.test(d.Error)) throw new Error(d.Error);
  return null;
}

const na = (v) => (v && v !== "N/A" ? v : null);

(async () => {
  const misses = [];
  for (const f of films) {
    if (out[f.rank]) continue;
    try {
      const d = await find(f);
      if (!d) {
        misses.push(f);
        console.log("MISS  #" + f.rank + " " + f.title);
      } else {
        const rt = (d.Ratings || []).find((r) => r.Source === "Rotten Tomatoes");
        out[f.rank] = {
          imdbID: na(d.imdbID),
          poster: na(d.Poster),
          imdb: na(d.imdbRating),
          rt: rt ? rt.Value : null,
          metascore: na(d.Metascore),
          actors: na(d.Actors),
          plot: na(d.Plot),
          runtime: na(d.Runtime),
          genre: na(d.Genre),
        };
        console.log("ok    #" + f.rank + " " + f.title);
      }
    } catch (e) {
      console.error("STOP  " + e.message + " (progress saved, run again later)");
      break;
    }
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    await sleep(250);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log("\n" + Object.keys(out).length + " of " + films.length + " films in movies.json");
  if (misses.length) {
    console.log("No match for: " + misses.map((m) => "#" + m.rank + " " + m.title).join(", "));
    console.log("Add them to OVERRIDES at the top of this script and run again.");
  }
})();