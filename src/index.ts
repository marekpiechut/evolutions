import crypto from 'crypto'
import fs from 'node:fs'
import readline from 'node:readline'
import path from 'path'
import pg from 'pg'
import { Readable } from 'stream'
import schemaSql from './schema.sql.js'

export type EvolutionExpression = string

export type Config = {
	schema?: string
	allowDown?: boolean
	ignoreDown?: boolean
}

export const DEFAULT_CONFIG = {
	schema: 'public',
	allowDown: false,
}

export type Evolution = {
	ups: EvolutionExpression[]
	downs?: EvolutionExpression[]
}

export type LoadedEvolution = Evolution & {
	checksum: string
	version: number
}

export const load = async (
	sqls: Evolution[],
	client: pg.ClientBase,
	config?: Config
): Promise<Evolutions> => {
	const evolutions = await loadEvolutions(sqls)
	return new Evolutions(client, evolutions, config)
}

export const loadFromFiles = async (
	filesOrFolder: string | string[],
	client: pg.ClientBase,
	config?: Config
): Promise<Evolutions> => {
	let files
	if (typeof filesOrFolder === 'string') {
		files = await fs.promises.readdir(filesOrFolder)
		files = files.map(f => path.join(filesOrFolder, f))
	} else {
		files = filesOrFolder
	}
	const sqls = files.filter(f => f.endsWith('.sql')).sort()
	const parsed = await Promise.all(
		sqls.map(file => {
			const stream = fs.createReadStream(file, 'utf-8')
			return parseSqlFile(stream)
		})
	)
	const evolutions = await loadEvolutions(parsed)
	return new Evolutions(client, evolutions, config)
}

export type Logger = {
	debug: (msg: string, ...args: unknown[]) => void
	info: (msg: string, ...args: unknown[]) => void
	warn: (msg: string, ...args: unknown[]) => void
	error: (error: unknown, msg: string, ...args: unknown[]) => void
}

