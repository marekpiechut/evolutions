import { beforeEach, describe, test } from 'node:test'
import { Evolutions } from '../src/evolutions.js'
import { Logger } from '../src/models.js'
import { config, createEvolutions, initDb, mockEvolutions } from './utils.js'
import assert from 'node:assert'

const db = initDb()

const pg = db.adapters.createPg()
const backup = db.backup()

const log: { level: string; msg: string; args: unknown[] }[] = []
const logger: Logger = (level, msg, ...args) => log.push({ level, msg, args })

const queries: string[] = []
db.on('query', query => {
	queries.push(query)
})

beforeEach(async () => {
	backup.restore()
	log.length = 0
	queries.length = 0
})

describe('down evolutions', () => {
	test('has no downs if same evolutions are passed', async () => {
		const sqls = mockEvolutions(db, 3)

		const evolutions = new Evolutions(new pg.Client(), sqls, config, logger)
		assert.equal(await evolutions.hasDown(), false)
	})

	test('has down if checksum mismatch', async () => {
		const sqls = mockEvolutions(db, 3)

		sqls[2].checksum = '__CHECKSUM_MISMATCH__'
		const evolutions = new Evolutions(new pg.Client(), sqls, config, logger)
		assert.equal(await evolutions.hasDown(), true)
	})

	test('has no down if current db has more evolutions than provided', async () => {
		const sqls = mockEvolutions(db, 4)

		const evolutions = new Evolutions(
			new pg.Client(),
			sqls.slice(0, 3),
			config,
			logger
		)
		assert.equal(await evolutions.hasDown(), false)
	})

	test('does not execute down evolutions if config.allowDown is not true', async () => {
		const sqls = mockEvolutions(db, 3)

		sqls[2].checksum = '__CHECKSUM_MISMATCH__'
		const evolutions = new Evolutions(new pg.Client(), sqls, config, logger)
		assert.equal(await evolutions.hasDown(), true)

		assert.rejects(() => evolutions.apply(), /Database has down migrations/)
	})

	test('does not allow downTo if config.allowDown is not true', async () => {
		const sqls = mockEvolutions(db, 3)

		const evolutions = new Evolutions(new pg.Client(), sqls, config, logger)
		assert.equal(await evolutions.hasDown(), false)

		assert.rejects(() => evolutions.downTo(1), /You must enable allowDown/)
	})

	test('executes down migration if allowed in config', async () => {
		const sqls = mockEvolutions(db, 3)

		sqls[2].checksum = '__CHECKSUM_MISMATCH__'
		const evolutions = new Evolutions(
			new pg.Client(),
			sqls,
			{
				...config,
				allowDown: true,
			},
			logger
		)
		const current = await evolutions.getCurrent()
		assert.equal(await evolutions.hasDown(), true)
		assert.equal(current?.version, 3)

		await evolutions.apply()

		const updated = await evolutions.getCurrent()
		assert.equal(updated?.version, 3)
		assert.equal(updated?.checksum, '__CHECKSUM_MISMATCH__')
	})

	test('executes downTo if allowed in config', async () => {
		const sqls = mockEvolutions(db, 3)

		const evolutions = new Evolutions(
			new pg.Client(),
			sqls,
			{
				...config,
				allowDown: true,
			},
			logger
		)
		const current = await evolutions.getCurrent()
		assert.equal(await evolutions.hasDown(), false)
		assert.equal(current?.version, 3)

		await evolutions.downTo(1)

		const updated = await evolutions.getCurrent()
		assert.equal(updated?.version, 1)
	})

	test('executes down migration if allowed in config and only checksum mismatch', async () => {
		const sqls = mockEvolutions(db, 3)

		sqls[2].checksum = '__CHECKSUM_MISMATCH__'
		const evolutions = new Evolutions(
			new pg.Client(),
			sqls,
			{
				...config,
				allowDown: true,
			},
			logger
		)
		const current = await evolutions.getCurrent()
		assert.equal(await evolutions.hasDown(), true)
		assert.equal(current?.version, 3)

		await evolutions.apply()

		const updated = await evolutions.getCurrent()
		assert.equal(updated?.version, 3)
		assert.equal(updated?.checksum, '__CHECKSUM_MISMATCH__')
	})

	test('does not execute down migrations if down is ignored', async () => {
		const sqls = mockEvolutions(db, 3)
		const originalChecksum = sqls[2].checksum

		sqls[2].checksum = '__CHECKSUM_MISMATCH__'
		const evolutions = new Evolutions(
			new pg.Client(),
			sqls,
			{
				...config,
				ignoreDown: true,
			},
			logger
		)
		const current = await evolutions.getCurrent()
		assert.equal(await evolutions.hasDown(), true)
		assert.equal(current?.version, 3)

		await evolutions.apply()

		const updated = await evolutions.getCurrent()
		assert.equal(updated?.version, 3)
		assert.equal(updated?.checksum, originalChecksum)
	})

	test('does not execute down migrations but executes up if down is ignored', async () => {
		mockEvolutions(db, 3)
		const updates = createEvolutions(4)
		updates[2].checksum = '__UPDATED_CHECKSUM__'

		const evolutions = new Evolutions(
			new pg.Client(),
			updates,
			{
				...config,
				ignoreDown: true,
			},
			logger
		)
		const current = await evolutions.getCurrent()
		assert.equal(await evolutions.hasDown(), true)
		assert.equal(current?.version, 3)

		await evolutions.apply()

		const updated = await evolutions.getCurrent()
		assert.equal(updated?.version, 4)
	})

	test('down and up queries are actually executed', async () => {
		const originals = mockEvolutions(db, 1, true)

		//Make sure we only analyze migration queries
		queries.length = 0

		const updates = [...originals, ...createEvolutions(2, false, 2)]
		updates[0].checksum = '__UPDATED_CHECKSUM__'

		const evolutions = new Evolutions(
			new pg.Client(),
			updates,
			{
				...config,
				allowDown: true,
			},
			logger
		)

		await evolutions.apply()

		originals
			.reduce((acc, sql) => [...acc, ...(sql.downs || [])], [] as string[])
			.forEach(down => {
				const executed = queries.find(q => q.includes(down))
				assert.ok(executed, `Missing executed DOWN query: ${down}`)
			})

		updates
			.reduce((acc, sql) => [...acc, ...sql.ups], [] as string[])
			.forEach(up => {
				const executed = queries.find(q => q.includes(up))
				assert.ok(executed, `Missing executed UP query: ${up}`)
			})
	})
})

