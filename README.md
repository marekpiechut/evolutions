# Evolutions

Database evolutions for PostgreSQL and NodeJS/Bun. With checksum, CLI, support for plain \*.sql files and down migrations for development.

# Usage

```shell
Usage: evolutions [options] [command]

Options:
-p, --port <port> Postgres port (default: "5432")
-h, --host <host> Postgres host (default: "localhost")
-u, --user <username> Postgres user (default: "postgres")
-w, --password <password> Postgres password (default: "postgres")
-d, --database <database> Postgres database (default: "postgres")
-s, --schema <schema> Database schema (default: "public")
--allow-down Apply down evolutions. DON'T DO THIS IN PRODUCTION !!!
--help display help for command

Commands:
apply [folder]
options
down-to <version>
help [command] display help for command
```