export class Evolutions {
	private config: Config
	private logger: Logger
	constructor(
		private client: pg.ClientBase,
		private evolutions: LoadedEvolution[],
		config?: Config,
		logger?: Logger
	) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.logger = logger || console
	}

	public async hasDown(): Promise<boolean> {
		const hasSchema = await this.hasSchema()
		if (!hasSchema) return false

		const current = await this.getCurrent()
		if (!current) return false

		const expected = this.evolutions[current.version - 1]

		const needsDowngrade = current.version > expected.version
		const checksumMismatch = current.checksum !== expected.checksum

		return needsDowngrade || checksumMismatch
	}

	public async apply(): Promise<void> {
		this.logger.info(`Applying evolutions into ${this.config.schema} schema`)
		const hasSchema = await this.hasSchema()

		if (!hasSchema) {
			this.logger.info('Creating evolutions schema')
			await this.createSchema()
			this.logger.info('Schema created')
		}

		const current = await this.getCurrent()
		this.logger.info(
			`Current version: ${current?.version || 0} (${current?.checksum})`
		)
		this.logger.info(
			`Requested version: ${this.evolutions.length} (${this.evolutions[this.evolutions.length - 1]?.checksum})`
		)

		if (hasSchema && (await this.hasDown())) {
			if (this.config.allowDown) {
				this.logger.warn(
					'!!! WARNING !!! Database has down migrations. This will DESTROY YOUR DATA!'
				)
				await this.applyDown()
			} else if (this.config.ignoreDown) {
				this.logger.warn(
					'!!! WARNING !!! Database has down migrations. Ignoring them.'
				)
			} else {
				throw Error(
					'Database has down migrations. For development use `allowDown` option to apply them. NEVER USE FOR PRODUCTION!'
				)
			}
		}

		await this.applyUp()
		const currentAfter = await this.getCurrent()
		this.logger.info(
			`Evolutions applied, database is up to date. Version: ${currentAfter?.version || 0}, Checksum: ${currentAfter?.checksum}`
		)
	}

	public withLogger(logger: Logger): Evolutions {
		return new Evolutions(this.client, this.evolutions, this.config, logger)
	}

	public async downTo(version: number): Promise<void> {
		if (!this.config.allowDown) {
			throw Error(
				'You must enable allowDown option to apply down migrations. NEVER USE FOR PRODUCTION!'
			)
		}
		let current = await this.getCurrent()
		while (current && current.version > version) {
			await this.downgrade(current)
			current = await this.getCurrent()
		}

		this.logger.info(`Downgraded database to version ${current?.version || 0}`)
	}

	private async createSchema(): Promise<{ version: number }> {
		const sqls = schemaSql(this.config)
		await this.client.query(`BEGIN;`)
		for (const up of sqls) {
			this.logger.debug(up)
			await this.client.query(up)
		}
		await this.client.query('COMMIT;')
		return { version: 0 }
	}

	private async applyDown(): Promise<void> {
		let current = await this.getCurrent()
		while (current) {
			const expected = this.evolutions[current.version - 1]

			if (!expected || current.checksum !== expected.checksum) {
				this.downgrade(current)
			} else {
				this.logger.info('All down migrations applied')
				return
			}
			current = await this.getCurrent()
		}
	}

	private async downgrade(current: LoadedEvolution): Promise<void> {
		this.logger.warn(`Downgrading database to version ${current.version - 1}`)
		const downs = current.downs
		await this.client.query(`BEGIN;`)
		try {
			if (downs) {
				await this.applySingle(downs)
			}
			await this.evolutionDropped(current)
			await this.client.query('COMMIT;')
		} catch (e) {
			await this.client.query(`ROLLBACK;`)
			throw e
		}
	}

	private async applyUp(): Promise<void> {
		const current = await this.getCurrent()
		if (current == null) {
			this.logger.warn(
				`No version in schema ${this.config.schema}. Assuming no data.`
			)
		}

		const currentVersion = current ? current.version : 0
		const toApply = this.evolutions.slice(currentVersion)
		for (const evo of toApply) {
			this.logger.info(`Applying up migration ${evo.version}`)
			await this.client.query(`BEGIN;`)
			try {
				await this.applySingle(evo.ups)
				await this.evolutionApplied(evo)
				await this.client.query('COMMIT;')
			} catch (e) {
				await this.client.query(`ROLLBACK;`)
				throw e
			}
		}
	}

	private async applySingle(sqls: EvolutionExpression[]): Promise<void> {
		for (const up of sqls) {
			this.logger.debug(up)
			await this.client.query(up)
		}
	}

	private async hasSchema(): Promise<boolean> {
		const { rows } = await this.client.query(
			`SELECT 1 as success FROM information_schema.tables
				WHERE table_schema='${this.config.schema || 'public'}'
				AND table_name ilike 'EVOLUTIONS';
			`
		)
		return rows[0]?.success === 1
	}

	async getCurrent(): Promise<LoadedEvolution | null> {
		const { rows: versionRows } = await this.client.query(
			`SELECT * FROM ${this.config.schema}.EVOLUTIONS
					ORDER BY version DESC LIMIT 1;
				`
		)
		const row = versionRows[0]
		if (row) {
			return {
				version: row.version,
				checksum: row.checksum,
				ups: row.ups,
				downs: row.downs,
			}
		} else {
			return null
		}
	}

	private async evolutionDropped(evo: LoadedEvolution): Promise<void> {
		await this.client.query(
			`DELETE FROM ${this.config.schema}.EVOLUTIONS WHERE version = $1`,
			[evo.version]
		)
	}

	private async evolutionApplied(evo: LoadedEvolution): Promise<void> {
		await this.client.query(
			`INSERT INTO ${this.config.schema}.EVOLUTIONS (version, checksum, ups, downs)
				VALUES ($1, $2, $3, $4);
			`,
			[
				evo.version,
				evo.checksum,
				JSON.stringify(evo.ups),
				JSON.stringify(evo.downs),
			]
		)
	}
}

const parseSqlFile = (stream: Readable): Promise<Evolution> => {
	return new Promise((resolve, reject) => {
		const reader = readline.createInterface({ input: stream })
		const ups: EvolutionExpression[] = []
		const downs: EvolutionExpression[] = []
		let current = ups
		let statement = ''
		let inBlock = false
		reader.on('error', reject)
		reader.on('line', line => {
			const trimmed = line.trim()
			if (trimmed === '-- DOWN --') {
				current = downs
			} else if (trimmed === '-- BLOCK --') {
				inBlock = true
			} else if (inBlock && trimmed === '-- BLOCK END --') {
				if (statement) {
					current.push(statement)
					statement = ''
				}
				inBlock = false
			} else if (!trimmed.startsWith('--')) {
				statement += trimmed + '\n'
				if (!inBlock && trimmed.endsWith(';')) {
					current.push(statement)
					statement = ''
				}
			}
		})
		reader.on('close', () => {
			if (statement) {
				current.push(statement)
			}
			resolve({
				ups: ups,
				downs: downs.length ? downs : undefined,
			})
		})
	})
}

const loadEvolutions = async (
	evolutions: Evolution[]
): Promise<LoadedEvolution[]> => {
	return evolutions.map((evo, i) => ({
		...evo,
		checksum: generateChecksum(evo),
		version: i + 1,
	}))
}

const generateChecksum = (evo: Evolution): string => {
	const sql = evo.ups.map(s => s.trim()).join('; ')

	return crypto.createHash('sha1').update(sql).digest('hex')
}

export default {
	load,
	loadFromFiles,
}
