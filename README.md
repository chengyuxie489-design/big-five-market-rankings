# Big Five Market Rankings

Live bilingual market value rankings for Europe's big five football leagues:

- Premier League
- LaLiga
- Bundesliga
- Serie A
- Ligue 1

The site aggregates player market values and portraits from a Transfermarkt data API on the server, caches responses for 30 minutes, and renders an overall ranking plus league-specific rankings. By default it loads the top clubs in each league to keep free-tier deployments responsive; set `CLUB_LIMIT_PER_LEAGUE` higher for deeper coverage.

## Run locally

```bash
node server.mjs
```

Open `http://localhost:3000`.

## Deploy

The included `render.yaml` can be used as a Render Blueprint. The app has no npm dependencies and starts with:

```bash
node server.mjs
```