describe('up evolutions', () => {
	test('executes up migrations on empty database', async () => {
		const sqls = createEvolutions(7)

		const evolutions = new Evolutions(new pg.Client(), sqls, config, logger)
		assert.equal(await evolutions.hasDown(), false)

		await evolutions.apply()

		const updated = await evolutions.getCurrent()
		assert.equal(updated?.version, 7)
		assert.equal(updated?.checksum, sqls[6].checksum)
	})

	test('executes up migrations on already populated db', async () => {
		const originals = mockEvolutions(db, 2)
		const updates = createEvolutions(2, false, 3)

		const evolutions = new Evolutions(
			new pg.Client(),
			[...originals, ...updates],
			config,
			logger
		)
		assert.equal(await evolutions.hasDown(), false)

		await evolutions.apply()

		const updated = await evolutions.getCurrent()
		assert.equal(updated?.version, 4)
		assert.equal(updated?.checksum, updates[1].checksum)
	})

	test('up queries are actually executed', async () => {
		const sqls = createEvolutions(2)

		const evolutions = new Evolutions(new pg.Client(), sqls, config, logger)
		await evolutions.apply()

		sqls
			.reduce((acc, sql) => [...acc, ...sql.ups], [] as string[])
			.forEach(up => {
				const executed = queries.find(q => q.includes(up))
				assert.ok(executed, `Missing executed query: ${up}`)
			})
	})
})

describe('logging', () => {
	test('logs migration steps', async () => {
		const originals = mockEvolutions(db, 2, true)
		const updates = createEvolutions(2, true)

		updates[1].checksum = '__CHECKSUM_MISMATCH__'
		updates[1].downs = [
			'THIS IS NOT EXECUTED, WE USE DOWNS FROM DB, NOT FROM UPDATES',
		]
		const evolutions = new Evolutions(
			new pg.Client(),
			updates,
			{
				...config,
				allowDown: true,
			},
			logger
		)

		await evolutions.apply()
		originals[1].downs?.forEach(down => {
			const logged = log.find(m => m.level === 'DEBUG' && m.msg === down)
			assert.ok(logged, `Missing log for down: ${down}`)
		})

		updates[1].ups.forEach(up => {
			const logged = log.find(m => m.level === 'DEBUG' && m.msg === up)
			assert.ok(logged, `Missing log for up: ${up}`)
		})
	})
})
