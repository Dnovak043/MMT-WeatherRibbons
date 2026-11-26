# MMT-WeatherRibbons

A theme for MagicMirror²'s built-in `weather` module (`type: "forecast"`). It isn't a separate module: it uses the weather module's own `themeDir` and `themeCustomScripts` settings, so nothing in `defaultmodules` is edited and MagicMirror updates don't touch it.

Each forecast day gets a smooth hourly temperature ribbon. The ribbon and temperatures stay put, while overlays crossfade in rotation:

- **Clouds and rain:** a cloud deck that thickens with cloud cover and grays with rain chance, with drops for rain intensity that lean with the wind
- **Wind:** a dashed line of hourly wind speed
- **UV:** rays rising off the ribbon, colored by UV risk

An overlay only appears for days that cross your thresholds, and a page is skipped when no day qualifies.

## Install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/Dnovak043/MMT-WeatherRibbons.git
```

It goes in `modules/` like any theme, but it isn't a module. MagicMirror only runs modules listed in `config.js`, so this folder does nothing until the weather module points at it.

Then set up the weather module in `config/config.js`:

```js
{
  module: "weather",
  position: "top_right",
  classes: "wx-forecast",
  config: {
    weatherProvider: "openmeteo",
    type: "forecast",
    lat: 37.7974786,
    lon: -122.4134004,
    maxNumberOfDays: 7,
    units: "imperial",
    roundTemp: true,
    themeDir: "../../../modules/MMT-WeatherRibbons",
    themeCustomScripts: ["wx-forecast.js?v=1"],
    wxStartHour: 0,
    wxEndHour: 24,
    wxWidth: 20,
    wxDaySpacing: 0.8,
    wxChartHeight: 35,
    wxShowRain: true,
    wxShowClouds: true,
    wxShowWind: true,
    wxShowUV: true,
    wxMinUV: 4,
    wxMinWind: 5,
    wxMinRainChance: 30,
    wxMinRainAmount: 0.02,
    wxMinCloudCover: 50,
    wxPageSeconds: 8,
    wxFadeSeconds: 1.2,
  }
},
```

Restart MagicMirror.

`themeDir` is relative to the weather module's folder (`defaultmodules/weather/`), as the [weather module docs](https://docs.magicmirror.builders/modules/weather.html#themes) describe.

## Update

```bash
cd ~/MagicMirror/modules/MMT-WeatherRibbons && git pull
```

Then bump the number in `themeCustomScripts` (for example `?v=2`) so the mirror doesn't keep a cached copy of the old script, and restart MagicMirror.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `wxStartHour` | `0` | First hour shown on the ribbon (0 = midnight) |
| `wxEndHour` | `24` | Hour the ribbon ends (24 = midnight). Thresholds only look at the shown hours. |
| `wxWidth` | `20` | Width of the list. A number is in em, so it scales with `tableClass`; a string is any CSS width, like `"400px"`. Ribbons get taller with it so nothing stretches. Below about 12em long day names are cut short with "…"; the temperatures and value always stay on one line. |
| `wxDaySpacing` | `0.8` | Space below each day, in em (or a CSS length string like `"16px"`) |
| `wxChartHeight` | `35` | Ribbon height, 12–60. Lower is shorter. |
| `wxShowRain` | `true` | `false` hides rain (chance and drops). The deck then shows cloud cover only. |
| `wxShowClouds` | `true` | `false` hides cloud cover. The deck then follows rain chance. |
| `wxShowWind` | `true` | `false` removes the wind page |
| `wxShowUV` | `true` | `false` removes the UV page |
| `wxMinUV` | `4` | Show UV when the day's peak is above this |
| `wxMinWind` | `5` | Show wind when the day's peak is above this, in your `windUnits` |
| `wxMinRainChance` | `30` | Show rain when the day's peak chance (%) is above this |
| `wxMinRainAmount` | `0.02` | ...or when any hour reaches this much rain (inches with `units: "imperial"`, otherwise mm) |
| `wxMinCloudCover` | `50` | Show clouds when the day's average cover (%) is above this |
| `wxPageSeconds` | `8` | Seconds per page |
| `wxFadeSeconds` | `1.2` | Crossfade length in seconds |

Stock settings that still apply: `tableClass` (text size), `maxNumberOfDays`, `roundTemp`, `ignoreToday`, `forecastDateFormat`, `units`, `tempUnits`, `windUnits`.

## Styling

`weather.css` holds MagicMirror's stock weather styles plus this theme's layout, and the module loads it automatically. For your own tweaks, use `config/custom.css`, which loads afterwards.

Each day reads `DAY  LOW / HIGH  …  VARIABLE`, with the ribbon underneath. The layout uses MagicMirror's color variables and `em` sizes, follows `tableClass`, and lines up with its region (right, left, center or bar).

## How it works

- `forecast.njk` is the stock forecast template with an icon slot and an empty ribbon for each day.
- `current.njk` and `hourly.njk` are unchanged copies of the stock templates. The docs ask for all four files in a theme folder; this theme only changes the forecast view.
- `wx-forecast.js` hooks the module's `initWeatherTheme` and `updateWeatherTheme`. It fetches hourly data straight from Open-Meteo (the stock module discards hourly data for forecasts), draws the ribbons, and runs the rotation. It only takes over weather modules that list it in `themeCustomScripts`; any other weather module on the page works as stock.
- The extra Open-Meteo request asks only for six hourly values (about 8 KB), on the module's `updateInterval`.

## License

MIT. `weather.css` includes MagicMirror²'s stock weather styles, MIT License, Copyright © 2016-2026 Michael Teeuw.
