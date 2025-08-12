import { IMemoryDb, newDb } from 'pg-mem'
import schema from '../src/schema.sql.js'
import { LoadedEvolution } from '../src/models.js'

export const config = { schema: 'public' }

export const initDb = (): IMemoryDb => {
	const db = newDb()
	const sqls = schema(config)
	for (const sql of sqls) {
		db.public.none(sql)
	}

	db.public.none(`CREATE TABLE test (id INT, row INT, value TEXT);`)
	return db
}

export const mockEvolutions = (
	db: IMemoryDb,
	amount: number,
	withDowns?: boolean
): LoadedEvolution[] => {
	const evolutions = createEvolutions(amount, withDowns)
	evolutions.forEach(evo => {
		db.public
			.prepare(
				'INSERT INTO evolutions (version, checksum, ups, downs) VALUES ($1, $2, $3, $4);'
			)
			.bind([
				evo.version,
				evo.checksum,
				JSON.stringify(evo.ups),
				JSON.stringify(evo.downs || []),
			])
			.executeAll()
	})

	return evolutions
}

export const createEvolutions = (
	amount: number,
	withDowns: boolean = false,
	startVersion: number = 1
): LoadedEvolution[] => {
	return new Array(amount).fill('').map((_, i) => {
		const version = i + startVersion
		return {
			version: version,
			checksum: `CHECKSUM_${version}`,
			ups: [
				`INSERT INTO TEST (id, row, value) VALUES (${version}, 1, 'UP_${version}')`,
				`INSERT INTO TEST (id, row, value) VALUES (${version}, 2, 'UP_${version + 1}')`,
			],
			downs: withDowns
				? [
						`DELETE FROM TEST WHERE id = ${version} AND row = 1`,
						`DELETE FROM TEST WHERE id = ${version} AND row = 2`,
					]
				: undefined,
		}
	})
}
