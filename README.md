# MMT-WeatherRibbons

A theme for MagicMirror²'s built-in `weather` module, for `type: "forecast"` and `type: "current"`. It isn't a separate module: it uses the weather module's own `themeDir` and `themeCustomScripts` settings, so nothing in `defaultmodules` is edited and MagicMirror updates don't touch it.

Each forecast day gets a smooth hourly temperature ribbon. The ribbon and temperatures stay put, while overlays crossfade in rotation:

- **Clouds and rain:** a cloud deck that thickens with cloud cover and grays with rain chance, with drops for rain intensity that lean with the wind
- **Wind:** a dashed line of hourly wind speed
- **UV:** rays rising off the ribbon, colored by UV risk

An overlay only appears for days that cross your thresholds, and a page is skipped when no day qualifies.

The **current** view shows the current icon and temperature, a plain-language line for anything notable later today ("82% chance of rain tonight around 6 pm", "Winds up to 22 mph this afternoon"), and today's ribbon. The ribbon dims the hours that have passed, marks the current time, labels the low and high, and shows an icon for the upcoming sunrise and sunset. Its overlays rotate through clouds and rain, wind, UV, and feels-like, and the sentence changes with each page. A sentence only appears when a value crosses its alert threshold, and the line disappears when nothing does.

Both views can run at once. They share one Open-Meteo request and switch pages at the same moment.

## Install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/Dnovak043/MMT-WeatherRibbons.git
```

It goes in `modules/` like any theme, but it isn't a module. MagicMirror only runs modules listed in `config.js`, so this folder does nothing until the weather module points at it.

Then set up the weather modules in `config/config.js`. Current view:

```js
{
  module: "weather",
  position: "top_right",
  config: {
    weatherProvider: "openmeteo",
    type: "current",
    lat: 37.7974786,
    lon: -122.4134004,
    units: "imperial",
    roundTemp: true,
    themeDir: "../../../modules/MMT-WeatherRibbons",
    themeCustomScripts: ["wx-forecast.js"],
    wxCurrentChartHeight: 60,
    wxAlertRainChance: 60,
    wxAlertWind: 20,
    wxAlertUV: 6,
    wxAlertFeelsDiff: 6,
  }
},
```

Forecast view:

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
    themeCustomScripts: ["wx-forecast.js"],
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

Then restart MagicMirror.

Write `themeCustomScripts` exactly as `["wx-forecast.js"]`. MagicMirror decides how to load a file from the text after the last dot, so something like `wx-forecast.js?v=2` is silently skipped and the theme switches off.

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
| `wxMinFeelsDiff` | `3` | Current view: show feels-like when it differs from the temperature by at least this many degrees |
| `wxAlertRainChance` | `60` | Current view: rain gets a sentence above this chance (%) |
| `wxAlertWind` | `20` | Current view: wind gets a sentence above this speed |
| `wxAlertUV` | `6` | Current view: UV gets a sentence above this |
| `wxAlertFeelsDiff` | `6` | Current view: feels-like gets a sentence at this many degrees of difference |
| `wxShowFeels` | `true` | Current view: `false` removes the feels-like page |
| `wxCurrentChartHeight` | `60` | Current view: ribbon height, 20–120 |
| `wxPageSeconds` | `8` | Seconds per page |
| `wxFadeSeconds` | `1.2` | Crossfade length in seconds |

In the current view, the `wxMin…` thresholds look at the rest of today, so the UV page goes away after sunset and the rain page once the rain has passed. Each module has its own config, so the two views can use different thresholds.

Stock settings that still apply: `tableClass` (text size), `maxNumberOfDays`, `roundTemp`, `ignoreToday`, `forecastDateFormat`, `units`, `tempUnits`, `windUnits`.

## Styling

`weather.css` holds MagicMirror's stock weather styles plus this theme's layout, and the module loads it automatically. For your own tweaks, use `config/custom.css`, which loads afterwards.

Each day reads `DAY  LOW / HIGH  …  VARIABLE`, with the ribbon underneath. The layout uses MagicMirror's color variables and `em` sizes, follows `tableClass`, and lines up with its region (right, left, center or bar).

## How it works

- `forecast.njk` is the stock forecast template with an icon slot and an empty ribbon for each day.
- `current.njk` keeps the stock icon-and-temperature markup and adds empty spots for the sentence and ribbon. The stock current view's wind, humidity, sunrise/sunset row, feels-like line and indoor readings are left out by design.
- `hourly.njk` is an unchanged copy of the stock template. The docs ask for all four templates in a theme folder.
- `wx-forecast.js` hooks the module's `initWeatherTheme` and `updateWeatherTheme`. It fetches hourly data straight from Open-Meteo (the stock module only keeps daily or current data), draws the ribbons, and runs the rotation. Pages switch on the clock, so all themed weather modules turn together. It only takes over weather modules that list it in `themeCustomScripts`; any other weather module on the page works as stock.
- The extra Open-Meteo request asks only for the seven hourly values it uses plus sunrise and sunset, on the module's `updateInterval`. Modules on the same location share it.

## License

MIT. `weather.css` includes MagicMirror²'s stock weather styles, MIT License, Copyright © 2016-2026 Michael Teeuw.
