# SafePath

By Berkeley Bunch, for the Live Models Hackathon (Visko, Reactor, Nebius).

SafePath shows you a walk before you take it. Enter a start, a destination, a date and a time in San Francisco. SafePath plans a walking route and plays a first-person video of it, generated live by Visko Orbis and started from real street-level photos of the route. Change the time, or turn fog or crowds on, while the video plays and the scene updates without restarting.

It helps you get to know a route. It does not score how safe a route is, and it uses no crime data. The panel beside the video lists what the data says about each block: streetlights, reported outages, open businesses, sidewalks and weather. Values are labelled as estimates, and any setting you changed yourself says so.

## How it works

1. The backend finds the shortest walking route on a cached OpenStreetMap graph of San Francisco and splits it into blocks.
2. For each block it gathers conditions: sunset and darkness (astral), weather (Open-Meteo), streetlights (Mapillary and OSM), outage reports (DataSF 311), business hours (OSM), and a Mapillary photo.
3. It turns the route into a short script of prompts: one per straight stretch, one per turn, and one for arriving.
4. The browser adjusts the first block's photo for the chosen time of day and uses it to start one continuous Orbis video.
5. The walk is steered by prompt changes as it plays. When you change the time, a short prompt about the light takes over for 14 seconds, then the normal prompt returns.

## Stack

- **Frontend:** Next.js, TypeScript, Reactor JS SDK (`reactor/visko-orbis-dynamic`)
- **Backend:** FastAPI, osmnx, networkx, scikit-learn, astral
- **Data:** OpenStreetMap, Mapillary, DataSF 311, Open-Meteo

## Run it

You need a Reactor API key and a Mapillary access token.

```sh
# keys
cp .env.example .env                        # set MAPILLARY_ACCESS_TOKEN
cp frontend/.env.example frontend/.env.local   # set REACTOR_API_KEY

# backend, port 8000
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000

# frontend, port 3000 (in another terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The map and data files are committed in `backend/data/`, so nothing needs to be downloaded first. The backend takes about 10 seconds to start.

## Known limits

- San Francisco only.
- Reactor allows one Orbis session per account, so only one walk can play at a time.
- A time change takes about 15 seconds to show fully.
- Orbis stays close to the real photo for about 25 seconds. After that the streets are generated, so the video may not match the real route. The data panel says when a block has no photo behind it.

## More

- `PLAN.md`: build plan and decision log
- `docs/reactor-findings.md`: what we measured about Orbis
- `backend/README.md`, `frontend/README.md`: details for each part
