/* global Log */
/*
 * MMT-WeatherRibbons / wx-forecast.js: theme script for MagicMirror's stock weather module.
 * Loaded through the module's own theme settings (themeDir + themeCustomScripts).
 *
 * For each forecast day it draws a smooth hourly temperature ribbon, then rotates
 * clouds-and-rain / wind / UV overlays and icons with a crossfade. The day, the
 * temperatures and the ribbon never change during the rotation.
 *
 * Hourly data comes straight from Open-Meteo, because the stock module drops
 * hourly data for type "forecast". Only weather modules that list this script in
 * themeCustomScripts are affected; any other weather module behaves as stock.
 */
(function () {
	const SCRIPT = "wx-forecast.js";
	const PAGES = ["sky", "wind", "uv"];
	const HOURLY = ["temperature_2m", "precipitation_probability", "precipitation", "cloud_cover", "wind_speed_10m", "uv_index"];
	const DEFAULTS = {
		wxMinUV: 4,
		wxMinWind: 5,
		wxMinRainChance: 30,
		wxMinRainAmount: 0.02,
		wxMinCloudCover: 50,
		wxShowClouds: true,
		wxChartHeight: 35,
		wxStartHour: 0,
		wxEndHour: 24,
		wxPageSeconds: 8,
		wxFadeSeconds: 1.2
	};

	// Ribbon drawing area, in SVG units
	const WIDTH = 240;
	const HEIGHT = 35;
	const BASE = 32; // bottom of the ribbon

	const state = {};
	const isOurs = (m) => (m.config.themeCustomScripts || []).includes(SCRIPT);
	const cfg = (m, key) => m.config[key] ?? DEFAULTS[key];

	/* ---------- colors ---------- */

	const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
	const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
	const rgb = (a) => `rgb(${a.join(",")})`;
	const scale = (stops, v) => {
		if (v <= stops[0][0]) return hex(stops[0][1]);
		for (let i = 1; i < stops.length; i++) {
			if (v <= stops[i][0]) {
				const [v0, c0] = stops[i - 1];
				const [v1, c1] = stops[i];
				return mix(hex(c0), hex(c1), (v - v0) / (v1 - v0));
			}
		}
		return hex(stops[stops.length - 1][1]);
	};

	// Fixed scale in °F, so a color always means the same temperature
	const TEMP_STOPS = [[20, "#7F77DD"], [32, "#185FA5"], [45, "#378ADD"], [52, "#85B7EB"], [58, "#D3D1C7"], [65, "#FAC775"], [75, "#EF9F27"], [85, "#D85A30"], [95, "#E24B4A"]];
	const UV_STOPS = [[0, "#1a1a1a"], [1, "#639922"], [3, "#97C459"], [4, "#FAC775"], [6, "#EF9F27"], [7, "#D85A30"], [9, "#E24B4A"]];
	const BLACK = [0, 0, 0];
	const CLOUD_WHITE = hex("#F1EFE8");
	const CLOUD_GRAY = hex("#5F5E5A");
	const tempColor = (t, units) => rgb(scale(TEMP_STOPS, units.temp === "fahrenheit" ? t : t * 9 / 5 + 32));
	const uvColor = (u) => rgb(scale(UV_STOPS, u));
	// Cloud deck: brighter with more cover, grayer as rain gets likelier
	const deckColor = (h) => rgb(mix(BLACK, mix(CLOUD_WHITE, CLOUD_GRAY, (h.prob / 100) * 1.1), h.cloud < 8 ? 0 : 0.3 + 0.7 * h.cloud / 100));

	/* ---------- helpers ---------- */

	const toMph = (v, unit) => v * ({ mph: 1, kmh: 0.6214, kn: 1.1508, ms: 2.2369 }[unit] || 1);
	const toInches = (v, unit) => (unit === "inch" ? v : v / 25.4);
	const r2 = (n) => Math.round(n * 100) / 100;

	// Stable pseudo-random numbers, so raindrops don't jump on every redraw
	const rnd = (a, b, c) => {
		const x = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
		return x - Math.floor(x);
	};

	// Smooth curve through every point (Catmull-Rom as cubic Béziers)
	const smooth = (pts) => {
		let d = `M${pts[0][0]},${pts[0][1]}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] || pts[i];
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const p3 = pts[i + 2] || p2;
			d += ` C${r2(p1[0] + (p2[0] - p0[0]) / 6)},${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)},${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
		}
		return d;
	};

	// Points for a curve across the full width: one per hour, held flat to both edges
	const edgePoints = (hrs, g, y) => [[0, y(hrs[0])], ...hrs.map((h) => [g.X(h.hr), y(h)]), [WIDTH, y(hrs[hrs.length - 1])]]
		.map(([x, v]) => [r2(x), r2(v)]);

	const gradient = (id, hrs, g, color) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" x2="${WIDTH}" y1="0" y2="0">${hrs.map((h) => `<stop offset="${(g.X(h.hr) / WIDTH).toFixed(4)}" stop-color="${color(h)}"/>`).join("")}</linearGradient>`;

	const max = (arr) => Math.max(0, ...arr);
	const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

	// Displayed hours, from config (wxStartHour inclusive, wxEndHour exclusive)
	function geometry (m) {
		const start = Math.max(0, Math.min(23, parseInt(cfg(m, "wxStartHour"), 10) || 0));
		let end = parseInt(cfg(m, "wxEndHour"), 10);
		if (!(end > start) || end > 24) end = 24;
		const step = WIDTH / (end - start);
		return { start, end, step, X: (hr) => (hr - start + 0.5) * step };
	}

	/* ---------- data ---------- */

	async function loadHourly (m) {
		const st = state[m.identifier];
		const c = m.config;
		const units = {
			temp: c.tempUnits === "imperial" ? "fahrenheit" : "celsius",
			wind: { imperial: "mph", kmh: "kmh", knots: "kn" }[c.windUnits] || "ms",
			precip: c.units === "imperial" ? "inch" : "mm"
		};
		units.windLabel = { mph: "mph", kmh: "km/h", kn: "kn", ms: "m/s" }[units.wind];

		const params = new URLSearchParams({
			latitude: c.lat,
			longitude: c.lon,
			hourly: HOURLY.join(","),
			temperature_unit: units.temp,
			wind_speed_unit: units.wind,
			precipitation_unit: units.precip,
			timezone: "auto",
			timeformat: "unixtime",
			forecast_days: Math.min(16, (parseInt(c.maxNumberOfDays, 10) || 5) + 1)
		});

		try {
			const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			const h = data.hourly;
			const offset = data.utc_offset_seconds || 0;
			const days = {};

			h.time.forEach((t, k) => {
				if (h.temperature_2m[k] == null) return;
				const local = new Date((t + offset) * 1000);
				const key = local.toISOString().slice(0, 10);
				(days[key] ||= []).push({
					hr: local.getUTCHours(),
					temp: h.temperature_2m[k],
					prob: h.precipitation_probability[k] ?? 0,
					amt: h.precipitation[k] ?? 0,
					cloud: h.cloud_cover[k] ?? 0,
					wind: h.wind_speed_10m[k] ?? 0,
					uv: h.uv_index[k] ?? 0
				});
			});

			st.hourly = { days, units };
			m.updateDom(0);
		} catch (error) {
			Log.error(`[wx-forecast] Could not load hourly data: ${error.message}`);
		}
	}

	// Day summary and which pages it qualifies for (over the displayed hours only)
	function summarize (m, hrs) {
		const s = {
			rain: max(hrs.map((h) => h.prob)),
			rainAmount: max(hrs.map((h) => h.amt)),
			clouds: avg(hrs.map((h) => h.cloud)),
			wind: max(hrs.map((h) => h.wind)),
			uv: max(hrs.map((h) => h.uv))
		};
		s.rainQ = s.rain > cfg(m, "wxMinRainChance") || s.rainAmount >= cfg(m, "wxMinRainAmount");
		s.cloudQ = cfg(m, "wxShowClouds") !== false && s.clouds > cfg(m, "wxMinCloudCover");
		s.pages = [];
		if (s.rainQ || s.cloudQ) s.pages.push("sky");
		if (s.wind > cfg(m, "wxMinWind")) s.pages.push("wind");
		if (s.uv > cfg(m, "wxMinUV")) s.pages.push("uv");
		return s;
	}

	/* ---------- drawing ---------- */

	function slotHtml (v, s, units) {
		const icon = (name) => `<span class="wi weathericon ${name}"></span>`;
		switch (v) {
			case "sky":
				return s.rainQ
					? `<span class="wx-layer wx-rain" data-v="sky">${icon("wi-raindrop")}<span class="wx-val">${Math.round(s.rain)}%</span></span>`
					: `<span class="wx-layer wx-clouds" data-v="sky">${icon("wi-cloudy")}<span class="wx-val">${Math.round(s.clouds)}%</span></span>`;
			case "wind":
				return `<span class="wx-layer wx-wind" data-v="wind">${icon("wi-strong-wind")}<span class="wx-val">${Math.round(s.wind)} ${units.windLabel}</span></span>`;
			case "uv":
				return `<span class="wx-layer wx-uv" data-v="uv" style="color:${uvColor(s.uv)}">${icon("wi-hot")}<span class="wx-val">UV ${Math.round(s.uv)}</span></span>`;
			default:
				return "";
		}
	}

	// Cloud deck: thicker with cloud cover, grayer with rain chance; drops fall from its underside
	function skyOverlay (id, hrs, g, units, day) {
		const deckBottom = (h) => 1.5 + h.cloud * 0.075;
		const bottom = edgePoints(hrs, g, deckBottom);
		let s = `<defs>${gradient(id, hrs, g, deckColor)}</defs>`
			+ `<path d="M0,1.5 L${WIDTH},1.5 ${smooth([...bottom].reverse()).replace(/^M/, "L")} Z" fill="url(#${id})"/>`;

		hrs.forEach((h) => {
			const a = toInches(h.amt, units.precip);
			if (a < 0.005) return;
			const n = Math.min(6, Math.max(1, Math.round(a / 0.04)));
			const len = Math.min(7, 2 + a * 18);
			const slant = Math.min(6, toMph(h.wind, units.wind) / 3.5);
			const left = (h.hr - g.start) * g.step;
			for (let k = 0; k < n; k++) {
				const px = left + rnd(h.hr, day, k) * g.step + slant / 2;
				const py = deckBottom(h) + 0.5 + rnd(h.hr, day, k + 9) * 4;
				s += `<line x1="${r2(px)}" y1="${r2(py)}" x2="${r2(px - slant * len / 5)}" y2="${r2(py + len)}" stroke="#85B7EB" stroke-width="1.1" stroke-linecap="round"/>`;
			}
		});
		return s;
	}

	function windOverlay (hrs, g, units, k) {
		const pts = hrs.map((h) => [r2(g.X(h.hr)), r2(29 - Math.min(26, toMph(h.wind, units.wind) * 0.9))]);
		// The line runs mostly sideways, so undo the vertical squash on its thickness
		return `<path d="${smooth(pts)}" fill="none" stroke="#fff" stroke-width="${r2(1.2 / k)}" stroke-dasharray="2 2"/>`;
	}

	function uvOverlay (hrs, g, Y) {
		return hrs
			.filter((h) => h.uv >= 0.8)
			.map((h) => {
				const x = r2(g.X(h.hr));
				const y = Y(h.temp) - 1.5;
				return `<line x1="${x}" y1="${r2(y)}" x2="${x}" y2="${r2(y - Math.min(14, h.uv * 1.3))}" stroke="${uvColor(h.uv)}" stroke-width="1.6" stroke-linecap="round"/>`;
			})
			.join("");
	}

	function ribbonSvg (id, hrs, pages, g, wkMin, span, units, day, chartHeight) {
		const Y = (t) => BASE - (4 + ((t - wkMin) / span) * 18);
		const pts = edgePoints(hrs, g, (h) => Y(h.temp));
		const layers = {
			sky: () => skyOverlay(`${id}-sky`, hrs, g, units, day),
			wind: () => windOverlay(hrs, g, units, chartHeight / HEIGHT),
			uv: () => uvOverlay(hrs, g, Y)
		};

		// Drawn at the standard height, then squashed vertically to wxChartHeight
		return `<svg viewBox="0 0 ${WIDTH} ${chartHeight}"><defs>${gradient(id, hrs, g, (h) => tempColor(h.temp, units))}</defs>`
			+ `<g transform="scale(1 ${r2(chartHeight / HEIGHT)})">`
			+ `<path d="${smooth(pts)} L${WIDTH},${BASE} L0,${BASE} Z" fill="url(#${id})"/>`
			+ pages.map((v) => `<g class="wx-layer" data-v="${v}">${layers[v]()}</g>`).join("")
			+ "</g></svg>";
	}

	function decorate (m, div) {
		const st = state[m.identifier];
		const list = div.querySelector(".wx-list");
		if (list) list.style.setProperty("--wx-fade", `${cfg(m, "wxFadeSeconds")}s`);

		const rows = [...div.querySelectorAll(".wx-row")];
		if (!st.hourly || !rows.length) return;

		st.renders++;
		const g = geometry(m);
		const { units } = st.hourly;
		const days = rows.map((row) => (st.hourly.days[row.dataset.date] || []).filter((h) => h.hr >= g.start && h.hr < g.end));
		const temps = days.flatMap((d) => d.map((h) => h.temp));
		if (!temps.length) return;
		const wkMin = Math.min(...temps);
		const span = (Math.max(...temps) - wkMin) || 1;
		const chartHeight = Math.max(12, Math.min(60, parseFloat(cfg(m, "wxChartHeight")) || HEIGHT));
		const showClouds = cfg(m, "wxShowClouds") !== false;

		rows.forEach((row, i) => {
			// With clouds turned off, the deck follows rain chance instead of cloud cover
			const hrs = showClouds ? days[i] : days[i].map((h) => ({ ...h, cloud: h.prob }));
			if (!hrs.length) return;
			const s = summarize(m, hrs);
			row.dataset.q = s.pages.join(" ");
			const slot = row.querySelector(".wx-slot");
			s.pages.forEach((v) => slot.insertAdjacentHTML("beforeend", slotHtml(v, s, units)));
			const id = `wxg-${m.identifier}-${st.renders}-${i}`;
			row.querySelector(".wx-ribbon").innerHTML = ribbonSvg(id, hrs, s.pages, g, wkMin, span, units, i, chartHeight);
		});

		st.pages = PAGES.filter((p) => rows.some((r) => (r.dataset.q || "").split(" ").includes(p)));
		show(m, div);
	}

	// Fade in the current page's layers and fade out the rest
	function show (m, root) {
		const st = state[m.identifier];
		if (!root) return;
		const page = st.pages.length ? st.pages[st.t % st.pages.length] : null;
		root.querySelectorAll(".wx-row").forEach((row) => {
			const q = (row.dataset.q || "").split(" ");
			const active = page && q.includes(page) ? page : "wx";
			row.querySelectorAll(".wx-layer").forEach((el) => {
				el.style.opacity = el.dataset.v === active ? "1" : "0";
			});
		});
	}

	function init (m) {
		const st = (state[m.identifier] = { hourly: null, pages: [], t: 0, renders: 0 });

		// Decorate every render of this module, whatever triggered it
		const stockGetDom = m.getDom.bind(m);
		m.getDom = async function () {
			const div = await stockGetDom();
			try {
				decorate(m, div);
			} catch (error) {
				Log.error(`[wx-forecast] ${error.message}`);
			}
			return div;
		};

		loadHourly(m);
		setInterval(() => loadHourly(m), m.config.updateInterval);

		setInterval(() => {
			if (st.pages.length < 2) return;
			st.t++;
			show(m, document.getElementById(m.identifier));
		}, cfg(m, "wxPageSeconds") * 1000);
	}

	/* ---------- hooks called by the stock weather module ---------- */

	const otherInit = window.initWeatherTheme;
	const otherUpdate = window.updateWeatherTheme;

	window.initWeatherTheme = (m) => {
		if (isOurs(m)) init(m);
		else if (otherInit) otherInit(m);
	};

	window.updateWeatherTheme = (m) => {
		if (isOurs(m)) m.updateDom(0);
		else if (otherUpdate) otherUpdate(m);
		else m.updateDom(300); // stock behavior for every other weather module
	};
}());
