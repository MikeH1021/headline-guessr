# Roadmap

## Now: one container on the server

Headline Guessr runs as a single Docker container. Next.js and the database live in that same container.

- The database is a SQLite file at `/data/headline.sqlite` on the `headline-data` volume.
- SQLite is in WAL mode, with a 5 second busy timeout and a large page cache, so readers do not block each other and a score write is one small row.
- There is no database username or password, and no environment variable for database credentials.
- The xAI key and the admin password hash are sealed in `.env.enc`. Startup unlocks them with `ENV_PASS`. The database directory is `./data`, or `HG_DATA` if that is set.
- One process is enough for the first host. Page reads are short, the daily round is cached in the database, and score inserts stay on one writer. That is the shape that holds thousands of people playing at once on this box.
- The app is not stateless yet. The database file, the play sessions, and the daily scheduler all belong to this one container. Leave it that way until the move below.

The first boot copies `round.json`, `scores.json`, `settings.json`, `rum.json`, `queue.json`, and `refresh_status.json` when those files are visible in `/legacy` and the database is empty. It reads them. It does not rewrite them.

`docker compose up -d --build` is the run command. The container listens on port 3000 and publishes it on port 8110.

## Later: Kubernetes

Do not split this yet. When the site needs more than one app instance, make these changes and only these changes:

1. Move the database off this container. Multiple app instances cannot share one SQLite file. Put PostgreSQL in its own container on the cluster network, with its own volume. Point the app at it with `DATABASE_URL`. The database calls are gathered in `lib/store.ts`, `lib/rum.ts`, `lib/job.ts`, and `lib/db.ts`, which is the seam for that adapter.
2. Run the Next.js app as several stateless replicas behind the cluster load balancer. The replicas should not keep a local database file. Sessions already live in the database, so they move with it.
3. Run the daily refresh once, not once per replica. A CronJob, or a single worker, should call the refresh. The in-process 30 second loop in `lib/scheduler.ts` has to be off when more than one replica is up, or several of them will classify the same morning.
4. Keep the round, the queue, the scores, and the admin stats in the shared database. The browser desk (streaks, old editions) stays in localStorage and needs nothing on the server.

After that split, adding capacity is another replica. The app container itself stays free of database credentials other than the connection string for the database service.

`/admin` requires the password whose scrypt hash is `ADMIN_PASSWORD_HASH` in `.env`. The player pages do not use that password.
