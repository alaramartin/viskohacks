# SafePath

By Berkeley Bunch (Carolina and Alara). Built for the Live Models Hackathon, hosted by Visko, Reactor and Nebius. Powered by Reactor and Visko's Orbis.

## Why we built it

No woman is a stranger to the hyper-awareness we must have when walking alone. Constantly looking behind, listening out for footsteps to make sure we aren't followed. In fact, almost 90% of women have reported feeling unsafe walking alone at night.

It especially doesn't help when navigating new spaces. As two freshmen at UC Berkeley, everywhere we walk is unfamiliar, so we have to consider our safety every time we leave our dorms.

This was our motivation behind SafePath. It allows us to visualize our path before we walk it, giving us better situational awareness and helping us feel safer.

## What it does

Type two addresses and a time, and SafePath generates a video of you walking that route at night. It starts from real street-level photos of those exact blocks, with the lighting and weather modelled from open data. You can change the time, fog or crowd while the video is playing, and it changes without restarting.

It's a familiarisation tool that can help us better understand the path we're walking at night. It is not a safety score and uses no crime data. Beside the video, SafePath lists what the data says about each block: streetlights, reported outages, open businesses, sidewalks and weather.

## How it works

- **Route:** the backend finds the shortest walking route through San Francisco from OpenStreetMap and splits it into blocks.
- **Conditions:** for each block it pulls darkness and sunset times, weather (Open-Meteo), streetlights (Mapillary and OSM), streetlight outage reports (DataSF 311) and business hours (OSM).
- **Seed image:** the video starts at night, but that is processing done behind the scenes. The original photo (from Mapillary) is taken in daylight, graded to night in the browser, and used as the seed image to start the video.
- **Walking the route:** the walk is steered by a script of prompts, one for each straight stretch and one for each turn.
- **Live changes:** we use Orbis's real-time prompt steering to update the scene as you press different buttons to simulate different times of day, fog or crowds. There is a bit of latency: a change of time takes about 15 seconds to fully show.

## Stack

- **Frontend:** Next.js, TypeScript, Reactor JS SDK (`reactor/visko-orbis-dynamic`)
- **Backend:** FastAPI, osmnx, networkx, scikit-learn, astral
- **Data:** OpenStreetMap, Mapillary, DataSF 311, Open-Meteo

## Limitations

- Street image data only exists for the center of the road.
- Orbis continues from its start image, so reference images that don't match the intended output need to be preprocessed.
- Latency causes real-time updates to lag a few seconds behind user interactions.

## More

- `PLAN.md`: build plan and decision log
- `docs/reactor-findings.md`: what we measured about Orbis
- `backend/README.md`, `frontend/README.md`: details for each part
