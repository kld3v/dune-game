# Arrakis server

Multiplayer for the Dune game: up to 20 players share one desert. Phase one shares who is
where (on foot, riding a worm, flying, or down in a sietch), chat, the time of day and the
Coriolis storms. Worms, raids and spice still run on each player's machine.

Plain Node 22 and the `ws` package. No database, no accounts: names are chosen on the title
screen and are not authenticated.

## Run it on the Pi

```bash
git clone git@github.com:kld3v/dune-game.git   # or git pull in an existing checkout
cd dune-game/server
docker compose up -d --build
curl -s localhost:8006/health                     # {"ok":true,"players":0,"cap":20,...}
docker compose logs -f                            # joins, leaves, storms
```

Port 8006 is free on the main Pi (8001-8005, 8080 and 5433 are taken).

## Expose it through the Cloudflare tunnel

Pick a hostname, for example `arrakis.tinyrenegade.com`, then follow the usual steps on the
Pi that runs `cloudflared` (`/etc/cloudflared/config.yml`, rules at column 0, the
`http_status:404` catch-all last):

```yaml
- hostname: arrakis.tinyrenegade.com
  service: http://localhost:8006          # or http://<spare-pi-lan-ip>:8006
```

```bash
sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress rule https://arrakis.tinyrenegade.com
sudo systemctl restart cloudflared
cloudflared tunnel route dns d6df1e95-d1a7-4ccc-930c-549650f0a761 arrakis.tinyrenegade.com
```

Read the `route dns` log line: it must say `Added CNAME arrakis.tinyrenegade.com` with nothing
after it. Cloudflare tunnels carry websockets with no extra settings.

If the server runs on the spare Pi and the tunnel on the main one, change the compose port
to `"8006:8006"` and point the ingress rule at the spare Pi's LAN address.

## Point the game at it

- To try it now, open the game with the server in the link; the browser remembers it:
  `https://dune-game-arrakis.netlify.app/?mmo=wss://arrakis.tinyrenegade.com`
  (`?mmo=` with nothing after it forgets it again).
- To make it the default for everyone, put `VITE_MMO_URL=wss://arrakis.tinyrenegade.com` in
  `.env.production` at the repository root and redeploy the site.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8006` | |
| `MAX_PLAYERS` | `20` | Players over the cap are told the desert is full. |
| `ALLOWED_ORIGINS` | the Netlify site and localhost:5179 | Comma-separated; other origins are refused. |
| `FIRST_STORM` | random 200-320 | Seconds until the first storm; for testing. |

## Limits it enforces

- Origin allowlist, 8 KB maximum message, 40 messages a second per client.
- Every player state is validated before it is relayed; malformed ones are dropped.
- Names are cleaned to 16 letters, digits and spaces; chat to 160 characters, one line
  every 1.2 seconds.
- Connections that stop answering pings are dropped after 30 seconds.

## Develop

```bash
cd server && npm install
FIRST_STORM=20 ALLOWED_ORIGINS=http://127.0.0.1:5179 npm start
npm run check                                     # typecheck
```

Then open the dev game with `?mmo=ws://127.0.0.1:8006`.
