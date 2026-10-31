db: test -f .pg/PG_VERSION || initdb -U postgres --auth=trust -D .pg >/dev/null; exec postgres -D .pg -k '' -h 127.0.0.1 -p 5433
hub: until pg_isready -q -h 127.0.0.1 -p 5433 && curl -so /dev/null http://127.0.0.1:8080/; do sleep 1; done; createdb -h 127.0.0.1 -p 5433 -U postgres subnet 2>/dev/null; DATABASE_URL=postgres://postgres@127.0.0.1:5433/subnet exec subnet dev subnet/chat.hcl
web: cd web && pnpm install --silent && exec pnpm watch
server: test -f config.toml || cp config.example.toml config.toml; until pg_isready -q -h 127.0.0.1 -p 5433; do sleep 1; done; CONFIG_PATH=$PWD/config.toml RUST_LOG=info exec cargo run -p plan-ai-chat-server
