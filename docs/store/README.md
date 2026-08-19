# Play Store assets

Everything Google Play asks to be uploaded with the listing. All of it is
generated from the repository, so it can be rebuilt at any time and never drifts
from what the app actually looks like.

```bash
npm run store:assets      # icons + feature graphic + screenshots
```

Screenshots need the app running, so build and serve it first:

```bash
npm run build
npm run preview &
npm run store:screenshots
```

## What is here

| Asset | File | Play requirement |
| --- | --- | --- |
| App icon | `../../public/icon-512.png` | 512×512 PNG |
| Feature graphic | `feature-graphic-1024x500.png` | 1024×500 PNG |
| Phone screenshots | `screenshots/*.png` | 2–8 images, 1080×1920 here |

The screenshots are captured from the real production build driven by
Playwright, with a seeded year of demo data — a 2019 Škoda Octavia at roughly
5.9 l/100 km. Nothing in them is mocked up.

| File | Shows |
| --- | --- |
| `01-dashboard.png` | Dashboard: last fill, average consumption, cost per km, budget |
| `02-refuel-log.png` | The refuel entry form |
| `03-stats-summary.png` | Date filter and lifetime totals |
| `04-consumption-chart.png` | Consumption trend against the target line |
| `05-cost-charts.png` | Cost and price history charts |
| `06-maintenance.png` | Maintenance reminders and their status |
| `07-light-theme.png` | The same dashboard in light mode |

## Still to write by hand

The store listing text lives in [`../PUBLISHING.md`](../PUBLISHING.md) — short
description, full description and the Data safety answers.
