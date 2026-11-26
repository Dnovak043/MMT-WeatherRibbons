/* global Log */
/*
 * MMT-WeatherRibbons / wx-forecast.js: theme script for MagicMirror's stock weather module.
 * Loaded through the module's own theme settings (themeDir + themeCustomScripts).
 *
 * type: "forecast": each day gets a smooth hourly temperature ribbon, with clouds-and-rain /
 * wind / UV overlays and icons that crossfade in rotation.
 *
 * type: "current": the current icon and temperature, a plain-language line for anything
 * notable later today, and today's ribbon with a now marker, sunrise and sunset, and
 * clouds-and-rain / wind / UV / feels-like overlays in rotation.
 *
 * Hourly data comes straight from Open-Meteo, because the stock module only keeps daily or
 * current data. Weather modules on the same location share one request. Only weather modules
 * that list this script in themeCustomScripts are affected; any other weather module on the
 * page behaves as stock.
 */
(function () {
	// Load once, even if two modules list the script with different ?v= numbers
	if (window.wxRibbonsLoaded) return;
	window.wxRibbonsLoaded = true;

	const SCRIPT = "wx-forecast.js";
	const FORECAST_PAGES = ["sky", "wind", "uv"];
	const CURRENT_PAGES = ["sky", "wind", "uv", "feels"];
	const HOURLY = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "cloud_cover", "wind_speed_10m", "uv_index"];
	const DEFAULTS = {
		// Chart: when an overlay appears
		wxMinUV: 4,
		wxMinWind: 5,
		wxMinRainChance: 30,
		wxMinRainAmount: 0.02,
		wxMinCloudCover: 50,
		wxMinFeelsDiff: 3,
		// Current view: when an overlay also gets a sentence
		wxAlertUV: 6,
		wxAlertWind: 20,
		wxAlertRainChance: 60,
		wxAlertFeelsDiff: 6,
		// What can appear
		wxShowRain: true,
		wxShowClouds: true,
		wxShowWind: true,
		wxShowUV: true,
		wxShowFeels: true,
		// Layout
		wxWidth: 20,
		wxDaySpacing: 0.8,
		wxChartHeight: null, // 35 in the forecast view, 60 in the current view
		wxStartHour: 0,
		wxEndHour: 24,
		// Rotation
		wxPageSeconds: 8,
		wxFadeSeconds: 1.2
	};

	// Ribbon drawing area, in SVG units
	const WIDTH = 240;
	const HEIGHT = 35;
	const BASE = 32; // bottom of the ribbon

	const state = {};
	const isOurs = (m) => (m.config.themeCustomScripts || []).some((s) => String(s).split("?")[0].endsWith(SCRIPT));
	const isCurrent = (m) => String(m.config.type).toLowerCase() === "current";
	const cfg = (m, key) => m.config[key] ?? DEFAULTS[key];
	const shows = (m, what) => cfg(m, `wxShow${what}`) !== false;

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
	const RAIN_BLUE = "#85B7EB";
	const SUN_GOLD = "#FAC775";
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
	const peakOf = (hrs, key) => hrs.reduce((a, h) => (h[key] > a[key] ? h : a), hrs[0]);

	// A number is in em (scales with tableClass); a string is any CSS length, like "400px"
	function setLength (el, prop, value) {
		if (typeof value === "number" && value >= 0) el.style.setProperty(prop, `${value}em`);
		else if (typeof value === "string" && value.trim()) el.style.setProperty(prop, value.trim());
	}

	// Displayed hours, from config (wxStartHour inclusive, wxEndHour exclusive)
	function geometry (m) {
		const start = Math.max(0, Math.min(23, parseInt(cfg(m, "wxStartHour"), 10) || 0));
		let end = parseInt(cfg(m, "wxEndHour"), 10);
		if (!(end > start) || end > 24) end = 24;
		const step = WIDTH / (end - start);
		return { start, end, step, X: (hr) => (hr - start + 0.5) * step, edge: (hr) => (hr - start) * step };
	}

	/* ---------- data (shared by all weather modules on the same location) ---------- */

	const requests = {};

	function unitsFor (c) {
		const units = {
			temp: c.tempUnits === "imperial" ? "fahrenheit" : "celsius",
			wind: { imperial: "mph", kmh: "kmh", knots: "kn" }[c.windUnits] || "ms",
			precip: c.units === "imperial" ? "inch" : "mm"
		};
		units.windLabel = { mph: "mph", kmh: "km/h", kn: "kn", ms: "m/s" }[units.wind];
		return units;
	}

	function fetchHourly (c, units) {
		const params = new URLSearchParams({
			latitude: c.lat,
			longitude: c.lon,
			hourly: HOURLY.join(","),
			daily: "sunrise,sunset",
			temperature_unit: units.temp,
			wind_speed_unit: units.wind,
			precipitation_unit: units.precip,
			timezone: "auto",
			timeformat: "unixtime",
			forecast_days: Math.min(16, Math.max(2, (parseInt(c.maxNumberOfDays, 10) || 5) + 1))
		});
		const url = `https://api.open-meteo.com/v1/forecast?${params}`;
		const key = `${c.lat},${c.lon},${units.temp},${units.wind},${units.precip}`;
		const cached = requests[key];
		// Reuse a request made in the last minute, or a longer one from another module
		if (cached && Date.now() - cached.at < 60000 && cached.days >= params.get("forecast_days")) return cached.promise;
		const promise = fetch(url).then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		});
		requests[key] = { at: Date.now(), days: params.get("forecast_days"), promise };
		promise.catch(() => delete requests[key]);
		return promise;
	}

	async function loadHourly (m) {
		const st = state[m.identifier];
		const units = unitsFor(m.config);
		try {
			const data = await fetchHourly(m.config, units);
			const h = data.hourly;
			const offset = data.utc_offset_seconds || 0;
			const localDate = (t) => new Date((t + offset) * 1000);
			const days = {};
			const sun = {};

			h.time.forEach((t, k) => {
				if (h.temperature_2m[k] == null) return;
				const local = localDate(t);
				const key = local.toISOString().slice(0, 10);
				(days[key] ||= []).push({
					hr: local.getUTCHours(),
					temp: h.temperature_2m[k],
					feels: h.apparent_temperature[k] ?? h.temperature_2m[k],
					prob: h.precipitation_probability[k] ?? 0,
					amt: h.precipitation[k] ?? 0,
					cloud: h.cloud_cover[k] ?? 0,
					wind: h.wind_speed_10m[k] ?? 0,
					uv: h.uv_index[k] ?? 0
				});
			});

			const hourOf = (t) => {
				const d = localDate(t);
				return d.getUTCHours() + d.getUTCMinutes() / 60;
			};
			(data.daily?.time || []).forEach((t, k) => {
				const key = localDate(t).toISOString().slice(0, 10);
				sun[key] = { rise: data.daily.sunrise[k] != null ? hourOf(data.daily.sunrise[k]) : null, set: data.daily.sunset[k] != null ? hourOf(data.daily.sunset[k]) : null };
			});

			st.hourly = { days, sun, units, offset };
			m.updateDom(0);
		} catch (error) {
			Log.error(`[wx-forecast] Could not load hourly data: ${error.message}`);
		}
	}

	// The location's current date and hour (fractional)
	function localNow (offset) {
		const d = new Date(Date.now() + offset * 1000);
		return { key: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60 };
	}

	/* ---------- overlays (drawn in the 240 x 35 ribbon space) ---------- */

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
			const left = g.edge(h.hr);
			for (let k = 0; k < n; k++) {
				const px = left + rnd(h.hr, day, k) * g.step + slant / 2;
				const py = deckBottom(h) + 0.5 + rnd(h.hr, day, k + 9) * 4;
				s += `<line x1="${r2(px)}" y1="${r2(py)}" x2="${r2(px - slant * len / 5)}" y2="${r2(py + len)}" stroke="${RAIN_BLUE}" stroke-width="1.1" stroke-linecap="round"/>`;
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

	// Feels-like: a white line at the feels-like temperature, with the gap to the ribbon darkened
	function feelsOverlay (hrs, g, Y, k) {
		const top = edgePoints(hrs, g, (h) => Y(h.temp));
		const feels = edgePoints(hrs, g, (h) => Y(h.feels));
		return `<path d="${smooth(top)} ${smooth([...feels].reverse()).replace(/^M/, "L")} Z" fill="#000" opacity="0.5"/>`
			+ `<path d="${smooth(feels)}" fill="none" stroke="#fff" stroke-width="${r2(1.3 / k)}"/>`;
	}

	/* ---------- forecast view ---------- */

	function summarize (m, hrs) {
		const s = {
			rain: max(hrs.map((h) => h.prob)),
			rainAmount: max(hrs.map((h) => h.amt)),
			clouds: avg(hrs.map((h) => h.cloud)),
			wind: max(hrs.map((h) => h.wind)),
			uv: max(hrs.map((h) => h.uv))
		};
		s.rainQ = shows(m, "Rain") && (s.rain > cfg(m, "wxMinRainChance") || s.rainAmount >= cfg(m, "wxMinRainAmount"));
		s.cloudQ = shows(m, "Clouds") && s.clouds > cfg(m, "wxMinCloudCover");
		s.pages = [];
		if (s.rainQ || s.cloudQ) s.pages.push("sky");
		if (shows(m, "Wind") && s.wind > cfg(m, "wxMinWind")) s.pages.push("wind");
		if (shows(m, "UV") && s.uv > cfg(m, "wxMinUV")) s.pages.push("uv");
		return s;
	}

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

	function ribbonSvg (id, hrs, pages, g, wkMin, span, units, day, chartHeight) {
		const Y = (t) => BASE - (4 + ((t - wkMin) / span) * 18);
		const k = chartHeight / HEIGHT;
		const pts = edgePoints(hrs, g, (h) => Y(h.temp));
		const layers = {
			sky: () => skyOverlay(`${id}-sky`, hrs, g, units, day),
			wind: () => windOverlay(hrs, g, units, k),
			uv: () => uvOverlay(hrs, g, Y)
		};

		// Drawn at the standard height, then squashed vertically to wxChartHeight
		return `<svg viewBox="0 0 ${WIDTH} ${chartHeight}"><defs>${gradient(id, hrs, g, (h) => tempColor(h.temp, units))}</defs>`
			+ `<g transform="scale(1 ${r2(k)})">`
			+ `<path d="${smooth(pts)} L${WIDTH},${BASE} L0,${BASE} Z" fill="url(#${id})"/>`
			+ pages.map((v) => `<g class="wx-layer" data-v="${v}">${layers[v]()}</g>`).join("")
			+ "</g></svg>";
	}

	// With rain or clouds turned off, adjust what the deck shows
	function forDrawing (m, hrs) {
		const showRain = shows(m, "Rain");
		const showClouds = shows(m, "Clouds");
		return hrs.map((h) => ({
			...h,
			prob: showRain ? h.prob : 0,
			amt: showRain ? h.amt : 0,
			cloud: showClouds ? h.cloud : h.prob
		}));
	}

	function decorateForecast (m, div) {
		const st = state[m.identifier];
		const list = div.querySelector(".wx-list");
		if (list) {
			list.style.setProperty("--wx-fade", `${cfg(m, "wxFadeSeconds")}s`);
			setLength(list, "--wx-width", cfg(m, "wxWidth"));
			setLength(list, "--wx-day-spacing", cfg(m, "wxDaySpacing"));
		}

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
		const chartHeight = Math.max(12, Math.min(120, parseFloat(cfg(m, "wxChartHeight")) || HEIGHT));

		rows.forEach((row, i) => {
			const hrs = forDrawing(m, days[i]);
			if (!hrs.length) return;
			const s = summarize(m, hrs);
			row.dataset.q = s.pages.join(" ");
			const slot = row.querySelector(".wx-slot");
			s.pages.forEach((v) => slot.insertAdjacentHTML("beforeend", slotHtml(v, s, units)));
			const id = `wxg-${m.identifier}-${st.renders}-${i}`;
			row.querySelector(".wx-ribbon").innerHTML = ribbonSvg(id, hrs, s.pages, g, wkMin, span, units, i, chartHeight);
		});

		st.pages = FORECAST_PAGES.filter((p) => rows.some((r) => (r.dataset.q || "").split(" ").includes(p)));
		show(m, div);
	}

	/* ---------- current view ---------- */

	const pad2 = (n) => String(n).padStart(2, "0");

	function clockHour (m, hr) {
		const h = Math.floor(hr) % 24;
		if (String(m.config.timeFormat) === "24") return `${pad2(h)}:00`;
		if (h === 0) return "midnight";
		if (h === 12) return "noon";
		return `${h % 12} ${h < 12 ? "am" : "pm"}`;
	}

	function partOfDay (hr) {
		if (hr >= 18) return "tonight";
		if (hr >= 12) return "this afternoon";
		return "this morning";
	}

	function axisLabel (m, hr) {
		const h = hr % 24;
		if (String(m.config.timeFormat) === "24") return pad2(h);
		if (h === 0) return "12a";
		if (h === 12) return "12p";
		return `${h % 12}${h < 12 ? "a" : "p"}`;
	}

	// Which pages apply over the rest of today, and the sentence for each (if over its alert threshold)
	function currentPages (m, ahead, units) {
		const pages = [];
		const sentence = {};
		const unitT = "°";

		if (shows(m, "Rain") || shows(m, "Clouds")) {
			const pk = peakOf(ahead, "prob");
			const rainQ = shows(m, "Rain") && (pk.prob > cfg(m, "wxMinRainChance") || max(ahead.map((h) => h.amt)) >= cfg(m, "wxMinRainAmount"));
			const cloudQ = shows(m, "Clouds") && avg(ahead.map((h) => h.cloud)) > cfg(m, "wxMinCloudCover");
			if (rainQ || cloudQ) pages.push("sky");
			if (rainQ && pk.prob > cfg(m, "wxAlertRainChance")) {
				const limit = cfg(m, "wxMinRainChance");
				const start = ahead.find((h) => h.prob > limit) || pk;
				if (start === ahead[0]) {
					const end = ahead.find((h) => h.prob <= limit);
					sentence.sky = ["wi-raindrop", "wx-rain", end ? `${Math.round(pk.prob)}% chance of rain until ${clockHour(m, end.hr)}` : `${Math.round(pk.prob)}% chance of rain through ${partOfDay(ahead[ahead.length - 1].hr).replace("this ", "")}`];
				} else {
					sentence.sky = ["wi-raindrop", "wx-rain", `${Math.round(pk.prob)}% chance of rain ${partOfDay(start.hr)} around ${clockHour(m, start.hr)}`];
				}
			}
		}

		if (shows(m, "Wind")) {
			const pk = peakOf(ahead, "wind");
			if (pk.wind > cfg(m, "wxMinWind")) {
				pages.push("wind");
				if (pk.wind > cfg(m, "wxAlertWind")) sentence.wind = ["wi-strong-wind", "wx-wind", `Winds up to ${Math.round(pk.wind)} ${units.windLabel} ${partOfDay(pk.hr)}`];
			}
		}

		if (shows(m, "UV")) {
			const pk = peakOf(ahead, "uv");
			if (pk.uv > cfg(m, "wxMinUV")) {
				pages.push("uv");
				if (pk.uv > cfg(m, "wxAlertUV")) sentence.uv = ["wi-hot", "wx-uv", `UV up to ${Math.round(pk.uv)} around ${clockHour(m, pk.hr)}`, uvColor(pk.uv)];
			}
		}

		if (shows(m, "Feels")) {
			const pk = ahead.reduce((a, h) => (Math.abs(h.temp - h.feels) > Math.abs(a.temp - a.feels) ? h : a), ahead[0]);
			const diff = Math.abs(pk.temp - pk.feels);
			if (diff >= cfg(m, "wxMinFeelsDiff")) {
				pages.push("feels");
				if (diff >= cfg(m, "wxAlertFeelsDiff")) sentence.feels = ["wi-thermometer", "wx-feels", `Feels like ${Math.round(pk.feels)}${unitT} ${partOfDay(pk.hr)}`];
			}
		}

		return { pages, sentence };
	}

	function decorateCurrent (m, div) {
		const st = state[m.identifier];
		const root = div.querySelector(".wx-cur");
		if (!root) return;
		root.style.setProperty("--wx-fade", `${cfg(m, "wxFadeSeconds")}s`);
		setLength(root, "--wx-width", cfg(m, "wxWidth"));
		setLength(root, "--wx-day-spacing", cfg(m, "wxDaySpacing")); // space between sections here
		if (!st.hourly) return;

		const g = geometry(m);
		const { units } = st.hourly;
		const now = localNow(st.hourly.offset);
		const hrs = forDrawing(m, (st.hourly.days[now.key] || []).filter((h) => h.hr >= g.start && h.hr < g.end));
		if (!hrs.length) return;
		let ahead = hrs.filter((h) => h.hr >= Math.floor(now.hour));
		if (!ahead.length) ahead = [hrs[hrs.length - 1]];

		st.renders++;
		const { pages, sentence } = currentPages(m, ahead, units);
		st.pages = pages;

		// Sentence line: one layer per page; hidden entirely if no page has a sentence
		const line = root.querySelector(".wx-cur-alerts");
		if (Object.keys(sentence).length) {
			line.innerHTML = pages.map((p) => {
				const s = sentence[p];
				if (!s) return `<span class="wx-layer" data-v="${p}"></span>`;
				const color = s[3] ? ` style="color:${s[3]}"` : "";
				return `<span class="wx-layer" data-v="${p}"><span class="wi ${s[0]} ${s[1]}"${color}></span> ${s[2]}</span>`;
			}).join("");
		} else {
			line.remove();
		}

		// Ribbon scale covers both temperature and feels-like
		const values = hrs.flatMap((h) => (shows(m, "Feels") ? [h.temp, h.feels] : [h.temp]));
		const lo = Math.min(...values);
		const span = (Math.max(...values) - lo) || 1;
		const Y = (t) => BASE - (4 + ((t - lo) / span) * 22);
		// wxChartHeight, like the forecast (wxCurrentChartHeight still works, from an earlier version)
		const chartHeight = Math.max(12, Math.min(120, parseFloat(m.config.wxChartHeight ?? m.config.wxCurrentChartHeight) || 60));
		const k = chartHeight / HEIGHT;
		const id = `wxc-${m.identifier}-${st.renders}`;
		const pts = edgePoints(hrs, g, (h) => Y(h.temp));
		const nowX = Math.max(0, Math.min(WIDTH, (now.hour - g.start) * g.step));

		// Low and high, labeled at the hours they happen
		const low = hrs.reduce((a, h) => (h.temp < a.temp ? h : a), hrs[0]);
		const high = hrs.reduce((a, h) => (h.temp > a.temp ? h : a), hrs[0]);
		const labelY = chartHeight + 11;
		const fmt = (t) => `${Math.round(t)}°`;

		// Upcoming sunrise / sunset, placed in the label row (one row lower if it would sit on a label)
		const sunToday = st.hourly.sun[now.key] || {};
		const suns = [["rise", "wi-sunrise"], ["set", "wi-sunset"]]
			.map(([k2, icon]) => ({ hr: sunToday[k2], icon }))
			.filter((s) => s.hr != null && s.hr > now.hour && s.hr >= g.start && s.hr < g.end)
			.map((s) => {
				const x = g.edge(s.hr);
				const clash = [g.X(low.hr), g.X(high.hr)].some((lx) => Math.abs(lx - x) < 16);
				return { ...s, x, y: clash ? labelY + 13 : labelY - 4 };
			});
		const viewH = suns.some((s) => s.y > labelY) ? labelY + 20 : labelY + 5;

		const layers = {
			sky: () => skyOverlay(`${id}-sky`, hrs, g, units, 0),
			wind: () => windOverlay(hrs, g, units, k),
			uv: () => uvOverlay(hrs, g, Y),
			feels: () => feelsOverlay(hrs, g, Y, k)
		};

		const svg = `<svg viewBox="0 0 ${WIDTH} ${viewH}"><defs>${gradient(id, hrs, g, (h) => tempColor(h.temp, units))}</defs>`
			+ `<g transform="scale(1 ${r2(k)})">`
			+ `<path d="${smooth(pts)} L${WIDTH},${BASE} L0,${BASE} Z" fill="url(#${id})"/>`
			+ pages.map((p) => `<g class="wx-layer" data-v="${p}">${layers[p]()}</g>`).join("")
			+ `<rect x="0" y="0" width="${r2(nowX)}" height="${BASE}" fill="#000" opacity="0.5"/>`
			+ "</g>"
			+ `<line class="wx-now" x1="${r2(nowX)}" y1="0" x2="${r2(nowX)}" y2="${r2(chartHeight + 2)}"/>`
			+ `<text class="wx-low" x="${r2(g.X(low.hr))}" y="${labelY}" text-anchor="middle">${fmt(low.temp)}</text>`
			+ `<text class="wx-high" x="${r2(g.X(high.hr))}" y="${labelY}" text-anchor="middle">${fmt(high.temp)}</text>`
			+ "</svg>";

		const sunHtml = suns.map((s) => `<span class="wi ${s.icon} wx-sun" style="left:${r2((s.x / WIDTH) * 100)}%;top:${r2((s.y / viewH) * 100)}%"></span>`).join("");

		const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(g.start + f * (g.end - g.start)));
		root.querySelector(".wx-cur-axis").innerHTML = ticks.map((t) => `<span>${axisLabel(m, t)}</span>`).join("");
		root.querySelector(".wx-cur-chart").innerHTML = svg + sunHtml;

		show(m, div);
	}

	/* ---------- rotation ---------- */

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

		root.querySelectorAll(".wx-cur .wx-layer").forEach((el) => {
			el.style.opacity = el.dataset.v === page ? "1" : "0";
		});
	}

	function init (m) {
		const period = Math.max(2, parseFloat(cfg(m, "wxPageSeconds")) || 8) * 1000;
		// Pages switch on the clock, so every themed weather module turns at the same moment
		const st = (state[m.identifier] = { hourly: null, pages: [], t: Math.floor(Date.now() / period), renders: 0 });

		// Decorate every render of this module, whatever triggered it
		const stockGetDom = m.getDom.bind(m);
		m.getDom = async function () {
			const div = await stockGetDom();
			try {
				if (isCurrent(m)) decorateCurrent(m, div);
				else decorateForecast(m, div);
			} catch (error) {
				Log.error(`[wx-forecast] ${error.message}`);
			}
			return div;
		};

		loadHourly(m);
		setInterval(() => loadHourly(m), m.config.updateInterval);

		const tick = () => {
			st.t = Math.floor(Date.now() / period);
			if (st.pages.length > 1) show(m, document.getElementById(m.identifier));
		};
		setTimeout(() => {
			tick();
			setInterval(tick, period);
		}, period - (Date.now() % period) + 50);

		// The current view's now marker moves; redraw it every 10 minutes
		if (isCurrent(m)) setInterval(() => m.updateDom(0), 10 * 60 * 1000);
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
