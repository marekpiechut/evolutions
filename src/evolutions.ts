import pg from 'pg'
import {
	Config,
	DEFAULT_CONFIG,
	EvolutionExpression,
	LoadedEvolution,
	Logger,
} from './models.js'
import { consoleLogger } from './utils.js'
import schemaSql from './schema.sql.js'

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
		this.logger = logger || consoleLogger
	}

	public async hasDown(): Promise<boolean> {
		const hasSchema = await this.hasSchema()
		if (!hasSchema) return false

		const current = await this.getCurrent()
		if (!current) return false

		if (current.version > this.evolutions.length) {
			//Running old version of app missing some recent migrations?
			return false
		}

		const expectedCurrent = this.evolutions[current.version - 1]
		const checksumMismatch = current.checksum !== expectedCurrent?.checksum

		return checksumMismatch
	}

	public async apply(): Promise<void> {
		this.logger('INFO', `Applying evolutions into ${this.config.schema} schema`)
		const hasSchema = await this.hasSchema()

		if (!hasSchema) {
			this.logger('INFO', 'Creating evolutions schema')
			await this.createSchema()
			this.logger('INFO', 'Schema created')
		}

		const current = await this.getCurrent()
		this.logger(
			'INFO',
			`Current version: ${current?.version || 0} (${current?.checksum})`
		)
		this.logger(
			'INFO',
			`Requested version: ${this.evolutions.length} (${this.evolutions[this.evolutions.length - 1]?.checksum})`
		)

		if (hasSchema && (await this.hasDown())) {
			if (this.config.allowDown) {
				this.logger(
					'WARN',
					'!!! WARNING !!! Database has down migrations. This will DESTROY YOUR DATA!'
				)
				await this.applyDown()
			} else if (this.config.ignoreDown) {
				this.logger(
					'WARN',
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
		this.logger(
			'INFO',
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

		this.logger(
			'INFO',
			`Downgraded database to version ${current?.version || 0}`
		)
	}

	private async createSchema(): Promise<{ version: number }> {
		const sqls = schemaSql(this.config)
		await this.client.query(`BEGIN;`)
		for (const up of sqls) {
			this.logger('DEBUG', up)
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
				this.logger('INFO', 'All down migrations applied')
				return
			}
			current = await this.getCurrent()
		}
	}

	private async downgrade(current: LoadedEvolution): Promise<void> {
		this.logger(
			'WARN',
			`Downgrading database to version ${current.version - 1}`
		)
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
			this.logger(
				'WARN',
				`No version in schema ${this.config.schema}. Assuming no data.`
			)
		}

		const currentVersion = current ? current.version : 0
		const toApply = this.evolutions.slice(currentVersion)
		for (const evo of toApply) {
			this.logger('INFO', `Applying up migration ${evo.version}`)
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
		for (const sql of sqls) {
			this.logger('DEBUG', sql)
			await this.client.query(sql)
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
